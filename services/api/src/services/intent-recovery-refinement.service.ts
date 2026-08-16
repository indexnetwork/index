import { QuestionerAgent, intentQuestionDailyCap, type QuestionGenerationResult, type QuestionerInput } from '@indexnetwork/protocol';

import { QuestionerAdapter, type AdapterPersistableQuestion, type RecoveryOpportunitySnapshot } from '../adapters/questioner.adapter';
import { chatDatabaseAdapter } from '../adapters/database.adapter';
import { QuestionEvents } from '../events/question.event';
import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { hasValidatedRejectedNoOpportunityEvidence, type RecoveryEvidenceArtifact, type RecoveryEvidenceTask } from '../lib/questioner/recovery-evidence';

const MAX_REJECTED_EVIDENCE_OPPORTUNITIES = 50;
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
  source: 'intent_creation' | 'from_intent' | 'discovery_run';
  recipientUserId: string;
  intentId: string;
  runId?: string;
}

interface RecoveryServiceDeps {
  adapter?: Pick<QuestionerAdapter, 'prepareRecoveryRefinement' | 'persistFreshRecoveryQuestion'>;
  getNegotiationTasksForOpportunity?: typeof chatDatabaseAdapter.getNegotiationTasksForOpportunity;
  getArtifactsForTask?: typeof chatDatabaseAdapter.getArtifactsForTask;
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

function boundedRunId(runId: string | undefined): string | undefined {
  const normalized = runId?.trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

/**
 * Generates and persists one privacy-safe intent refinement for each material
 * intent version. Intent creation and both authoritative discovery paths share
 * this service so the intent-page Personal Agent receives the same ordinary
 * clarification regardless of which producer reached the intent first.
 * Raw opportunity/task/artifact evidence is reduced to a bounded integer before
 * the QuestionerAgent is invoked and is never copied into persistence.
 */
export class IntentRecoveryRefinementService {
  private readonly logger = log.service.from('IntentRecoveryRefinement');
  private readonly adapter: Pick<QuestionerAdapter, 'prepareRecoveryRefinement' | 'persistFreshRecoveryQuestion'>;
  private readonly getNegotiationTasksForOpportunity: typeof chatDatabaseAdapter.getNegotiationTasksForOpportunity;
  private readonly getArtifactsForTask: typeof chatDatabaseAdapter.getArtifactsForTask;
  private readonly getGlobalUserContext: (userId: string) => Promise<string>;
  private readonly generateOverride?: RecoveryServiceDeps['generate'];
  private readonly onCreated: typeof QuestionEvents.onCreated;
  private agent: QuestionerAgent | null = null;

  constructor(deps?: RecoveryServiceDeps) {
    this.adapter = deps?.adapter ?? new QuestionerAdapter(db);
    this.getNegotiationTasksForOpportunity = deps?.getNegotiationTasksForOpportunity
      ?? chatDatabaseAdapter.getNegotiationTasksForOpportunity.bind(chatDatabaseAdapter);
    this.getArtifactsForTask = deps?.getArtifactsForTask
      ?? chatDatabaseAdapter.getArtifactsForTask.bind(chatDatabaseAdapter);
    this.getGlobalUserContext = deps?.getGlobalUserContext
      ?? (async (userId) => (await chatDatabaseAdapter.getUserContext(userId, null))?.text ?? '');
    this.generateOverride = deps?.generate;
    this.onCreated = deps?.onCreated ?? ((payload) => QuestionEvents.onCreated(payload));
  }

  /**
   * Process one intent-creation or authoritative-discovery surfacing trigger.
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

    const rejectedNegotiationCount = await this.countValidatedRejectedNegotiations(
      prepared.opportunities,
      completion.recipientUserId,
      completion.intentId,
      prepared.intent.intentFingerprint,
    );
    const userContext = await this.getGlobalUserContext(completion.recipientUserId);
    const sharedContext = {
      intentId: completion.intentId,
      payload: prepared.intent.payload,
      ...(prepared.intent.summary ? { summary: prepared.intent.summary } : {}),
      ...(userContext.trim() ? { userContext: userContext.trim() } : {}),
    };
    const input: QuestionerInput = completion.source === 'intent_creation'
      ? {
          mode: 'intent',
          userId: completion.recipientUserId,
          sourceType: 'intent',
          sourceId: completion.intentId,
          triggeredByIntentId: completion.intentId,
          context: sharedContext,
        }
      : {
          mode: 'intent',
          purpose: 'recovery',
          userId: completion.recipientUserId,
          sourceType: 'intent',
          sourceId: completion.intentId,
          triggeredByIntentId: completion.intentId,
          context: {
            ...sharedContext,
            purpose: 'recovery',
            ...(rejectedNegotiationCount > 0 ? { rejectedNegotiationCount } : {}),
          },
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
    const runId = boundedRunId(completion.runId);
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
          ...(rejectedNegotiationCount > 0 ? { rejectedNegotiationCount } : {}),
          ...(runId ? { runId } : {}),
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
      rejectedNegotiationCount,
    });
    return questionId;
  }

  private async generate(input: QuestionerInput): Promise<QuestionGenerationResult | null> {
    if (this.generateOverride) return this.generateOverride(input);
    this.agent ??= new QuestionerAgent();
    return this.agent.invoke(input);
  }

  private async countValidatedRejectedNegotiations(
    opportunities: RecoveryOpportunitySnapshot[],
    recipientUserId: string,
    intentId: string,
    currentIntentFingerprint: string,
  ): Promise<number> {
    const rejected = opportunities
      .filter((opportunity) => opportunity.status === 'rejected')
      .slice(0, MAX_REJECTED_EVIDENCE_OPPORTUNITIES);
    if (rejected.length === 0) return 0;

    try {
      let count = 0;
      for (const opportunity of rejected) {
        const tasks = await this.getNegotiationTasksForOpportunity(opportunity.id) as RecoveryEvidenceTask[];
        const artifactsByTaskId = new Map<string, RecoveryEvidenceArtifact[]>();
        for (const task of tasks) {
          artifactsByTaskId.set(task.id, await this.getArtifactsForTask(task.id));
        }
        if (hasValidatedRejectedNoOpportunityEvidence({
          opportunity,
          tasks,
          artifactsByTaskId,
          recipientUserId,
          intentId,
          currentIntentFingerprint,
        })) count++;
      }
      return Math.min(count, MAX_REJECTED_EVIDENCE_OPPORTUNITIES);
    } catch {
      // Partial evidence is not authoritative. Fall back to source-only context.
      return 0;
    }
  }
}
