/**
 * Failure-isolated newborn opportunity preference stamping (IND-420 P4b).
 * Runs synchronously inside the protocol graph immediately before persistence.
 */
import { POOL_DISCRIMINATOR_MAX_CANDIDATES, PoolDiscriminatorAssigner, buildPoolAdjustment, mergePoolAdjustment, poolQuestionsMode, poolQuestionsStampNewborn } from '@indexnetwork/protocol';
import type { CreateOpportunityData, PoolDiscriminatorAssignedAxis, PoolDiscriminatorAssignmentInput, StampNewbornOpportunitiesFn } from '@indexnetwork/protocol';

import db from '../../lib/drizzle/drizzle';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { log } from '../../lib/log';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { QuestionerAdapter } from '../../adapters/questioner.adapter';
import type { AnsweredPoolPreference } from '../../adapters/questioner.adapter';
import { buildPoolCandidateContexts } from './context.shared';

const logger = log.service.from('PoolNewbornStamp');
const POOL_NEWBORN_STAMP_TIMEOUT_MS = 15_000;

interface NewbornIntent {
  userId: string;
  payload: string;
  summary?: string | null;
  status?: string | null;
  archivedAt?: Date | null;
}

/** Injectable dependencies for deterministic API tests. */
export interface NewbornOpportunityStamperDeps {
  getIntent: (intentId: string) => Promise<NewbornIntent | null>;
  listAnsweredPoolPreferences: (
    userId: string,
    intentId: string,
    currentIntentFingerprint: string,
  ) => Promise<AnsweredPoolPreference[]>;
  buildCandidateContexts: typeof buildPoolCandidateContexts;
  assign: (
    input: PoolDiscriminatorAssignmentInput,
    options?: { signal?: AbortSignal },
  ) => Promise<PoolDiscriminatorAssignedAxis[]>;
  now?: () => string;
}

function isOwnedActiveIntent(intent: NewbornIntent | null, ownerUserId: string): intent is NewbornIntent {
  return Boolean(
    intent
    && intent.userId === ownerUserId
    && !intent.archivedAt
    && (intent.status == null || intent.status === 'ACTIVE'),
  );
}

function copyItems(items: CreateOpportunityData[]): CreateOpportunityData[] {
  return items.map((item) => ({
    ...item,
    detection: { ...item.detection },
    actors: item.actors.map((actor) => ({ ...actor })),
    interpretation: {
      ...item.interpretation,
      signals: item.interpretation.signals?.map((signal) => ({ ...signal })),
    },
    context: { ...item.context },
    metadata: item.metadata ? { ...item.metadata } : item.metadata,
  }));
}

/** Build one fail-open stamper callback from host dependencies. */
export function createNewbornOpportunityStamper(
  deps: NewbornOpportunityStamperDeps,
): StampNewbornOpportunitiesFn {
  return async ({ ownerUserId, intentId, items }) => {
    if (poolQuestionsMode() !== 'on' || poolQuestionsStampNewborn() !== 'on' || items.length === 0) return items;

    try {
      const before = await deps.getIntent(intentId);
      if (!isOwnedActiveIntent(before, ownerUserId)) return items;
      const beforeFingerprint = computeIntentFingerprint(before.payload, before.summary);
      const preferences = await deps.listAnsweredPoolPreferences(ownerUserId, intentId, beforeFingerprint);
      if (preferences.length === 0) return items;

      const bounded = items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.detection.triggeredBy === intentId)
        .sort((a, b) => (b.item.interpretation.confidence ?? 0) - (a.item.interpretation.confidence ?? 0))
        .slice(0, POOL_DISCRIMINATOR_MAX_CANDIDATES);
      const candidates = await deps.buildCandidateContexts(
        ownerUserId,
        bounded.map(({ item, index }) => ({ id: `newborn-${index}`, opportunity: item })),
        chatDatabaseAdapter,
      );
      if (candidates.length === 0) return items;

      const classifications = await deps.assign({
        axes: preferences.map((preference) => ({
          questionId: preference.questionId,
          label: preference.label,
          sides: preference.sides,
        })),
        candidates,
      }, { signal: AbortSignal.timeout(POOL_NEWBORN_STAMP_TIMEOUT_MS) });

      // The intent may be refined, paused, archived, or transferred while the
      // provider call is in flight. Any drift invalidates the whole batch.
      const after = await deps.getIntent(intentId);
      if (!isOwnedActiveIntent(after, ownerUserId)) return items;
      if (computeIntentFingerprint(after.payload, after.summary) !== beforeFingerprint) return items;

      const preferenceByQuestion = new Map(preferences.map((preference) => [preference.questionId, preference]));
      const itemIndexByCandidate = new Map(
        bounded.map(({ index }) => [`newborn-${index}`, index]),
      );
      const stamped = copyItems(items);
      const appliedAt = (deps.now ?? (() => new Date().toISOString()))();

      const classificationByQuestion = new Map(
        classifications.map((classification) => [classification.questionId, classification]),
      );
      // Adapter preferences are newest-first. Apply oldest-first so the latest
      // answer remains last, matching Tier-0 append order and presentation.
      for (const preference of [...preferences].reverse()) {
        const axis = classificationByQuestion.get(preference.questionId);
        if (!axis || !preferenceByQuestion.has(axis.questionId)) continue;
        for (const assignment of axis.assignments) {
          const itemIndex = itemIndexByCandidate.get(assignment.candidateId);
          if (itemIndex === undefined) continue;
          const write = buildPoolAdjustment({
            questionId: preference.questionId,
            recipientUserId: ownerUserId,
            intentId,
            label: preference.label,
            assignedSide: assignment.side,
            chosenSide: preference.chosenSide,
            appliedAt,
            intentFingerprint: beforeFingerprint,
          });
          const item = stamped[itemIndex];
          item.metadata = mergePoolAdjustment(item.metadata, write.adjustment);
          item.interpretation = {
            ...item.interpretation,
            signals: [
              ...(item.interpretation.signals ?? []).filter(
                (signal) => !(
                  signal.type === 'pool_discriminator' &&
                  signal.questionId === preference.questionId &&
                  signal.recipientUserId === ownerUserId &&
                  signal.intentId === intentId
                ),
              ),
              write.signal,
            ],
          };
        }
      }

      return stamped;
    } catch (error) {
      // Lookup, public-context, and provider failures must never block INSERT.
      logger.warn('Newborn stamping failed; persisting originals', {
        intentId,
        itemCount: items.length,
        error: error instanceof Error ? error.message : String(error),
      });
      return items;
    }
  };
}

const questionerAdapter = new QuestionerAdapter(db);
let assigner: PoolDiscriminatorAssigner | null = null;

/** Production singleton used by eligible composition roots. */
export const stampNewbornOpportunities: StampNewbornOpportunitiesFn = createNewbornOpportunityStamper({
  getIntent: (intentId) => chatDatabaseAdapter.getIntent(intentId),
  listAnsweredPoolPreferences: (userId, intentId, fingerprint) =>
    questionerAdapter.listAnsweredPoolPreferences(userId, intentId, fingerprint),
  buildCandidateContexts: buildPoolCandidateContexts,
  assign: (input, options) => {
    assigner ??= new PoolDiscriminatorAssigner();
    return assigner.assign(input, options);
  },
});
