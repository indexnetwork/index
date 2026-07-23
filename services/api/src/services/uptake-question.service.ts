import { isUptakeGuardEnabled, NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY, uptakeAuthorityThreshold } from '@indexnetwork/protocol';

import type { OpportunityRow } from '../adapters/database.shared';
import type { UptakeIntentRow } from '../adapters/uptake-question.database.adapter';
import { log } from '../lib/log';

const logger = log.service.from('UptakeQuestionService');

type OpportunityActor = OpportunityRow['actors'][number];

export interface UptakeQuestionServiceDeps {
  getOpportunity: (id: string) => Promise<OpportunityRow | null>;
  getIntent: (id: string, networkId: string) => Promise<UptakeIntentRow | null>;
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

/**
 * Generates one advisory uptake question for each eligible non-introducer
 * recipient when an opportunity becomes pending. Every error fails open.
 */
export class UptakeQuestionService {
  constructor(private readonly deps: UptakeQuestionServiceDeps = {
    getOpportunity: async (id) => (await import('../adapters/uptake-question.database.adapter')).uptakeQuestionDatabaseAdapter.getOpportunity(id),
    getIntent: async (id, networkId) => (await import('../adapters/uptake-question.database.adapter')).uptakeQuestionDatabaseAdapter.getIntent(id, networkId),
    resolveSafeCommonNetwork: async (recipient, counterparty, networks) =>
      (await import('../adapters/uptake-question.database.adapter')).uptakeQuestionDatabaseAdapter.resolveSafeCommonNetwork(recipient, counterparty, networks),
    hasQuestionForRecipientSourcePurpose: async (recipient, sourceType, sourceId, purpose) =>
      (await import('../adapters/uptake-question.database.adapter')).uptakeQuestionDatabaseAdapter.hasQuestionForRecipientSourcePurpose(recipient, sourceType, sourceId, purpose),
    enqueue: async (input, jobId) => {
      const { questionerQueue } = await import('../queues/questioner.queue');
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
    // Exact recipient routing is ambiguous when either participant has more
    // than one actor binding on this opportunity.
    if (recipientActors.length !== 1 || counterpartyActors.length !== 1) return;

    for (const recipient of recipientActors) {
      for (const counterparty of counterpartyActors) {
        const recipientIntentId = exactActorIntent(recipient);
        const counterpartyIntentId = exactActorIntent(counterparty);
        const networkIds = sharedActorNetworks(recipient, counterparty);
        const networkId = networkIds[0];
        if (!recipientIntentId || !counterpartyIntentId || !networkId) continue;

        // Validate both exact actor-bound intents. The counterparty intent
        // determines uptake eligibility; the recipient's own intent is the
        // only lawful routing provenance.
        const [recipientIntent, counterpartyIntent] = await Promise.all([
          this.deps.getIntent(recipientIntentId, networkId),
          this.deps.getIntent(counterpartyIntentId, networkId),
        ]);
        if (
          !recipientIntent
          || recipientIntent.userId !== recipientUserId
          || recipientIntent.archivedAt !== null
          || (recipientIntent.status !== null && recipientIntent.status !== 'ACTIVE')
          || !counterpartyIntent
          || counterpartyIntent.userId !== counterpartyUserId
          || counterpartyIntent.archivedAt !== null
          || (counterpartyIntent.status !== null && counterpartyIntent.status !== 'ACTIVE')
          || counterpartyIntent.felicityAuthority === null
          || counterpartyIntent.felicityAuthority >= uptakeAuthorityThreshold()
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

        await this.deps.enqueue({
          mode: 'negotiation',
          purpose: 'uptake',
          userId: recipientUserId,
          sourceType: 'opportunity',
          sourceId: opportunity.id,
          scopeType: 'network',
          scopeId: network.id,
          negotiation: {
            purpose: 'uptake',
            recipientUserId,
            recipientIntentId,
            opportunityId: opportunity.id,
            networkId: network.id,
            // This is durable, minimal provenance—not user-facing context.
            // Persistence/read/admission revalidate both exact counterparty
            // identities before the advisory can block acceptance.
            counterpartyUserId,
            counterpartyIntentId,
            counterpartyFelicityAuthority: counterpartyIntent.felicityAuthority,
          },
          context: {
            purpose: 'uptake',
            negotiationId: opportunity.id,
            counterpartyHint: NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
            indexContext: NEGOTIATION_QUESTION_GENERIC_NETWORK,
            proposedActivity: NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
          },
        }, `uptake-${recipientUserId}-${opportunity.id}`);
        return;
      }
    }
  }
}

export const uptakeQuestionService = new UptakeQuestionService();
