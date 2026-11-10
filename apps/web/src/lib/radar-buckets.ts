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
  accepted: "no chats open yet.",
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

export function personWindowTitle(bucket: Exclude<RadarBucket, "all"> | null): "profile" | "chat" | "agent log" | "summary" {
  if (bucket === "accepted") return "chat";
  if (bucket === "negotiating") return "agent log";
  if (bucket === "closed") return "agent log";
  return "profile";
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** When a radar card last changed: arrived, committed, accepted, or closed. */
export function radarActivityAt(item: { updatedAt?: string; createdAt?: string }): string | undefined {
  return item.updatedAt || item.createdAt;
}

/** Epoch millis of `radarActivityAt`, 0 when unknown, for newest-first sorting. */
export function radarActivityMs(item: { updatedAt?: string; createdAt?: string }): number {
  const ms = Date.parse(radarActivityAt(item) ?? "");
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Compact age for a radar card: `now`, `12m`, `3h`, `2d`, `3w`, then a date (`Oct 12`) from four weeks on.
 * Returns null when the time is missing or unparseable.
 */
export function formatRadarAge(iso: string | undefined, now: number = Date.now()): string | null {
  const at = Date.parse(iso ?? "");
  if (!Number.isFinite(at)) return null;
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  if (elapsed < 4 * WEEK) return `${Math.floor(elapsed / WEEK)}w`;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString("en-US", sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}

/** The status word on a radar card. Closed splits into not a fit (rejected) and missed (expired). */
export function radarStatusLabel(
  bucket: Exclude<RadarBucket, "all">,
  status: OpportunityLifecycleStatus | undefined,
): string {
  if (bucket === "awaiting you") return "awaiting you";
  if (bucket === "negotiating") return "in progress";
  if (bucket === "accepted") return "accepted";
  return status === "rejected" ? "not a fit" : "missed";
}
