/**
 * Lens C in-place evidence extraction (IND-433).
 *
 * Reads raw negotiation segments and projects ONLY the allowlist:
 *   - authoritative owner answers (answerer === recipient),
 *   - structured bilateral actions and coarse outcomes,
 *   - explicitly shared (tagged) message content.
 *
 * Everything else is dropped by construction. The function is pure and
 * deterministic so adversarial fixtures can prove that every excluded source
 * and every recipient / intent / opportunity / network / task / speaker
 * mismatch is rejected, and that same-pair continuations cannot inflate the
 * distinct-opportunity count.
 */
import { NEGOTIATION_EVIDENCE_MAX_CONTENT_CHARS, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES } from "./negotiation-evidence.env.js";
import type { AllowlistedEvidence, EvidenceKind, EvidenceMiningScope, EvidenceSpeaker, RawEvidenceSegment } from "./negotiation-evidence.types.js";

/** Result of one extraction pass over a recipient+intent's segments. */
export interface ExtractionResult {
  /** Allowlisted evidence, grouped/deduped, one logical set per opportunity. */
  evidence: AllowlistedEvidence[];
  /** Distinct opportunities that produced at least one evidence unit. */
  distinctOpportunities: number;
  /** Candidate records rejected by allowlist / exclusion / provenance rules. */
  excludedRecords: number;
  /** Allowlisted evidence unit counts, by kind. */
  evidenceCounts: Record<EvidenceKind, number>;
}

const EMPTY_COUNTS = (): Record<EvidenceKind, number> => ({
  owner_answer: 0,
  bilateral_action: 0,
  coarse_outcome: 0,
  shared_message: 0,
});

