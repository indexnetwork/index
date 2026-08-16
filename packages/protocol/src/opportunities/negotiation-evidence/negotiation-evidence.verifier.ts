/**
 * Lens C support-reference verification + recurrence gate (IND-433).
 *
 * A mined hypothesis is retained ONLY when:
 *   1. it carries at least one support reference,
 *   2. EVERY support reference resolves to an allowlisted evidence unit in
 *      this pass AND quotes a verbatim span of that unit's content,
 *   3. the speaker constraint holds — a claim that is a fact or preference
 *      ABOUT the recipient may never rest on a counterparty statement, and
 *   4. its verified support spans at least `minDistinctOpportunities` DISTINCT
 *      opportunities (recurrence). Continuations were already grouped upstream,
 *      so same-pair repetition cannot inflate this.
 *
 * Any failure discards the whole hypothesis — there is no partial retention.
 */
import type { AllowlistedEvidence, HypothesisClaimType, MinedEvidenceHypothesis, RetainedEvidenceHypothesis, VerifiedSupportRef } from "./negotiation-evidence.types.js";

/** Result of verifying a batch of mined hypotheses. */
export interface VerificationResult {
  /** Hypotheses that passed verification AND the recurrence gate. */
  retained: RetainedEvidenceHypothesis[];
  /** Hypotheses whose every support ref verified (pre-recurrence). */
  supported: number;
  /** Supported hypotheses that also met the distinct-opportunity floor. */
  recurrent: number;
  /** Hypotheses discarded for any reason (mined − recurrent). */
  discarded: number;
}

/** Minimum normalized span length that counts as meaningful verbatim evidence. */
const MIN_SPAN_CHARS = 8;

/** Lowercase, fold typographic punctuation, collapse whitespace. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip wrapping quotes / edge punctuation the LLM habitually adds. */
function stripEdgePunctuation(s: string): string {
  return s
    .replace(/^[\s"'.,;:!?()\u2018\u2019\u201c\u201d]+/, "")
    .replace(/[\s"'.,;:!?()\u2018\u2019\u201c\u201d]+$/, "");
}

/** True when `span` is a meaningful verbatim substring of `content`. */
export function evidenceSpanMatches(content: string, span: string): boolean {
  const haystack = normalizeForMatch(content);
  const needle = normalizeForMatch(stripEdgePunctuation(span));
  return needle.length >= MIN_SPAN_CHARS && haystack.includes(needle);
}

/**
 * A `recipient_fact` / `recipient_preference` claim must not lean on a
 * counterparty statement. `observation` claims accept any speaker.
 */
function speakerAllowedForClaim(claimType: HypothesisClaimType, evidence: AllowlistedEvidence): boolean {
  if (claimType === "observation") return true;
  return evidence.speaker !== "counterparty";
}

/**
 * Verify one hypothesis. Returns the verified support (deduped) when every
 * reference resolves and satisfies the speaker constraint; otherwise null.
 */
function verifyHypothesis(
  hypothesis: MinedEvidenceHypothesis,
  byId: Map<string, AllowlistedEvidence>,
): VerifiedSupportRef[] | null {
  if (hypothesis.supportRefs.length === 0) return null;

  const verified = new Map<string, VerifiedSupportRef>();
  for (const ref of hypothesis.supportRefs) {
    const evidence = byId.get(ref.evidenceId);
    if (!evidence) return null; // reference to non-allowlisted / hallucinated id
    if (!speakerAllowedForClaim(hypothesis.claimType, evidence)) return null;
    if (!evidenceSpanMatches(evidence.content, ref.span)) return null;
    verified.set(evidence.evidenceId, {
      evidenceId: evidence.evidenceId,
      kind: evidence.kind,
      speaker: evidence.speaker,
      opportunityId: evidence.opportunityId,
    });
  }
  return [...verified.values()];
}

/**
 * Verify + recurrence-gate a batch of mined hypotheses against the allowlisted
 * evidence produced for the same pass.
 */
export function verifyHypotheses(
  hypotheses: MinedEvidenceHypothesis[],
  evidence: AllowlistedEvidence[],
  minDistinctOpportunities: number,
): VerificationResult {
  const byId = new Map(evidence.map((e) => [e.evidenceId, e]));
  const retained: RetainedEvidenceHypothesis[] = [];
  let supported = 0;
  let recurrent = 0;

  for (const hypothesis of hypotheses) {
    const support = verifyHypothesis(hypothesis, byId);
    if (!support) continue;
    supported += 1;

    const distinctOpportunities = new Set(support.map((s) => s.opportunityId)).size;
    if (distinctOpportunities < minDistinctOpportunities) continue;
    recurrent += 1;

    retained.push({
      statement: hypothesis.statement,
      claimType: hypothesis.claimType,
      support,
      distinctOpportunities,
    });
  }

  return {
    retained,
    supported,
    recurrent,
    discarded: hypotheses.length - recurrent,
  };
}
