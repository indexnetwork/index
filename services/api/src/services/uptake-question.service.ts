import type { OpportunityRow } from '../adapters/database.shared';
import { uptakeQuestionDatabaseAdapter, type UptakeIntentRow, type UptakePublicUserHint } from '../adapters/uptake-question.database.adapter';
import { log } from '../lib/log';
import { questionerQueue } from '../queues/questioner.queue';

const logger = log.service.from('UptakeQuestionService');
const DEFAULT_AUTHORITY_THRESHOLD = 70;

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

function uptakeEnabled(): boolean {
  return process.env.QUESTIONER_ENABLED === 'true'
    && process.env.QUESTIONER_UPTAKE_ENABLED === 'true';
}

function authorityThreshold(): number {
  const parsed = Number(process.env.QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : DEFAULT_AUTHORITY_THRESHOLD;
}

function isRecipient(actor: OpportunityActor): boolean {
  return actor.role !== 'introducer' && !actor.actedAt;
}

function exactActorIntent(actor: OpportunityActor): string | null {
  return typeof actor.intent === 'string' && actor.intent.trim() ? actor.intent : null;
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
    if (!uptakeEnabled()) return;
    try {
      const opportunity = await this.deps.getOpportunity(opportunityId);
      if (!opportunity || opportunity.status !== 'pending') return;
      for (const recipient of opportunity.actors.filter(isRecipient)) {
        await this.enqueueForRecipient(opportunity, recipient).catch((error) => {
          logger.warn('Uptake recipient evaluation failed open', {
            opportunityId,
            recipientUserId: recipient.userId,
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
    recipient: OpportunityActor,
  ): Promise<void> {
    const counterparties = opportunity.actors.filter((actor) =>
      actor.role !== 'introducer' && actor.userId !== recipient.userId,
    );
    // Ambiguous multi-counterparty opportunities are skipped rather than risk
    // selecting the wrong private intent or leaking across participants.
    if (counterparties.length !== 1) return;
    const counterparty = counterparties[0];
    const intentId = exactActorIntent(counterparty);
    if (!intentId) return;

    const networkIds = sharedActorNetworks(recipient, counterparty);
    const networkId = networkIds[0];
    if (!networkId) return;

    // Resolve the exact actor intent through its network assignment. A stale
    // or malformed actor intent must never pull private payload from another
    // network into the recipient's question.
    const intent = await this.deps.getIntent(intentId, networkId);
    if (
      !intent
      || intent.userId !== counterparty.userId
      || intent.archivedAt !== null
      || intent.status !== 'ACTIVE'
      || intent.felicityAuthority === null
      || intent.felicityAuthority >= authorityThreshold()
    ) return;

    const network = await this.deps.resolveSafeCommonNetwork(
      recipient.userId,
      counterparty.userId,
      networkIds,
    );
    if (!network) return;

    if (await this.deps.hasQuestionForRecipientSourcePurpose(
      recipient.userId,
      'opportunity',
      opportunity.id,
      'uptake',
    )) return;

    const publicHint = await this.deps.getPublicUserHint(counterparty.userId);
    const proposedActivity = intent.summary?.trim() || intent.payload.trim();
    if (!proposedActivity) return;

    await this.deps.enqueue({
      mode: 'negotiation',
      purpose: 'uptake',
      userId: recipient.userId,
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
    }, `uptake-${recipient.userId}-${opportunity.id}`);
  }
}

export const uptakeQuestionService = new UptakeQuestionService();
