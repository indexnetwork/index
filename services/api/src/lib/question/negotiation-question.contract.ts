import { hasUnsupportedOpportunityClaim } from '@indexnetwork/protocol';

import type { AdapterNegotiationQuestionProvenance, AdapterQuestionDetection, AdapterQuestionPayload } from '../../adapters/questioner.adapter';

const INTERNAL_OR_PRIVATE_PATTERN = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:task|intent|network|opportunity|user|match)[_-]?id|private transcript|raw transcript|assessment(?:\.reasoning)?|seed assessment|evaluator reasoning|match reason|matchReason|internal metadata|counterparty profile)\b/i;
const NAMED_PERSON_CLAIM_PATTERN = /\b[A-Z][a-z]{2,}(?:'s| is| has| wants| needs| can| profile)\b/;

/** Runtime mirror of the protocol mode/purpose invariant at the final DB boundary. */
export function isValidNegotiationDetectionContract(
  detection: AdapterQuestionDetection,
  provenance: AdapterNegotiationQuestionProvenance,
): boolean {
  if (detection.purpose !== provenance.purpose) return false;
  if (detection.sourceType !== 'opportunity' || detection.sourceId !== provenance.opportunityId) return false;
  if (provenance.purpose === 'inflight_consultation') {
    return detection.mode === 'negotiation_inflight' && Boolean(provenance.taskId);
  }
  if (provenance.purpose === 'stalled_followup') {
    return detection.mode === 'negotiation' && Boolean(provenance.taskId);
  }
  return detection.mode === 'negotiation' && provenance.taskId === undefined;
}

/** Every visible generated field must pass this deterministic fail-closed gate. */
export function isSafeNegotiationQuestionPayload(payload: AdapterQuestionPayload): boolean {
  if (payload.evidence !== undefined) return false;
  const fields = [
    payload.title,
    payload.prompt,
    ...payload.options.flatMap((option) => [option.label, option.description]),
  ];
  if (fields.some((field) => {
    if (!field.trim() || INTERNAL_OR_PRIVATE_PATTERN.test(field) || hasUnsupportedOpportunityClaim(field)) return true;
    return NAMED_PERSON_CLAIM_PATTERN.test(field);
  })) return false;
  return payload.options.length >= 2 && payload.options.length <= 4;
}

/**
 * Text-level gate for negotiator-authored question-message content (the
 * conversational-questions delivery spine). Prose renders as chat copy, so it
 * is held to the internal-leak and unsupported-claim patterns; the
 * named-person pattern is skipped because ordinary sentences ("This is …")
 * trip it, and the message author never receives counterparty identity.
 */
export function isSafeQuestionMessageProse(text: string): boolean {
  return Boolean(text.trim())
    && !INTERNAL_OR_PRIVATE_PATTERN.test(text)
    && !hasUnsupportedOpportunityClaim(text);
}

/**
 * Question prompts additionally reject named-person claims — a prompt is one
 * short question, so the pattern's false-positive surface is small, and a
 * prompt naming a person is exactly the leak the park-time gate closes.
 */
export function isSafeQuestionMessagePrompt(text: string): boolean {
  return isSafeQuestionMessageProse(text) && !NAMED_PERSON_CLAIM_PATTERN.test(text);
}

/** Pure terminal-state contract for answered/dismissed historical rows. */
export function derivePendingQuestionCounts(rows: Array<{
  detection: { mode: string; pushedAt?: string };
}>): { globalPending: number; pushedPoolPending: number; personalAgentPending: number } {
  const globalPending = rows.filter((row) => row.detection.mode !== 'pool_discovery').length;
  const pushedPoolPending = rows.filter((row) =>
    row.detection.mode === 'pool_discovery' && Boolean(row.detection.pushedAt)).length;
  return { globalPending, pushedPoolPending, personalAgentPending: globalPending + pushedPoolPending };
}

export function isExpectedHistoricalNegotiationSettlement(
  status: 'pending' | 'answered' | 'dismissed',
  questionId: string,
  value: unknown,
): boolean {
  if (!value || typeof value !== 'object') return false;
  const settlement = value as Record<string, unknown>;
  if (
    settlement.version !== 1
    || typeof settlement.taskId !== 'string'
    || settlement.settlementId !== `negotiation-question-settlement-v1-${settlement.taskId}`
    || (settlement.continuationStatus !== 'requested' && settlement.continuationStatus !== 'completed')
  ) return false;
  if (status === 'answered') return settlement.kind === 'answer' && settlement.questionId === questionId;
  if (status === 'dismissed') return settlement.kind === 'dismiss' && settlement.questionId === questionId;
  return false;
}
