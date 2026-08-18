import { hasUnsupportedOpportunityClaim } from '@indexnetwork/protocol';

import type { AdapterNegotiationQuestionProvenance, AdapterQuestionDetection } from '../../adapters/questioner.adapter';

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
