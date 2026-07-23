import { hasUnsupportedOpportunityClaim } from '../opportunity/opportunity.claim-safety.js';

/** Fixed prompt-safe labels; producers must not replace them with raw network/counterparty text. */
export const NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY = 'the other participant';
export const NEGOTIATION_QUESTION_GENERIC_NETWORK = 'the selected network';
export const NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY = 'a potential collaboration that may require clarification before you decide';

const INTERNAL_ID_PATTERN = /\b(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?:task|intent|network|opportunity|user|match)[_-]?id)\b/i;
const PRIVATE_SOURCE_PATTERN = /\b(?:private transcript|raw transcript|assessment(?:\.reasoning)?|seed assessment|evaluator reasoning|match reason|matchReason|internal metadata|counterparty profile)\b/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Deterministically reject question context copied from private negotiation inputs.
 * This guard never rewrites content: unsafe or ambiguous text yields no card while
 * the already-armed timeout retains the conservative continuation path.
 */
export function isSafeNegotiationQuestionText(
  value: string,
  options?: {
    forbiddenIdentifiers?: string[];
    forbiddenSourceText?: string[];
  },
): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 600) return false;
  if (INTERNAL_ID_PATTERN.test(trimmed) || PRIVATE_SOURCE_PATTERN.test(trimmed)) return false;
  if (hasUnsupportedOpportunityClaim(trimmed)) return false;

  const normalized = normalize(trimmed);
  for (const identifier of options?.forbiddenIdentifiers ?? []) {
    const forbidden = normalize(identifier);
    if (forbidden.length >= 3 && new RegExp(`(?:^| )${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: |$)`).test(normalized)) {
      return false;
    }
  }
  for (const source of options?.forbiddenSourceText ?? []) {
    const forbidden = normalize(source);
    if (forbidden.length >= 24 && (normalized.includes(forbidden) || forbidden.includes(normalized))) {
      return false;
    }
  }
  return true;
}

/** Validate the only structured fields allowed to enter the inflight Questioner prompt. */
export function validateInflightAskUserFields(input: {
  disclosureSubject?: string | null;
  draftQuestion?: string | null;
  forbiddenIdentifiers?: string[];
  forbiddenSourceText?: string[];
}): { disclosureSubject: string; draftQuestion?: string } | null {
  const disclosureSubject = input.disclosureSubject?.trim();
  if (!disclosureSubject || !isSafeNegotiationQuestionText(disclosureSubject, input)) return null;
  const draftQuestion = input.draftQuestion?.trim();
  if (draftQuestion && !isSafeNegotiationQuestionText(draftQuestion, input)) return null;
  return {
    disclosureSubject,
    ...(draftQuestion ? { draftQuestion } : {}),
  };
}

/** Stable, non-secret settlement/outbox key derived only from the exact paused task. */
export function negotiationQuestionSettlementId(taskId: string): string {
  return `negotiation-question-settlement-v1-${taskId}`;
}
