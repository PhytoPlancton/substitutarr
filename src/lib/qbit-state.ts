/**
 * Map raw qBittorrent state strings to user-facing buckets + labels.
 * Keep this the only source of truth for state translation across the app.
 */
export type Bucket = "active" | "queued" | "completed" | "failed";

export type StateInfo = {
  bucket: Bucket;
  label: string;
  /** True if a progress bar / speed / ETA make sense to show. */
  showProgress: boolean;
  /** True for stalledDL with no peers — UI may flag as warning. */
  warning: boolean;
};

export function mapQbState(qb?: string | null): StateInfo {
  if (!qb) return { bucket: "queued", label: "Pending", showProgress: false, warning: false };
  switch (qb) {
    case "downloading":
    case "forcedDL":
      return { bucket: "active", label: "Downloading", showProgress: true, warning: false };
    case "metaDL":
    case "allocating":
      return { bucket: "active", label: "Starting", showProgress: false, warning: false };
    case "checkingDL":
    case "checkingUP":
    case "checkingResumeData":
      return { bucket: "active", label: "Verifying", showProgress: true, warning: false };
    case "moving":
      return { bucket: "active", label: "Importing", showProgress: false, warning: false };
    case "stalledDL":
      return { bucket: "active", label: "Stalled", showProgress: false, warning: true };
    case "pausedDL":
    case "stoppedDL":
      return { bucket: "active", label: "Paused", showProgress: false, warning: false };
    case "queuedDL":
    case "queuedUP":
      return { bucket: "queued", label: "Queued", showProgress: false, warning: false };
    case "uploading":
    case "forcedUP":
    case "stalledUP":
    case "pausedUP":
    case "stoppedUP":
    case "checkingUP" as any:
      return { bucket: "completed", label: "Done", showProgress: false, warning: false };
    case "error":
    case "missingFiles":
      return { bucket: "failed", label: "Failed", showProgress: false, warning: true };
    default:
      return { bucket: "queued", label: qb, showProgress: false, warning: false };
  }
}

/** Coarse bucket from the persisted Download.state when qBit isn't reachable. */
export function bucketFromDbState(state?: string): Bucket {
  switch (state) {
    case "completed":
    case "imported":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
      return "queued";
    case "downloading":
    default:
      return "active";
  }
}
