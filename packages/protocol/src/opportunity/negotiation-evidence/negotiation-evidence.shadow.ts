/**
 * Lens C shadow orchestrator (IND-433).
 *
 * extract (allowlist, in place) → mine (neutral hypotheses) → verify (support
 * resolves to allowlisted evidence + speaker constraint) → recurrence gate
 * (>= k distinct opportunities). Returns aggregate telemetry plus the retained
 * hypotheses for OFFLINE review.
 *
 * This function performs NO persistence and NO user-visible action. It does
 * not create questions and changes no ranking, intent, premise, memory,
 * policy, newborn-stamping, or push behavior — those belong to the future
 * `on` mode (IND-437). Callers in shadow mode must log only
 * {@link NegotiationEvidenceShadowResult.telemetry} (aggregate-only) and must
 * not persist or route the retained hypotheses.
 */
import { NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES } from "./negotiation-evidence.env.js";
import { extractAllowlistedEvidence } from "./negotiation-evidence.extractor.js";
import type { NegotiationEvidenceMiner } from "./negotiation-evidence.miner.js";
import { verifyHypotheses } from "./negotiation-evidence.verifier.js";
import type { EvidenceMiningScope, NegotiationEvidenceShadowResult, RawEvidenceSegment } from "./negotiation-evidence.types.js";

/** Input for one shadow mining pass. */
export interface NegotiationEvidenceShadowInput {
  /** The exact recipient + intent/fingerprint + network this pass is bound to. */
  scope: EvidenceMiningScope;
  /** Raw negotiation segments read in place (one or more per opportunity). */
  segments: RawEvidenceSegment[];
  /** Structured hypothesis miner (injectable seam). */
  miner: Pick<NegotiationEvidenceMiner, "mine">;
  /** Override the recurrence floor (defaults to the IND-433 `k=5`). */
  minDistinctOpportunities?: number;
  signal?: AbortSignal;
}

/**
 * Run one Lens C shadow pass. Throws only when *mining* fails (callers run
 * fire-and-forget and must catch); extraction and verification are pure.
 */
export async function runNegotiationEvidenceShadow(
  input: NegotiationEvidenceShadowInput,
): Promise<NegotiationEvidenceShadowResult> {
  const { scope, segments } = input;
  const minDistinct = input.minDistinctOpportunities ?? NEGOTIATION_EVIDENCE_MIN_DISTINCT_OPPORTUNITIES;

  const extraction = extractAllowlistedEvidence(scope, segments);

  const baseTelemetry = {
    recipientUserId: scope.recipientUserId,
    intentId: scope.intentId,
    segments: segments.length,
    distinctOpportunities: extraction.distinctOpportunities,
    evidenceCounts: extraction.evidenceCounts,
    excludedRecords: extraction.excludedRecords,
  } as const;

  // Cheap exit: recurrence is impossible below the distinct-opportunity floor,
  // so never spend an LLM call that could only be discarded.
  if (extraction.distinctOpportunities < minDistinct) {
    return {
      telemetry: {
        ...baseTelemetry,
        hypothesesMined: 0,
        hypothesesSupported: 0,
        hypothesesRecurrent: 0,
        hypothesesDiscarded: 0,
      },
      hypotheses: [],
    };
  }

  const mined = await input.miner.mine(
    extraction.evidence,
    input.signal ? { signal: input.signal } : undefined,
  );

  const verification = verifyHypotheses(mined, extraction.evidence, minDistinct);

  return {
    telemetry: {
      ...baseTelemetry,
      hypothesesMined: mined.length,
      hypothesesSupported: verification.supported,
      hypothesesRecurrent: verification.recurrent,
      hypothesesDiscarded: verification.discarded,
    },
    hypotheses: verification.retained,
  };
}
