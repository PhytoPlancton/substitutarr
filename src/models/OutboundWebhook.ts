import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * User-configured outbound webhook target — analogous to Sonarr/Radarr "Connect" providers.
 * Each delivery is hashed-signed with the per-webhook secret so the receiver can verify
 * the payload came from this substitutarr instance and not from a spoofed request.
 *
 * Events are a free-form string array; we currently emit:
 *   - "request.grabbed"    — pushToQbit succeeded (movie or per-episode/season)
 *   - "request.completed"  — post-DL hook hardlinked the files into the library
 *   - "request.failed"     — grabBest exhausted all profiles with no acceptable release
 */
const OutboundWebhookSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    /** HMAC-SHA256 signing key — sent in `X-Substitutarr-Signature: sha256=…` header. */
    secret: { type: String, required: true },
    events: {
      type: [String],
      default: ["request.grabbed", "request.completed", "request.failed"],
    },
    active: { type: Boolean, default: true },
    /** Loose flag the user can flip to send Sonarr/Radarr-shaped payloads instead. */
    radarrCompat: { type: Boolean, default: false },
    lastDeliveryAt: Date,
    lastDeliveryStatus: String, // "ok" | "fail" | "skipped"
    failureCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

OutboundWebhookSchema.index({ userId: 1, name: 1 }, { unique: true });

export type OutboundWebhookDoc = InferSchemaType<typeof OutboundWebhookSchema> & { _id: string };
export const OutboundWebhook =
  models.OutboundWebhook || model("OutboundWebhook", OutboundWebhookSchema);

/** Pending delivery — picked up by the cron worker and POSTed with retries. */
const WebhookDeliverySchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    webhookId: { type: Schema.Types.ObjectId, ref: "OutboundWebhook", required: true, index: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    attempts: { type: Number, default: 0 },
    /** Next time the worker should retry — used as the queue key. */
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    deliveredAt: Date,
    /** Set once we give up after maxAttempts (dead letter). */
    deadLetterAt: Date,
    lastStatus: Number,
    lastError: String,
  },
  { timestamps: true },
);

WebhookDeliverySchema.index({ deliveredAt: 1, deadLetterAt: 1, nextAttemptAt: 1 });

export type WebhookDeliveryDoc = InferSchemaType<typeof WebhookDeliverySchema> & { _id: string };
export const WebhookDelivery =
  models.WebhookDelivery || model("WebhookDelivery", WebhookDeliverySchema);
