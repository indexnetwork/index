import { isActionableForViewer, safeFallbackSummary } from '@indexnetwork/protocol';

import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import type { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';
import type { OpportunityActionablePayload } from '../events/opportunity.event';
import { log } from '../lib/log';
import type { UserEvent, UserEventPublisher } from '../lib/user-events';

const logger = log.service.from('OpportunityEventService');

const OPPORTUNITY_HEADLINE = 'A promising connection';
const OPPORTUNITY_EMPTY_SUMMARY = 'A new match that might be relevant to you.';
const LABEL_MAX_CHARS = 80;

interface OpportunityEventCopy {
  headline: string;
  summary: string;
  counterpartyName: string;
}

interface OpportunityEventIdentities {
  viewer: UserIdentity | null;
  counterpart: UserIdentity | null;
}

export interface OpportunityEventDependencies {
  opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity'>;
  getIdentity: (userId: string) => Promise<UserIdentity | null>;
  publish: UserEventPublisher;
}

function boundedLabel(value: string | null | undefined): string | undefined {
  const label = value?.trim();
  return label ? label.slice(0, LABEL_MAX_CHARS) : undefined;
}

function displayName(identity: UserIdentity | null | undefined, fallback: string): string {
  return boundedLabel(identity?.identity.name) ?? fallback;
}

function actionableRecipientIds(opportunity: OpportunityRow): string[] {
  return [...new Set(opportunity.actors.map(({ userId }) => userId))]
    .filter((userId) => isActionableForViewer(opportunity.actors, opportunity.status, userId));
}

function counterpartForRecipient(
  opportunity: OpportunityRow,
  recipientId: string,
): OpportunityRow['actors'][number] | undefined {
  const otherActors = opportunity.actors.filter(({ userId }) => userId !== recipientId);
  return otherActors[0];
}

function buildOpportunityEventCopy(
  opportunity: OpportunityRow,
  identities: OpportunityEventIdentities,
): OpportunityEventCopy {
  const counterpartyName = displayName(identities.counterpart, 'Someone');
  return {
    headline: OPPORTUNITY_HEADLINE,
    summary: safeFallbackSummary(opportunity.interpretation.reasoning, {
      counterpartName: counterpartyName,
      viewerName: displayName(identities.viewer, 'you'),
      emptyText: OPPORTUNITY_EMPTY_SUMMARY,
    }),
    counterpartyName,
  };
}

/** Turns an actionable opportunity into one user event per recipient who can act on it. */
export class OpportunityEventService {
  constructor(private readonly deps: OpportunityEventDependencies) {}

  private async projectOpportunity(
    opportunity: OpportunityRow,
    recipientId: string,
  ): Promise<UserEvent> {
    const counterpart = counterpartForRecipient(opportunity, recipientId);
    const [viewerIdentity, counterpartIdentity] = await Promise.all([
      this.deps.getIdentity(recipientId),
      counterpart ? this.deps.getIdentity(counterpart.userId) : Promise.resolve(null),
    ]);
    const copy = buildOpportunityEventCopy(opportunity, {
      viewer: viewerIdentity,
      counterpart: counterpartIdentity,
    });
    const recipientActor = opportunity.actors.find(({ userId }) => userId === recipientId);
    return {
      type: 'opportunity.new',
      id: opportunity.id,
      title: copy.headline,
      body: copy.summary,
      data: {
        opportunityId: opportunity.id,
        intentId: recipientActor?.intent ?? null,
      },
    };
  }

  /**
   * Publish `opportunity.new` to every recipient the opportunity is actionable
   * for. Best-effort: a failed recipient is logged and never fails the others.
   *
   * @param payload - The actionable lifecycle payload, carrying only id and status.
   */
  async publishOpportunityActionable(payload: OpportunityActionablePayload): Promise<void> {
    try {
      const opportunity = await this.deps.opportunities.getOpportunity(payload.opportunity.id);
      if (!opportunity || opportunity.status !== 'pending') return;

      await Promise.all(actionableRecipientIds(opportunity).map(async (recipientId) => {
        try {
          const event = await this.projectOpportunity(opportunity, recipientId);
          await this.deps.publish(recipientId, event);
        } catch (error) {
          logger.error('Failed to publish opportunity event to recipient', {
            opportunityId: opportunity.id,
            recipientId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }));
    } catch (error) {
      logger.error('Failed to publish opportunity event', {
        opportunityId: payload.opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
