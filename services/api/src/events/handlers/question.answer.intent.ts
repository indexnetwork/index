/**
 * Intent-mode answer handler: refines an intent with the user's answer.
 *
 * Composes the answer into an update statement and runs it through the
 * intent graph in `update` mode — the exact same path the chat
 * `update_intent` tool uses (IND-393). The graph's reconciler merges the
 * new information into the existing description naturally (preserving
 * details, no mechanical "[Refined: ...]" markers), and the execution node
 * handles verification, payload sanitization, re-embedding, persistence,
 * and HyDE regeneration.
 *
 * When the graph does not apply an update (e.g. the answer fails semantic
 * verification as too vague), the intent is left untouched — the answer
 * remains stored on the question row.
 */

import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { log } from '../../lib/log';

const logger = log.service.from('QuestionAnswerIntent');

/** Explicit outcome returned to pool-answer chaining and other callers. */
export type IntentRefinementResult =
  | { applied: false }
  | { applied: true; payload: string; summary: string | null };

export interface IntentRefinementDeps {
  getIntent: (intentId: string) => Promise<{
    id: string;
    userId: string;
    description: string;
    summary?: string | null;
    status: string;
  } | null>;
  /** Fetch the clarifying question's prompt text for update context. Null when unavailable. */
  getQuestionPrompt: (questionId: string) => Promise<string | null>;
  /** Fetch the user's profile as a JSON string ('' when absent). */
  getUserProfile: (userId: string) => Promise<string>;
  /**
   * Run the intent graph in `update` mode (same path as the chat
   * `update_intent` tool). Returns whether an update action was applied.
   */
  runIntentUpdate: (input: {
    userId: string;
    userProfile: string;
    inputContent: string;
    targetIntentIds: string[];
  }) => Promise<{ applied: false } | { applied: true; payload: string }>;
}

/**
 * Compose the answer into a first-person update statement the intent
 * graph's inferrer/reconciler can process, referencing the target intent
 * so reconciliation matches it.
 */
function buildUpdateContent(
  description: string,
  question: string | null,
  selectedOptions: string[],
  freeText?: string,
): string {
  const parts = selectedOptions.join('; ');
  const trimmed = freeText?.trim();
  const answer = parts && trimmed ? `${parts}. ${trimmed}` : (trimmed || parts);

  const questionPart = question
    ? `When asked "${question}", I answered: ${answer}`
    : `Additional detail: ${answer}`;

  return `Refine my existing intent "${description}". ${questionPart}`;
}

export function enqueueIntentRefinementFactory(deps: IntentRefinementDeps) {
  return async (input: {
    userId: string;
    intentId: string;
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    expectedIntentFingerprint?: string;
  }): Promise<IntentRefinementResult> => {
    const intent = await deps.getIntent(input.intentId);

    if (!intent) {
      logger.warn('Intent not found for refinement', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return { applied: false };
    }

    if (intent.userId !== input.userId) {
      logger.warn('Intent owner mismatch — skipping refinement', {
        intentId: input.intentId,
        intentOwner: intent.userId,
        answerer: input.userId,
      });
      return { applied: false };
    }

    if (intent.status !== 'active') {
      logger.verbose('Intent is not active — skipping refinement', {
        intentId: input.intentId,
        status: intent.status,
      });
      return { applied: false };
    }

    if (
      input.expectedIntentFingerprint
      && computeIntentFingerprint(intent.description, intent.summary) !== input.expectedIntentFingerprint
    ) {
      logger.verbose('Recovery answer fingerprint drifted — skipping refinement', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return { applied: false };
    }

    const hasContent = input.selectedOptions.length > 0 || !!input.freeText?.trim();
    if (!hasContent) {
      logger.warn('Empty answer content — skipping intent refinement', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return { applied: false };
    }

    const [questionPrompt, userProfile] = await Promise.all([
      deps.getQuestionPrompt(input.questionId),
      deps.getUserProfile(input.userId),
    ]);

    const inputContent = buildUpdateContent(
      intent.description,
      questionPrompt,
      input.selectedOptions,
      input.freeText,
    );

    const update = await deps.runIntentUpdate({
      userId: input.userId,
      userProfile,
      inputContent,
      targetIntentIds: [input.intentId],
    });

    if (!update.applied) {
      // By design: e.g. the answer failed semantic verification as too
      // vague. The intent stays untouched; the answer remains on the
      // question row.
      logger.warn('Intent graph did not apply the refinement update', {
        intentId: input.intentId,
        questionId: input.questionId,
      });
      return { applied: false };
    }

    logger.info('Intent refined via intent graph', {
      intentId: input.intentId,
      userId: input.userId,
      questionId: input.questionId,
    });
    return {
      applied: true,
      payload: update.payload,
      summary: intent.summary ?? null,
    };
  };
}
