import { isUptakeGuardEnabled, uptakeAuthorityThreshold } from '@indexnetwork/protocol';

import type { OpportunityRow } from '../adapters/database.shared';
import { uptakeQuestionDatabaseAdapter, type UptakeIntentRow, type UptakePublicUserHint } from '../adapters/uptake-question.database.adapter';
import { log } from '../lib/log';
import { questionerQueue } from '../queues/questioner.queue';

const logger = log.service.from('UptakeQuestionService');

type OpportunityActor = OpportunityRow['actors'][number];

export interface UptakeQuestionServiceDeps {
  getOpportunity: (id: string) => Promise<OpportunityRow | null>;
  getIntent: (id: string, networkId: string) => Promise<UptakeIntentRow | null>;
  getPublicUserHint: (userId: string) => Promise<UptakePublicUserHint | null>;
  resolveSafeCommonNetwork: (
    recipientUserId: string,
    counterpartyUserId: string,
    actorNetworkIds: string[],
  ) => Promise<{ id: string; title: string } | null>;
  hasQuestionForRecipientSourcePurpose: (
    recipientUserId: string,
    sourceType: string,
    sourceId: string,
    purpose: 'uptake',
  ) => Promise<boolean>;
  enqueue: (input: import('@indexnetwork/protocol').UptakeQuestionerInput, jobId: string) => Promise<void>;
}

function isRecipient(actor: OpportunityActor): boolean {
  return actor.role !== 'introducer' && !actor.actedAt;
}

function exactActorIntent(actor: OpportunityActor): string | null {
  if (typeof actor.intent !== 'string') return null;

  const normalized = actor.intent.trim();
  if (
    normalized.length === 0
    || normalized.toLowerCase() === 'null'
    || normalized.toLowerCase() === 'undefined'
  ) {
    return null;
  }

  return normalized;
}

function sharedActorNetworks(
  recipient: OpportunityActor,
  counterparty: OpportunityActor,
): string[] {
  if (!recipient.networkId || recipient.networkId !== counterparty.networkId) return [];
  return [recipient.networkId];
}

function publicCounterpartyHint(hint: UptakePublicUserHint | null): string {
  const attributes = [hint?.bio?.trim(), hint?.location?.trim() ? `Location: ${hint.location.trim()}` : '']
    .filter(Boolean);
  return attributes.length > 0 ? attributes.join('. ') : 'The other participant in this proposed activity';
}

/**
 * Generates one advisory uptake question for each eligible non-introducer
 * recipient when an opportunity becomes pending. Every error fails open.
 */
export class UptakeQuestionService {
  constructor(private readonly deps: UptakeQuestionServiceDeps = {
    getOpportunity: (id) => uptakeQuestionDatabaseAdapter.getOpportunity(id),
    getIntent: (id, networkId) => uptakeQuestionDatabaseAdapter.getIntent(id, networkId),
    getPublicUserHint: (userId) => uptakeQuestionDatabaseAdapter.getPublicUserHint(userId),
    resolveSafeCommonNetwork: (recipient, counterparty, networks) =>
      uptakeQuestionDatabaseAdapter.resolveSafeCommonNetwork(recipient, counterparty, networks),
    hasQuestionForRecipientSourcePurpose: (recipient, sourceType, sourceId, purpose) =>
      uptakeQuestionDatabaseAdapter.hasQuestionForRecipientSourcePurpose(recipient, sourceType, sourceId, purpose),
    enqueue: async (input, jobId) => {
      await questionerQueue.addGenerateJob(input, { jobId });
    },
  }) {}

  /** Evaluate a committed pending opportunity and enqueue eligible questions. */
  async handlePending(opportunityId: string): Promise<void> {
    if (!isUptakeGuardEnabled()) return;
    try {
      const opportunity = await this.deps.getOpportunity(opportunityId);
      if (!opportunity || opportunity.status !== 'pending') return;
      const recipientIds = new Set(opportunity.actors.filter(isRecipient).map((actor) => actor.userId));
      for (const recipientUserId of recipientIds) {
        await this.enqueueForRecipient(opportunity, recipientUserId).catch((error) => {
          logger.warn('Uptake recipient evaluation failed open', {
            opportunityId,
            recipientUserId,
            error,
          });
        });
      }
    } catch (error) {
      logger.warn('Uptake pending handler failed open', { opportunityId, error });
    }
  }

  private async enqueueForRecipient(
    opportunity: OpportunityRow,
    recipientUserId: string,
  ): Promise<void> {
    const recipientActors = opportunity.actors.filter((actor) =>
      actor.role !== 'introducer' && actor.userId === recipientUserId && !actor.actedAt,
    );
    const counterpartyIds = new Set(opportunity.actors
      .filter((actor) => actor.role !== 'introducer' && actor.userId !== recipientUserId)
      .map((actor) => actor.userId));
    // Ambiguous multi-party opportunities are skipped, but duplicate actor rows
    // for the same two users are valid and must not disable the guard.
    if (counterpartyIds.size !== 1) return;
    const counterpartyUserId = [...counterpartyIds][0];
    const counterpartyActors = opportunity.actors.filter((actor) =>
      actor.role !== 'introducer' && actor.userId === counterpartyUserId,
    );

    for (const recipient of recipientActors) {
      for (const counterparty of counterpartyActors) {
        const intentId = exactActorIntent(counterparty);
        const networkIds = sharedActorNetworks(recipient, counterparty);
        const networkId = networkIds[0];
        if (!intentId || !networkId) continue;

        // Resolve the exact actor intent through its network assignment. A stale
        // or malformed actor intent must never pull private payload from another
        // network into the recipient's question.
        const intent = await this.deps.getIntent(intentId, networkId);
        if (
          !intent
          || intent.userId !== counterpartyUserId
          || intent.archivedAt !== null
          || intent.status !== 'ACTIVE'
          || intent.felicityAuthority === null
          || intent.felicityAuthority >= uptakeAuthorityThreshold()
        ) continue;

        const network = await this.deps.resolveSafeCommonNetwork(
          recipientUserId,
          counterpartyUserId,
          networkIds,
        );
        if (!network) continue;

        if (await this.deps.hasQuestionForRecipientSourcePurpose(
          recipientUserId,
          'opportunity',
          opportunity.id,
          'uptake',
        )) return;

        const publicHint = await this.deps.getPublicUserHint(counterpartyUserId);
        const proposedActivity = intent.summary?.trim() || intent.payload.trim();
        if (!proposedActivity) continue;

        await this.deps.enqueue({
          mode: 'negotiation',
          purpose: 'uptake',
          userId: recipientUserId,
          sourceType: 'opportunity',
          sourceId: opportunity.id,
          scopeType: 'network',
          scopeId: network.id,
          context: {
            purpose: 'uptake',
            negotiationId: opportunity.id,
            counterpartyHint: publicCounterpartyHint(publicHint),
            indexContext: network.title,
            proposedActivity,
          },
        }, `uptake-${recipientUserId}-${opportunity.id}`);
        return;
      }
    }
  }
}

export const uptakeQuestionService = new UptakeQuestionService();
