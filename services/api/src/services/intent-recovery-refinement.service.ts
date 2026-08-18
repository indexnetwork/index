import { QuestionerAgent, intentQuestionDailyCap, type QuestionGenerationResult, type QuestionerInput } from '@indexnetwork/protocol';

import { QuestionerAdapter, type AdapterPersistableQuestion } from '../adapters/questioner.adapter';
import { chatDatabaseAdapter } from '../adapters/database.adapter';
import { QuestionEvents } from '../events/question.event';
import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';

const RECOVERY_UNIQUE_CONSTRAINT = 'questions_recovery_recipient_intent_fingerprint_uniq';
const UNSAFE_RECOVERY_COPY = /\b(?:no\s+(?:matches?|results?)|could(?:n't| not)(?:\s+(?:we|you|they|the\s+system))?\s+find|did\s+not\s+find|previous\s+(?:attempt|run)|reject(?:ed|ion|ions)?|negotiat(?:e|ed|ion|ions|ing)?|candidates?|counterpart(?:y|ies)|search(?:ed|es|ing)?|search\s+results?|pipeline|retry|retried|reviewed|process(?:ed|es|ing)?|count(?:ed|s|ing)?|number\s+of|we\s+(?:found|checked|reviewed|searched|tried))\b|\b\d+\s+(?:matches|candidates|rejections|negotiations|outcomes|results)\b/i;

function normalizeVisibleRecoveryCopy(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"');
}

/** Reject a generated recovery question when any user-visible field narrates process/evidence. */
export function isSafeRecoveryQuestionCopy(
  question: Pick<AdapterPersistableQuestion['payload'], 'title' | 'prompt' | 'options'>,
): boolean {
  const visibleStrings = [
    question.title,
    question.prompt,
    ...question.options.flatMap((option) => [option.label, option.description]),
  ];
  return visibleStrings.every((value) => !UNSAFE_RECOVERY_COPY.test(normalizeVisibleRecoveryCopy(value)));
}

export interface IntentRecoveryCompletion {
  /**
   * Creation is the only remaining producer: the post-discovery recovery
   * trigger is retired (conversational-questions plan, "Retirements").
   */
  source: 'intent_creation';
  recipientUserId: string;
  intentId: string;
}

interface RecoveryServiceDeps {
  adapter?: Pick<QuestionerAdapter, 'prepareRecoveryRefinement' | 'persistFreshRecoveryQuestion'>;
  getGlobalUserContext?: (userId: string) => Promise<string>;
  generate?: (input: QuestionerInput) => Promise<QuestionGenerationResult | null>;
  onCreated?: typeof QuestionEvents.onCreated;
}

/** Match only the deliberate all-status recovery cadence unique constraint. */
export function isRecoveryQuestionUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof current !== 'object' || current === null) return false;
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (
      candidate.code === '23505'
      && candidate.constraint === RECOVERY_UNIQUE_CONSTRAINT
    ) return true;
    current = candidate.cause;
  }
  return false;
}

/**
 * Generates and persists one privacy-safe intent refinement for each material
 * intent version, triggered at intent creation. The post-discovery recovery
 * producers that used to share this service are retired.
 */
export class IntentRecoveryRefinementService {
  private readonly logger = log.service.from('IntentRecoveryRefinement');
  private readonly adapter: Pick<QuestionerAdapter, 'prepareRecoveryRefinement' | 'persistFreshRecoveryQuestion'>;
  private readonly getGlobalUserContext: (userId: string) => Promise<string>;
  private readonly generateOverride?: RecoveryServiceDeps['generate'];
  private readonly onCreated: typeof QuestionEvents.onCreated;
  private agent: QuestionerAgent | null = null;

  constructor(deps?: RecoveryServiceDeps) {
    this.adapter = deps?.adapter ?? new QuestionerAdapter(db);
    this.getGlobalUserContext = deps?.getGlobalUserContext
      ?? (async (userId) => (await chatDatabaseAdapter.getUserContext(userId, null))?.text ?? '');
    this.generateOverride = deps?.generate;
    this.onCreated = deps?.onCreated ?? ((payload) => QuestionEvents.onCreated(payload));
  }

  /**
   * Process one intent-creation surfacing trigger.
   * @param completion - Exact recipient, intent, and trigger provenance.
   * @returns The inserted question id, or null when policy safely skips.
   */
  async recover(completion: IntentRecoveryCompletion): Promise<string | null> {
    const prepared = await this.adapter.prepareRecoveryRefinement(
      completion.recipientUserId,
      completion.intentId,
      intentQuestionDailyCap(),
    );
    if (!prepared || prepared.hasCadenceAnchor) return null;

    const userContext = await this.getGlobalUserContext(completion.recipientUserId);
    const sharedContext = {
      intentId: completion.intentId,
      payload: prepared.intent.payload,
      ...(prepared.intent.summary ? { summary: prepared.intent.summary } : {}),
      ...(userContext.trim() ? { userContext: userContext.trim() } : {}),
    };
    const input: QuestionerInput = {
      mode: 'intent',
      userId: completion.recipientUserId,
      sourceType: 'intent',
      sourceId: completion.intentId,
      triggeredByIntentId: completion.intentId,
      context: sharedContext,
    };

    const result = await this.generate(input);
    if (!result) return null;
    const selectedIndex = result.questions.findIndex((question, index) => {
      const strategy = result.strategies[index];
      return (strategy === 'refine_intent' || strategy === 'surface_missing_detail')
        && !question.evidence
        && isSafeRecoveryQuestionCopy(question);
    });
    if (selectedIndex < 0) return null;

    const generated = result.questions[selectedIndex];
    const { evidence: _evidence, ...payload } = generated;
    const question: AdapterPersistableQuestion = {
      detection: {
        mode: 'intent',
        purpose: 'recovery',
        sourceType: 'intent',
        sourceId: completion.intentId,
        triggeredBy: completion.intentId,
        timestamp: new Date().toISOString(),
        recovery: {
          version: 1,
          intentFingerprint: prepared.intent.intentFingerprint,
          completionSource: completion.source,
        },
      },
      actors: [{ userId: completion.recipientUserId, role: 'subject' }],
      payload,
      strategy: result.strategies[selectedIndex],
      underspecificationType: result.underspecificationTypes[selectedIndex] ?? null,
    };

    let questionId: string | null;
    try {
      questionId = await this.adapter.persistFreshRecoveryQuestion(
        question,
        completion.recipientUserId,
        prepared.intent.intentFingerprint,
        intentQuestionDailyCap(),
      );
    } catch (error) {
      if (isRecoveryQuestionUniqueViolation(error)) return null;
      throw error;
    }
    if (!questionId) return null;

    this.onCreated({
      questionId,
      userId: completion.recipientUserId,
      mode: 'intent',
      sourceType: 'intent',
      sourceId: completion.intentId,
    });
    this.logger.info('Persisted recovery refinement question', {
      questionId,
      intentId: completion.intentId,
      userId: completion.recipientUserId,
      source: completion.source,
    });
    return questionId;
  }

  private async generate(input: QuestionerInput): Promise<QuestionGenerationResult | null> {
    if (this.generateOverride) return this.generateOverride(input);
    this.agent ??= new QuestionerAgent();
    return this.agent.invoke(input);
  }

}
