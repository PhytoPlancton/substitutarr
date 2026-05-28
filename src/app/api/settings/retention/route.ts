import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

const DRY_RUN_REQUIRED_DAYS = 7;
const DAY_MS = 86400_000;

const Schema = z.object({
  mode: z.enum(["off", "dry_run", "active"]).optional(),
  thresholds: z
    .object({
      notWatchedSinceImportDays: z.number().int().min(7).max(3650).optional(),
      watchedLongAgoDays: z.number().int().min(7).max(3650).optional(),
      tvEndedBingedDays: z.number().int().min(7).max(3650).optional(),
      diskPressurePercent: z.number().int().min(50).max(99).optional(),
    })
    .optional(),
  maxDeletionsPerDay: z.number().int().min(1).max(100).optional(),
  preDeleteNoticeHours: z.number().int().min(0).max(168).optional(),
});

/**
 * PATCH the retention block. Enforces the dry-run cool-down:
 *   off → dry_run : always allowed
 *   dry_run → active : only if dryRunStartedAt is >= 7 days ago
 *   off → active : blocked (must go through dry_run first)
 *   anything → off : always allowed
 */
export async function PATCH(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const s = (await UserSettings.findOne({ userId }).lean()) as any;
  const current = s?.retention ?? {};

  const update: Record<string, unknown> = {};

  // Mode transition validation
  if (parsed.data.mode && parsed.data.mode !== current.mode) {
    const newMode = parsed.data.mode;
    const oldMode = current.mode ?? "off";

    if (oldMode === "off" && newMode === "active") {
      return NextResponse.json(
        { error: "must enable dry-run first and let it run 7 days before going active" },
        { status: 400 },
      );
    }
    if (oldMode === "dry_run" && newMode === "active") {
      const dryStart = current.dryRunStartedAt ? new Date(current.dryRunStartedAt).getTime() : 0;
      const elapsed = (Date.now() - dryStart) / DAY_MS;
      if (elapsed < DRY_RUN_REQUIRED_DAYS) {
        const remaining = Math.ceil(DRY_RUN_REQUIRED_DAYS - elapsed);
        return NextResponse.json(
          {
            error: `dry-run still has ${remaining} day(s) to go before you can go active`,
            remainingDays: remaining,
          },
          { status: 400 },
        );
      }
      update["retention.activatedAt"] = new Date();
    }
    if (oldMode !== "dry_run" && newMode === "dry_run") {
      update["retention.dryRunStartedAt"] = new Date();
    }
    update["retention.mode"] = newMode;
  }

  if (parsed.data.thresholds) {
    for (const [k, v] of Object.entries(parsed.data.thresholds)) {
      if (v !== undefined) update[`retention.thresholds.${k}`] = v;
    }
  }
  if (parsed.data.maxDeletionsPerDay !== undefined) update["retention.maxDeletionsPerDay"] = parsed.data.maxDeletionsPerDay;
  if (parsed.data.preDeleteNoticeHours !== undefined) update["retention.preDeleteNoticeHours"] = parsed.data.preDeleteNoticeHours;

  await UserSettings.updateOne({ userId }, { $set: update }, { upsert: true });
  const updated = (await UserSettings.findOne({ userId }, { retention: 1 }).lean()) as any;
  return NextResponse.json({ ok: true, retention: updated?.retention });
}
