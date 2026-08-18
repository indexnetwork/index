import type { StructuredQuestion } from '../shared/schemas/structured-question.schema.js';
import { hasUnsupportedOpportunityClaim } from '../shared/utils/claim-safety.js';

/** Fixed prompt-safe labels; producers must not replace them with raw network/counterparty text. */
export const NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY = 'the other participant';
export const NEGOTIATION_QUESTION_GENERIC_NETWORK = 'the selected network';

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

/**
 * Instruction-shaped text that must never survive into a rendered question.
 *
 * Applies ONLY to `isSafeAuthoredNegotiationQuestion` — deliberately not added
 * to `isSafeNegotiationQuestionText`, which guards a live path whose verdicts
 * must not move. The exposure is specific to the authored question: the client
 * reads these strings verbatim on a card, and whatever they select comes BACK
 * into the negotiator's prompt as a user answer. An option labelled "ignore
 * previous instructions" is therefore a round-trip injection with a human
 * clicking the button.
 *
 * Two families. Override phrasings ("ignore the above", "you are now a…"), and
 * forged structure: role headers and the `--- section ---` delimiter this
 * codebase actually uses to fence prompt sections (see
 * `renderNegotiatorClientDmSection`), which is what a forged block would have
 * to imitate to be read as one.
 */
const PROMPT_INJECTION_PATTERN = /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(?:instructions?|prompts?|rules?|directives?|guidelines?|everything\s+above|the\s+above|all\s+of\s+the\s+above)\b|\byou\s+are\s+now\s+(?:an?|the)\b|\bnew\s+instructions?\s*:|^\s*(?:#{1,6}\s*|\*{2}\s*)?(?:system|assistant|developer|human)\s*:|<\|[^|>]{0,40}\|>|\[\/?(?:INST|SYS)\]|^\s*-{3,}[^\n]*-{3,}\s*$/im;

/**
 * Whole-question gate for a question the NEGOTIATOR authored.
 *
 * The pre-A2H `disclosureSubject` never reached the client as written — the
 * server templated the copy around it. An authored `StructuredQuestion` is
 * rendered verbatim, so every visible field needs the same gate the subject
 * got, and it needs it with the identifiers in hand.
 *
 * That is the capability the api-side `isSafeNegotiationQuestionPayload` lacks
 * and cannot gain: at the DB boundary it holds only generic patterns, so it
 * cannot tell that a perfectly well-formed question is naming THIS counterparty
 * or paraphrasing THIS seed assessment. The turn node has both, which is why
 * this runs here and not there.
 *
 * Fail-closed and non-rewriting, like every guard in this file: a caller that
 * gets `false` drops the question and keeps the enum-only path, rather than
 * shipping a repaired one.
 *
 * @param options.forbiddenIdentifiers Names that must not appear as words —
 *        the counterparty's, at the call site.
 * @param options.forbiddenSourceText Private inputs that must not be echoed —
 *        the seed assessment's reasoning, at the call site.
 */
export function isSafeAuthoredNegotiationQuestion(
  question: StructuredQuestion | null | undefined,
  options?: {
    forbiddenIdentifiers?: string[];
    forbiddenSourceText?: string[];
  },
): boolean {
  if (!question || typeof question !== 'object') return false;
  // Re-checked rather than trusted from the schema: this gate also runs on
  // turns that arrive from an external agent, and a rendered card with one
  // option (or fifteen) is a broken card regardless of how it validated.
  const questionOptions = question.options;
  if (!Array.isArray(questionOptions) || questionOptions.length < 2 || questionOptions.length > 4) return false;

  const fields = [
    question.title,
    question.prompt,
    ...questionOptions.flatMap((option) => [option?.label, option?.description]),
  ];
  for (const field of fields) {
    if (typeof field !== 'string') return false;
    if (!isSafeNegotiationQuestionText(field, options)) return false;
    if (PROMPT_INJECTION_PATTERN.test(field)) return false;
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
