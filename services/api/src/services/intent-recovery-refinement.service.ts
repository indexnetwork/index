import { QuestionerAgent, canUserSeeOpportunity, isActionableForViewer, type QuestionGenerationResult, type RecoveryQuestionerInput } from '@indexnetwork/protocol';

import { QuestionerAdapter, type AdapterPersistableQuestion, type RecoveryOpportunitySnapshot } from '../adapters/questioner.adapter';
import { chatDatabaseAdapter } from '../adapters/database.adapter';
import { QuestionEvents } from '../events/question.event';
import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { hasValidatedRejectedNoOpportunityEvidence, type RecoveryEvidenceArtifact, type RecoveryEvidenceTask } from '../lib/questioner/recovery-evidence';

const MAX_REJECTED_EVIDENCE_OPPORTUNITIES = 50;
const UNSAFE_RECOVERY_COPY = /\b(no matches?|could(?:n't| not) find|did not find|previous (?:attempt|run)|reject(?:ed|ion|ions)?|negotiat(?:e|ed|ion|ions|ing)?|candidates?|counterpart(?:y|ies)|search results?|pipeline|retry|reviewed)\b|\b\d+\s+(?:matches|candidates|rejections|negotiations|outcomes)\b/i;

export interface IntentRecoveryCompletion {
  source: 'from_intent' | 'discovery_run';
  recipientUserId: string;
  intentId: string;
  runId?: string;
}

interface RecoveryServiceDeps {
  adapter?: Pick<QuestionerAdapter, 'prepareRecoveryRefinement' | 'persistFreshRecoveryQuestion'>;
  getNegotiationTasksForOpportunity?: typeof chatDatabaseAdapter.getNegotiationTasksForOpportunity;
  getArtifactsForTask?: typeof chatDatabaseAdapter.getArtifactsForTask;
  getGlobalUserContext?: (userId: string) => Promise<string>;
  generate?: (input: RecoveryQuestionerInput) => Promise<QuestionGenerationResult | null>;
  onCreated?: typeof QuestionEvents.onCreated;
}

/** Canonical read + actionability policy used by both preparation and final persistence. */
export function isRecoverySuppressingOpportunity(
  opportunity: RecoveryOpportunitySnapshot,
  userId: string,
): boolean {
  return canUserSeeOpportunity(opportunity.actors, opportunity.status, userId)
    && isActionableForViewer(opportunity.actors, opportunity.status, userId);
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  if (candidate.code === '23505') return true;
  return typeof candidate.cause === 'object'
    && candidate.cause !== null
    && (candidate.cause as { code?: unknown }).code === '23505';
}

function boundedRunId(runId: string | undefined): string | undefined {
  const normalized = runId?.trim();
  return normalized ? normalized.slice(0, 128) : undefined;
}

/**
 * Generates and persists one privacy-safe post-discovery intent refinement.
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
    this.onCreated = deps?.onCreated ?? QuestionEvents.onCreated;
  }

  /**
   * Process one successful authoritative discovery completion.
   * @param completion - Exact recipient, intent, and completion provenance.
   * @returns The inserted question id, or null when policy safely skips.
   */
  async recover(completion: IntentRecoveryCompletion): Promise<string | null> {
    const prepared = await this.adapter.prepareRecoveryRefinement(
      completion.recipientUserId,
      completion.intentId,
    );
    if (!prepared || prepared.hasCadenceAnchor) return null;
    if (prepared.opportunities.some((opportunity) =>
      isRecoverySuppressingOpportunity(opportunity, completion.recipientUserId))) {
      return null;
    }

    const rejectedNegotiationCount = await this.countValidatedRejectedNegotiations(
      prepared.opportunities,
      completion.recipientUserId,
      completion.intentId,
      prepared.intent.intentFingerprint,
    );
    const userContext = await this.getGlobalUserContext(completion.recipientUserId);
    const input: RecoveryQuestionerInput = {
      mode: 'intent',
      purpose: 'recovery',
      userId: completion.recipientUserId,
      sourceType: 'intent',
      sourceId: completion.intentId,
      triggeredByIntentId: completion.intentId,
      context: {
        purpose: 'recovery',
        intentId: completion.intentId,
        payload: prepared.intent.payload,
        ...(prepared.intent.summary ? { summary: prepared.intent.summary } : {}),
        ...(userContext.trim() ? { userContext: userContext.trim() } : {}),
        ...(rejectedNegotiationCount > 0 ? { rejectedNegotiationCount } : {}),
      },
    };

    const result = await this.generate(input);
    if (!result) return null;
    const selectedIndex = result.questions.findIndex((question, index) => {
      const strategy = result.strategies[index];
      return (strategy === 'refine_intent' || strategy === 'surface_missing_detail')
        && !question.evidence
        && !UNSAFE_RECOVERY_COPY.test(question.prompt);
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
        isRecoverySuppressingOpportunity,
      );
    } catch (error) {
      if (isUniqueViolation(error)) return null;
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

  private async generate(input: RecoveryQuestionerInput): Promise<QuestionGenerationResult | null> {
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
