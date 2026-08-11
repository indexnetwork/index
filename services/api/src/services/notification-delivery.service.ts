import { safeFallbackSummary, DEFAULT_FALLBACK_HEADLINE } from '@indexnetwork/protocol';

import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import { buildProfileFromUser, db, eq } from '../adapters/database.shared';
import { intents } from '../schemas/database.schema';
import type { QuestionCreatedPayload } from '../events/question.event';
import type { OpportunityPendingPayload } from '../events/opportunity.event';
import { log } from '../lib/log';
import { publishNotificationStreamEvent, type NotificationStreamEvent } from '../lib/notification-stream-events';
import type { QuestionerAdapter } from '../adapters/questioner.adapter';
import type { OpportunityDatabaseAdapter } from '../adapters/opportunity.database.adapter';

const logger = log.service.from('NotificationDelivery');

function displayName(profile: UserIdentity | null | undefined, fallback = 'Someone'): string {
  const name = profile?.identity?.name?.trim();
  return name || fallback;
}

function questionNotificationTitle(
  intentLabel: string | undefined,
  opportunityLabel: string | undefined,
): string {
  if (opportunityLabel) return `Your agent has a question about ${opportunityLabel}'s fit`;
  if (intentLabel) return `Your agent has a question about your ${intentLabel}`;
  return 'Your agent has a question';
}

async function loadIntentLabel(intentId: string | undefined): Promise<string | undefined> {
  if (!intentId) return undefined;
  const [row] = await db
    .select({ summary: intents.summary, payload: intents.payload })
    .from(intents)
    .where(eq(intents.id, intentId))
    .limit(1);
  if (!row) return undefined;
  const summary = row.summary?.trim();
  if (summary) return summary;
  const payload = row.payload?.trim();
  return payload ? payload.slice(0, 80) : undefined;
}

function counterpartForUser(opportunity: OpportunityRow, recipientId: string): OpportunityRow['actors'][number] | undefined {
  return opportunity.actors.find((actor) => actor.userId !== recipientId);
}

export class NotificationDeliveryService {
  constructor(
    private readonly questioner: QuestionerAdapter,
    private readonly opportunities: Pick<OpportunityDatabaseAdapter, 'getOpportunity'>,
  ) {}

  async publishQuestionCreated(payload: QuestionCreatedPayload): Promise<void> {
    try {
      const question = await this.questioner.getById(payload.questionId);
      if (!question || question.status !== 'pending') return;

      const intentId = question.detection.triggeredBy
        ?? (question.detection.sourceType === 'intent' ? question.detection.sourceId : undefined)
        ?? question.detection.negotiation?.recipientIntentId;

      const intentLabel = await loadIntentLabel(intentId);
      let opportunityLabel: string | undefined;
      if (question.detection.sourceType === 'opportunity') {
        const opportunity = await this.opportunities.getOpportunity(question.detection.sourceId);
        const counterpart = opportunity
          ? counterpartForUser(opportunity, payload.userId)
          : undefined;
        if (counterpart) {
          const profile = await buildProfileFromUser(counterpart.userId);
          opportunityLabel = displayName(profile);
        }
      }

      const event: NotificationStreamEvent = {
        type: 'question.new',
        id: payload.questionId,
        title: questionNotificationTitle(intentLabel, opportunityLabel),
        body: question.payload.prompt?.trim() || 'Open Index to answer.',
      };
      await publishNotificationStreamEvent(payload.userId, event);
    } catch (err) {
      logger.error('Failed to publish question notification', {
        questionId: payload.questionId,
        userId: payload.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async publishOpportunityPending(payload: OpportunityPendingPayload): Promise<void> {
    try {
      const opportunity = await this.opportunities.getOpportunity(payload.opportunity.id);
      if (!opportunity || opportunity.status !== 'pending') return;

      const recipientIds = [...new Set(opportunity.actors.map((actor) => actor.userId))];
      await Promise.all(recipientIds.map(async (recipientId) => {
        const counterpart = counterpartForUser(opportunity, recipientId);
        const [viewerProfile, counterpartProfile] = await Promise.all([
          buildProfileFromUser(recipientId),
          counterpart ? buildProfileFromUser(counterpart.userId) : Promise.resolve(null),
        ]);
        const counterpartyName = displayName(counterpartProfile, 'Someone');
        const summary = safeFallbackSummary(opportunity.interpretation.reasoning, {
          counterpartName: counterpartyName,
          viewerName: displayName(viewerProfile, 'you'),
          emptyText: 'A new match that might be relevant to you.',
        });
        const headline = opportunity.interpretation.category?.trim()
          || DEFAULT_FALLBACK_HEADLINE;

        const event: NotificationStreamEvent = {
          type: 'opportunity.new',
          id: opportunity.id,
          title: headline,
          body: summary,
        };
        await publishNotificationStreamEvent(recipientId, event);
      }));
    } catch (err) {
      logger.error('Failed to publish opportunity notification', {
        opportunityId: payload.opportunity.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
