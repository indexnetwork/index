import type { OpportunityLifecycleStatus } from "@/services/opportunities";

export type RadarBucket =
  | "needs-you"
  | "waiting"
  | "connected"
  | "closed";

export const DEFAULT_RADAR_BUCKET: RadarBucket = "needs-you";

const STATUS_BUCKETS: Record<OpportunityLifecycleStatus, RadarBucket> = {
  latent: "waiting",
  draft: "waiting",
  pending: "needs-you",
  negotiating: "waiting",
  stalled: "closed",
  accepted: "connected",
  rejected: "closed",
  expired: "closed",
};

/** Assign an opportunity to the person currently responsible for it. */
export function radarBucketForOpportunity(
  status: OpportunityLifecycleStatus | undefined,
): RadarBucket {
  return status ? STATUS_BUCKETS[status] : "waiting";
}

/** Only a non-zero Needs you count calls for visual attention. */
export function radarBucketBadgeTone(
  bucketKey: RadarBucket,
  value: number,
  active: boolean,
): string {
  if (bucketKey === "needs-you" && value > 0) {
    return "bg-amber-200 text-amber-950";
  }
  return active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500";
}
