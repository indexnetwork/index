import type { OpportunityLifecycleStatus } from "@/services/opportunities";

export type RadarBucket = "all" | "awaiting you" | "negotiating" | "accepted" | "closed";

export const RADAR_STAGES: Array<Exclude<RadarBucket, "all">> = [
  "awaiting you",
  "negotiating",
  "accepted",
  "closed",
];

export const DEFAULT_RADAR_BUCKET: RadarBucket = "all";

const EMPTY_RADAR: Record<Exclude<RadarBucket, "all">, string> = {
  "awaiting you": "nothing waiting on you right now.",
  negotiating: "no negotiations open. your agent starts one when it finds an overlap.",
  accepted: "no one accepted yet.",
  closed: "nothing closed.",
};

/** Assign an opportunity to a radar stage. Not a fit (rejected) and missed (expired) share Closed. */
export function radarBucketForOpportunity(
  status: OpportunityLifecycleStatus | undefined,
  viewerCommitted = false,
): Exclude<RadarBucket, "all"> | null {
  if (status === "rejected" || status === "expired") return "closed";
  if (status === "pending" && viewerCommitted) return "accepted";
  if (status === "pending") return "awaiting you";
  if (status === "accepted") return "accepted";
  return "negotiating";
}

export function radarEmptyLine(bucket: RadarBucket): string {
  if (bucket === "all") return "no one here right now. the field keeps moving, so check back.";
  return EMPTY_RADAR[bucket];
}

export function personWindowTitle(bucket: Exclude<RadarBucket, "all"> | null): "profile" | "chat" | "negotiation" | "summary" {
  if (bucket === "accepted") return "chat";
  if (bucket === "negotiating") return "negotiation";
  if (bucket === "closed") return "negotiation";
  return "profile";
}
