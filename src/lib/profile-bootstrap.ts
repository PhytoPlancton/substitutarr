import { connectMongo } from "./mongo";
import { Profile } from "@/models/Profile";
import { PROFILE_PRESETS } from "./profile-presets";

// Sensible default fallback chain for the seeded presets, ending on the
// "Last Resort" safety-net so we always end on an accept-anything profile
// rather than failing. FrankeinStream shadow run found 2/46 failures where
// stricter profiles filtered everything — Last Resort catches those.
//   Référence 4K Atmos -> 1080p VFF Balanced -> Storage Saver 720p -> Last Resort
//   VOSTFR Cinéphile   -> 1080p VFF Balanced
//   Storage Saver 720p -> Last Resort
//   Quick & Dirty      -> Last Resort
const FALLBACK_LINKS: Record<string, string> = {
  "Référence 4K Atmos": "1080p VFF Balanced",
  "1080p VFF Balanced": "Storage Saver 720p",
  "VOSTFR Cinéphile": "1080p VFF Balanced",
  "Storage Saver 720p": "Fallback - Last Resort",
  "Quick & Dirty": "Fallback - Last Resort",
};

/**
 * Idempotently seeds the default 5 profiles for a user the first time
 * they hit any profile-aware endpoint. Subsequent calls are a no-op.
 */
export async function ensureProfilesForUser(userId: string): Promise<void> {
  await connectMongo();
  const existing = await Profile.countDocuments({ userId });
  if (existing > 0) return;

  const created: Record<string, string> = {};
  for (const preset of PROFILE_PRESETS) {
    const { weightOverrides, ...rest } = preset as any;
    const doc: any = { userId, ...rest };
    if (weightOverrides) doc.weights = mergeWeights(weightOverrides);
    const made = await Profile.create(doc);
    created[made.name] = made._id.toString();
  }

  // Second pass: link fallbacks now that all IDs exist
  for (const [from, to] of Object.entries(FALLBACK_LINKS)) {
    if (created[from] && created[to]) {
      await Profile.updateOne({ _id: created[from] }, { $set: { fallbackProfileId: created[to] } });
    }
  }
}

function mergeWeights(overrides: Record<string, any>): Record<string, any> {
  // Mongoose's schema defaults will fill in everything else when we leave fields undefined.
  // We just spread the overrides as-is and let Mongoose merge with defaults on save.
  const out: any = {};
  for (const [key, val] of Object.entries(overrides)) {
    if (val && typeof val === "object" && !Array.isArray(val)) out[key] = { ...val };
    else out[key] = val;
  }
  return out;
}
