import type { IntentCycleSnapshot } from "@/services/conversation";
import type { OpportunityLifecycleStatus } from "@/services/opportunities";

export type RadarBucket =
  | "needs-you"
  | "agent-handling"
  | "waiting"
  | "connected"
  | "closed";

type IntentCycleNegotiation = IntentCycleSnapshot["negotiations"][number];

export const DEFAULT_RADAR_BUCKET: RadarBucket = "agent-handling";

const TERMINAL_BUCKETS: Partial<Record<OpportunityLifecycleStatus, RadarBucket>> = {
  accepted: "connected",
  rejected: "closed",
  expired: "closed",
  stalled: "closed",
};

const STATUS_BUCKETS: Record<OpportunityLifecycleStatus, RadarBucket> = {
  latent: "agent-handling",
  draft: "agent-handling",
  pending: "needs-you",
  negotiating: "agent-handling",
  stalled: "closed",
  accepted: "connected",
  rejected: "closed",
  expired: "closed",
};

/** Assign an opportunity to the person or agent currently responsible for it. */
export function radarBucketForOpportunity(
  status: OpportunityLifecycleStatus | undefined,
  negotiation?: Pick<IntentCycleNegotiation, "state" | "pause">,
): RadarBucket {
  const terminalBucket = status ? TERMINAL_BUCKETS[status] : undefined;
  if (terminalBucket) return terminalBucket;

  if (negotiation?.state === "paused") {
    if (negotiation.pause?.reason === "needs_principal") {
      return negotiation.pause.by === "yours" ? "needs-you" : "waiting";
    }
    if (negotiation.pause?.reason === "counterparty_silent") return "waiting";
    return "agent-handling";
  }

  if (negotiation?.state === "working") return "agent-handling";

  return status ? STATUS_BUCKETS[status] : "agent-handling";
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
