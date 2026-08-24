import { isSafeAgentMessageProse } from '@indexnetwork/protocol';

import type { AdapterNegotiationQuestionProvenance, AdapterQuestionDetection } from '../../adapters/questioner.adapter';

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
 * Text-level gate for question-message content (the conversational-questions
 * delivery spine). The same gate the PersonalAgent's own prose passes — one
 * definition, in the protocol, for every piece of agent-authored copy.
 */
export const isSafeQuestionMessageProse = isSafeAgentMessageProse;

/**
 * Question prompts additionally reject named-person claims — a prompt is one
 * short question, so the pattern's false-positive surface is small, and a
 * prompt naming a person is exactly the leak the park-time gate closes.
 */
export function isSafeQuestionMessagePrompt(text: string): boolean {
  return isSafeQuestionMessageProse(text) && !NAMED_PERSON_CLAIM_PATTERN.test(text);
}
