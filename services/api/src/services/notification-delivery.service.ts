import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import { db, eq } from '../adapters/database.shared';
import type { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';
import type { OpportunityActionablePayload } from '../events/opportunity.event';
import { log } from '../lib/log';
import type { NotificationStreamEvent, NotificationStreamPublisher } from '../lib/notification-stream-events';
import { intents } from '../schemas/database.schema';
import { readOpenQuestionMessages, type OpenQuestionMessage } from '../lib/question/open-question-message';
// eslint-disable-next-line boundaries/dependencies -- task-owned pure projection shared by realtime and snapshots.
import { actionableRecipientIds, boundedNotificationLabel, buildOpportunityNotificationEvent, buildQuestionMessageStreamEvent, counterpartForRecipient } from './notification-projection';

const logger = log.service.from('NotificationDelivery');

export interface NotificationDeliveryDependencies {
  opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity' | 'getNotificationSnapshotOpportunities'>;
  getIdentity: (userId: string) => Promise<UserIdentity | null>;
  getIntentLabel: (intentId: string) => Promise<string | undefined>;
  publish: NotificationStreamPublisher;
  /**
   * The user's open question-messages, one per signal. Derived at snapshot
   * time from the parked set — the question loop stores no read/unread state,
   * so "still open" is the only thing that decides whether a frame is in the
   * snapshot. Defaults to the real reader.
   */
  listOpenQuestionMessages?: (userId: string) => Promise<OpenQuestionMessage[]>;
  /** Origin the question deep link is built against. */
  webAppUrl?: string;
}

const DEFAULT_WEB_APP_URL = 'https://index.network';

export async function loadNotificationIntentLabel(intentId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ summary: intents.summary, payload: intents.payload })
    .from(intents)
    .where(eq(intents.id, intentId))
    .limit(1);
  return boundedNotificationLabel(row?.summary) ?? boundedNotificationLabel(row?.payload);
}

export class NotificationDeliveryService {
  constructor(private readonly deps: NotificationDeliveryDependencies) {}

  private async opportunityCounterpartLabel(
    opportunity: OpportunityRow,
    recipientId: string,
  ): Promise<string | undefined> {
    const counterpart = counterpartForRecipient(opportunity, recipientId);
    if (!counterpart) return undefined;
    const identity = await this.deps.getIdentity(counterpart.userId);
    return boundedNotificationLabel(identity?.identity.name);
  }

  private async projectOpportunity(
    opportunity: OpportunityRow,
    recipientId: string,
  ): Promise<NotificationStreamEvent> {
    const counterpart = counterpartForRecipient(opportunity, recipientId);
    const introducer = opportunity.actors.find(({ role }) => role === 'introducer');
    const [viewerIdentity, counterpartIdentity, introducerIdentity] = await Promise.all([
      this.deps.getIdentity(recipientId),
      counterpart ? this.deps.getIdentity(counterpart.userId) : Promise.resolve(null),
      introducer ? this.deps.getIdentity(introducer.userId) : Promise.resolve(null),
    ]);
    const projection = buildOpportunityNotificationEvent(opportunity, {
      viewer: viewerIdentity,
      counterpart: counterpartIdentity,
      introducer: introducerIdentity,
    });
    return {
      type: 'opportunity.new',
      id: opportunity.id,
      title: projection.headline,
      body: projection.summary,
    };
  }

  async publishOpportunityActionable(payload: OpportunityActionablePayload): Promise<void> {
    try {
      const opportunity = await this.deps.opportunities.getOpportunity(payload.opportunity.id);
      if (!opportunity || (opportunity.status !== 'latent' && opportunity.status !== 'pending')) return;

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

  /**
   * One frame per open question-message. The live `question.new` frame reaches
   * connected clients only, so a client offline when a question landed would
   * otherwise find it solely by opening the DM. Nothing here is stored or
   * marked read: the frames are re-derived from the parked set on every
   * snapshot, so answering (or the close-out) removes them by itself.
   */
  private async projectQuestionMessages(userId: string): Promise<NotificationStreamEvent[]> {
    const listOpenQuestionMessages = this.deps.listOpenQuestionMessages
      ?? ((id: string) => readOpenQuestionMessages(id));
    let open: OpenQuestionMessage[];
    try {
      open = await listOpenQuestionMessages(userId);
    } catch (error) {
      // The opportunity half of the snapshot is still worth returning.
      logger.error('Failed to project question-message notifications', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }

    return Promise.all(open.map(async (question) => {
      // A missing label degrades the copy, never the frame — same rule the
      // live delivery follows.
      const signalLabel = await this.deps.getIntentLabel(question.intentId).catch(() => undefined);
      return buildQuestionMessageStreamEvent({
        messageId: question.messageId,
        intentId: question.intentId,
        questionCount: question.questionCount,
        ...(signalLabel ? { signalLabel } : {}),
        webAppUrl: this.deps.webAppUrl ?? DEFAULT_WEB_APP_URL,
      });
    }));
  }

  async snapshot(userId: string): Promise<NotificationStreamEvent[]> {
    const [opportunities, questionEvents] = await Promise.all([
      this.deps.opportunities.getNotificationSnapshotOpportunities(userId),
      this.projectQuestionMessages(userId),
    ]);
    const actionableOpportunities = opportunities.filter((opportunity) =>
      actionableRecipientIds(opportunity).includes(userId));
    const opportunityEvents = await Promise.all(
      actionableOpportunities.map((opportunity) => this.projectOpportunity(opportunity, userId)),
    );
    return [...opportunityEvents, ...questionEvents];
  }
}