/** Collapse whitespace + lowercase for dedup only (not for stored content). */
function dedupKey(kind: EvidenceKind, speaker: EvidenceSpeaker, content: string): string {
  return `${kind}\u0000${speaker}\u0000${content.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/** Bound + whitespace-normalize stored content. */
function boundContent(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, NEGOTIATION_EVIDENCE_MAX_CONTENT_CHARS);
}

/**
 * A segment matches the pass scope only when EVERY provenance field is exactly
 * equal. A single mismatch rejects the whole segment (cross-recipient,
 * cross-intent, cross-fingerprint, or cross-network contamination).
 */
function segmentMatchesScope(segment: RawEvidenceSegment, scope: EvidenceMiningScope): boolean {
  return (
    segment.recipientUserId === scope.recipientUserId &&
    segment.intentId === scope.intentId &&
    segment.intentFingerprint === scope.intentFingerprint &&
    segment.networkId === scope.networkId
  );
}

/** Map a turn sender to owner/counterparty, or null when it is neither. */
function mapSpeaker(senderUserId: string, segment: RawEvidenceSegment): EvidenceSpeaker | null {
  if (senderUserId === segment.recipientUserId) return "owner";
  if (senderUserId === segment.counterpartyUserId) return "counterparty";
  return null;
}

/** Count every raw record a segment carries (for excluded-record accounting). */
function countSegmentRecords(segment: RawEvidenceSegment): number {
  let n = segment.turns.length + (segment.ownerAnswers?.length ?? 0);
  if (segment.outcome) n += 1;
  return n;
}

/**
 * Extract allowlisted evidence for one (recipient, intent) mining scope.
 *
 * Continuation grouping: segments are grouped by `opportunityId`; a single
 * opportunity contributes ONE deduped evidence set regardless of how many
 * continuation tasks it spans, so an opportunity counts once toward recurrence.
 *
 * Contamination guard: a segment whose recipient / intent / fingerprint /
 * network do not match the scope, or whose own recipient equals its
 * counterparty, is rejected wholesale (all records counted as excluded).
 */
export function extractAllowlistedEvidence(
  scope: EvidenceMiningScope,
  segments: RawEvidenceSegment[],
): ExtractionResult {
  const evidenceCounts = EMPTY_COUNTS();
  let excludedRecords = 0;

  // Group in-scope segments by opportunity (continuation grouping).
  const byOpportunity = new Map<string, RawEvidenceSegment[]>();
  for (const segment of segments) {
    if (!segmentMatchesScope(segment, scope) || segment.recipientUserId === segment.counterpartyUserId) {
      excludedRecords += countSegmentRecords(segment);
      continue;
    }
    const group = byOpportunity.get(segment.opportunityId);
    if (group) group.push(segment);
    else byOpportunity.set(segment.opportunityId, [segment]);
  }

  const evidence: AllowlistedEvidence[] = [];
  let distinctOpportunities = 0;

  for (const [opportunityId, group] of byOpportunity) {
    if (distinctOpportunities >= NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES) {
      // Cap opportunities per pass; remaining segments simply are not mined.
      excludedRecords += group.reduce((n, s) => n + countSegmentRecords(s), 0);
      continue;
    }

    const seen = new Set<string>();
    const opportunityEvidence: Array<{
      kind: EvidenceKind;
      speaker: EvidenceSpeaker;
      content: string;
      taskId: string;
      conversationId: string;
    }> = [];

    const push = (
      segment: RawEvidenceSegment,
      kind: EvidenceKind,
      speaker: EvidenceSpeaker,
      rawContent: string,
    ): boolean => {
      const content = boundContent(rawContent);
      if (content.length === 0) return false;
      const key = dedupKey(kind, speaker, content);
      if (seen.has(key)) return true; // duplicate continuation content retains its first source
      seen.add(key);
      opportunityEvidence.push({
        kind,
        speaker,
        content,
        taskId: segment.taskId,
        conversationId: segment.conversationId,
      });
      return true;
    };

    for (const segment of group) {
      // Authoritative owner answers — answerer MUST be the recipient.
      for (const answer of segment.ownerAnswers ?? []) {
        if (answer.answererUserId !== segment.recipientUserId) {
          excludedRecords += 1;
          continue;
        }
        const parts = [...answer.selectedOptions, ...(answer.freeText ? [answer.freeText] : [])];
        const content = parts.join(" | ");
        if (!push(segment, "owner_answer", "owner", content)) excludedRecords += 1;
      }

      // Turns → structured bilateral action + explicitly shared message.
      for (const turn of segment.turns) {
        const speaker = mapSpeaker(turn.senderUserId, segment);
        if (speaker === null) {
          // Speaker mismatch: neither owner nor counterparty. Nothing from
          // this turn (action AND message) may be trusted.
          excludedRecords += 1;
          continue;
        }
        // Structured bilateral action (label only; reasoning never read).
        const action = turn.action?.trim();
        if (action) push(segment, "bilateral_action", "system", action);

        // Explicitly shared message content only. Untagged → excluded.
        const message = turn.message?.trim();
        if (message) {
          if (turn.sharedTagged === true) push(segment, "shared_message", speaker, message);
          else excludedRecords += 1;
        }
      }

      // Coarse outcome. `screened_out` is a private client gate → excluded.
      const outcome = segment.outcome;
      if (outcome) {
        if (outcome.reason === "screened_out") {
          excludedRecords += 1;
        } else {
          const roles = (outcome.agreedRoles ?? [])
            .map((r) => `${r.role}`)
            .sort()
            .join(",");
          const content = [
            `hasOpportunity=${outcome.hasOpportunity}`,
            outcome.reason ? `reason=${outcome.reason}` : "",
            roles ? `roles=${roles}` : "",
          ]
            .filter(Boolean)
            .join(" ");
          push(segment, "coarse_outcome", "system", content);
        }
      }
    }

    if (opportunityEvidence.length === 0) continue;

    distinctOpportunities += 1;
    const first = group[0];
    opportunityEvidence.forEach((e, ordinal) => {
      evidenceCounts[e.kind] += 1;
      evidence.push({
        evidenceId: `${e.kind}:${opportunityId}:${ordinal}`,
        kind: e.kind,
        speaker: e.speaker,
        content: e.content,
        recipientUserId: first.recipientUserId,
        intentId: first.intentId,
        intentFingerprint: first.intentFingerprint,
        opportunityId,
        taskId: e.taskId,
        conversationId: e.conversationId,
        networkId: first.networkId,
      });
    });
  }

  return { evidence, distinctOpportunities, excludedRecords, evidenceCounts };
}
