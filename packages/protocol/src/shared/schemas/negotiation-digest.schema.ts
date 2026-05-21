/**
 * NegotiationDigest — compact, fixed-size structured summary of one discovery
 * negotiation. Produced by the negotiation summarizer; consumed by the
 * decision-question generator in place of raw negotiations.
 *
 * Goal: cap the question generator's per-negotiation prompt budget so that a
 * 10-candidate discovery turn produces a ~1.5 KB prompt instead of a 60+ KB
 * blob that stalls upstream LLM providers.
 */
import { z } from "zod";

// LLMs ignore .max() length constraints often enough that strict validation
// throws every call and forces a fallback. Slice strings down before validating
// so JSON schema still advertises the limit but a small overshoot doesn't drop
// the whole digest.
const clampedString = (maxLen: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.slice(0, maxLen) : v),
    z.string().min(1).max(maxLen),
  );

export const DiscoveryNegotiationDigestSchema = z.object({
  /** Abstract counterparty descriptor (no PII, no IDs). E.g. "AI infra founder, Berlin". */
  counterpartyHint: clampedString(120),
  /** The network the negotiation ran under (community prompt). */
  indexContext: clampedString(120),
  /** Whether the negotiation produced an opportunity. */
  outcomeRole: z.enum(["opportunity", "no-opportunity"]),
  /** When `outcomeRole === "no-opportunity"`, why the negotiation didn't yield one. Null otherwise. */
  outcomeReason: z.enum(["turn_cap", "timeout", "rejected", "stalled"]).nullable(),
  /**
   * One-sentence (≤180 chars) summary of the decisive moment or pattern in
   * this negotiation. Written for the downstream question generator — should
   * highlight a fact or tension that could inform a clarifying question.
   */
  keyTake: clampedString(180),
  /** Suggested roles agreed by both parties. Null when no agreement reached. */
  suggestedRoles: z
    .object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    })
    .nullable(),
});

export type DiscoveryNegotiationDigest = z.infer<typeof DiscoveryNegotiationDigestSchema>;
