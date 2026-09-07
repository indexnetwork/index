import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import type { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';
import type { OpportunityActionablePayload } from '../events/opportunity.event';
import { log } from '../lib/log';
import type { NotificationStreamEvent, NotificationStreamPublisher } from '../lib/user-events';
// eslint-disable-next-line boundaries/dependencies -- task-owned pure projection for realtime frames.
import { actionableRecipientIds, buildOpportunityNotificationEvent, counterpartForRecipient } from './notification-projection';

const logger = log.service.from('NotificationDelivery');

export interface NotificationDeliveryDependencies {
  opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity'>;
  getIdentity: (userId: string) => Promise<UserIdentity | null>;
  publish: NotificationStreamPublisher;
}

export class NotificationDeliveryService {
  constructor(private readonly deps: NotificationDeliveryDependencies) {}

  private async projectOpportunity(
    opportunity: OpportunityRow,
    recipientId: string,
  ): Promise<NotificationStreamEvent> {
    const counterpart = counterpartForRecipient(opportunity, recipientId);
    const [viewerIdentity, counterpartIdentity] = await Promise.all([
      this.deps.getIdentity(recipientId),
      counterpart ? this.deps.getIdentity(counterpart.userId) : Promise.resolve(null),
    ]);
    const projection = buildOpportunityNotificationEvent(opportunity, {
      viewer: viewerIdentity,
      counterpart: counterpartIdentity,
    });
    const recipientActor = opportunity.actors.find(({ userId }) => userId === recipientId);
    return {
      type: 'opportunity.new',
      id: opportunity.id,
      title: projection.headline,
      body: projection.summary,
      data: {
        opportunityId: opportunity.id,
        intentId: recipientActor?.intent ?? null,
      },
    };
  }

  async publishOpportunityActionable(payload: OpportunityActionablePayload): Promise<void> {
    try {
      const opportunity = await this.deps.opportunities.getOpportunity(payload.opportunity.id);
      if (!opportunity || opportunity.status !== 'pending') return;

      await Promise.all(actionableRecipientIds(opportunity).map(async (recipientId) => {
        try {
          const event = await this.projectOpportunity(opportunity, recipientId);
          await this.deps.publish(recipientId, event);
        } catch (error) {
          logger.error('Failed to publish opportunity notification to recipient', {
            opportunityId: opportunity.id,
            recipientId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }));
    } catch (error) {
      logger.error('Failed to publish opportunity notification', {
        opportunityId: payload.opportunity.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
