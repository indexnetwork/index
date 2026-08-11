import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import { db, eq } from '../adapters/database.shared';
import type { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';
import type { AdapterPersistedQuestion, QuestionerAdapter } from '../adapters/questioner.adapter';
import type { QuestionCreatedPayload } from '../events/question.event';
import type { OpportunityActionablePayload } from '../events/opportunity.event';
import { log } from '../lib/log';
import type { NotificationStreamEvent, NotificationStreamPublisher } from '../lib/notification-stream-events';
import { intents } from '../schemas/database.schema';
// eslint-disable-next-line boundaries/dependencies -- task-owned pure projection shared by realtime and snapshots.
import { actionableRecipientIds, boundedNotificationLabel, buildOpportunityNotificationEvent, counterpartForRecipient } from './notification-projection';

const logger = log.service.from('NotificationDelivery');

export interface NotificationDeliveryDependencies {
  questioner: Pick<QuestionerAdapter, 'getById' | 'findPending'>;
  opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity' | 'getOpportunitiesForUser'>;
  getIdentity: (userId: string) => Promise<UserIdentity | null>;
  getIntentLabel: (intentId: string) => Promise<string | undefined>;
  publish: NotificationStreamPublisher;
}

function questionIntentId(question: AdapterPersistedQuestion): string | undefined {
  return question.detection.triggeredBy
    ?? (question.detection.sourceType === 'intent' ? question.detection.sourceId : undefined)
    ?? question.detection.negotiation?.recipientIntentId;
}

function standardQuestionTitle(
  intentLabel: string | undefined,
  opportunityLabel: string | undefined,
): string {
  if (opportunityLabel) return `Your agent has a question about ${opportunityLabel}'s fit`;
  if (intentLabel) return `Your agent has a question about your ${intentLabel}`;
  return 'Your agent has a question';
}

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

  private async projectQuestion(
    question: AdapterPersistedQuestion,
    recipientId: string,
  ): Promise<NotificationStreamEvent> {
    const opportunity = question.detection.sourceType === 'opportunity'
      ? await this.deps.opportunities.getOpportunity(question.detection.sourceId)
      : null;
    const opportunityLabel = opportunity
      ? await this.opportunityCounterpartLabel(opportunity, recipientId)
      : undefined;

    if (question.detection.mode === 'negotiation_inflight') {
      return {
        type: 'question.new',
        id: question.id,
        title: 'Your agent needs your input',
        body: `A negotiation with ${opportunityLabel ?? 'someone'} is waiting for your answer.`,
      };
    }

    const intentId = questionIntentId(question);
    const intentLabel = intentId
      ? boundedNotificationLabel(await this.deps.getIntentLabel(intentId))
      : undefined;
    return {
      type: 'question.new',
      id: question.id,
      title: standardQuestionTitle(intentLabel, opportunityLabel),
      body: question.payload.prompt?.trim() || 'Open Index to answer.',
    };
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

  async publishQuestionCreated(payload: QuestionCreatedPayload): Promise<void> {
    try {
      const question = await this.deps.questioner.getById(payload.questionId);
      if (!question || question.status !== 'pending') return;
      const event = await this.projectQuestion(question, payload.userId);
      await this.deps.publish(payload.userId, event);
    } catch (error) {
      logger.error('Failed to publish question notification', {
        questionId: payload.questionId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

  async snapshot(userId: string): Promise<NotificationStreamEvent[]> {
    const [questions, opportunities] = await Promise.all([
      this.deps.questioner.findPending(userId),
      this.deps.opportunities.getOpportunitiesForUser(userId, {
        statuses: ['latent', 'pending'],
      }),
    ]);
    const pendingQuestions = questions.filter(({ status }) => status === 'pending');
    const actionableOpportunities = opportunities.filter((opportunity) =>
      actionableRecipientIds(opportunity).includes(userId));
    const [questionEvents, opportunityEvents] = await Promise.all([
      Promise.all(pendingQuestions.map((question) => this.projectQuestion(question, userId))),
      Promise.all(actionableOpportunities.map((opportunity) => this.projectOpportunity(opportunity, userId))),
    ]);
    return [...questionEvents, ...opportunityEvents];
  }
}
