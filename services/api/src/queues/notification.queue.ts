import { safeFallbackSummary } from '@indexnetwork/protocol';
import { log } from '../lib/log';
import { background } from '../lib/background';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { userService } from '../services/user.service';
import { executeSendEmail } from '../lib/email/transport.helper';
import { opportunityNotificationTemplate } from '../lib/email/templates/opportunity-notification.template';
import { emitOpportunityNotification, emitTelegramNotification } from '../lib/notification-events';
import { publishNotificationStreamEvent, type NotificationStreamPublisher } from '../lib/notification-stream-events';
import { getRedisClient } from '../adapters/cache.adapter';
import { userDatabaseAdapter } from '../adapters/database.adapter';

/** Delivery priority: immediate (WebSocket) or high (email soon). */
export type NotificationPriority = 'immediate' | 'high';

/** Payload for a single opportunity notification job. */
export interface NotificationJobData {
  opportunityId: string;
  recipientId: string;
  priority: NotificationPriority;
}

/** Minimal database interface for notification queue (used when deps provided in tests). */
export type NotificationQueueDatabase = Pick<ChatDatabaseAdapter, 'getOpportunity'> & {
  getTelegramPrefs(userId: string): Promise<import('../schemas/database.schema').TelegramPrefs | null>;
};

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub the database.
 */
export interface NotificationQueueDeps {
  database?: NotificationQueueDatabase;
  /** Notification-stream publisher (Redis pub/sub → the SSE stream). */
  publishStreamEvent?: NotificationStreamPublisher;
}

const API_URL = process.env.API_URL || 'https://protocol.index.network';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://index.network';
const EMAIL_OPPORTUNITY_DEDUPE_PREFIX = 'email:opportunity:dedupe:';
const EMAIL_DEDUPE_TTL_SEC = 7 * 24 * 3600;

/**
 * Notification delivery: fire-and-forget background trigger for opportunity
 * notifications, with retries — the one place in the refactor that keeps
 * them, since a failed delivery here has no reconciler behind it.
 */
export class NotificationQueue {
  private readonly logger = log.job.from('NotificationJob');
  private readonly database: NotificationQueueDatabase;
  private readonly publishStreamEvent: NotificationStreamPublisher;

  /**
   * @param deps - Optional overrides for database (for tests).
   */
  constructor(deps?: NotificationQueueDeps) {
    this.publishStreamEvent = deps?.publishStreamEvent ?? publishNotificationStreamEvent;
    if (deps?.database) {
      this.database = deps.database;
    } else {
      const chatDb = new ChatDatabaseAdapter();
      this.database = {
        getOpportunity: (id: string) => chatDb.getOpportunity(id),
        getTelegramPrefs: (userId: string) => userDatabaseAdapter.getTelegramPrefs(userId),
      };
    }
  }

  /**
   * Trigger an opportunity notification for a recipient at the given
   * priority, fire-and-forget with up to 3 retries on failure.
   * @param opportunityId - Opportunity to notify about
   * @param recipientId - User to notify
   * @param priority - immediate (WebSocket) or high (email)
   */
  async queueOpportunityNotification(
    opportunityId: string,
    recipientId: string,
    priority: NotificationPriority
  ): Promise<void> {
    background(
      'notification',
      () => this.processOpportunityNotification({ opportunityId, recipientId, priority }),
      { retries: 3 },
    );
  }

  async processOpportunityNotification(data: NotificationJobData): Promise<void> {
    const { opportunityId, recipientId, priority } = data;
    const db = this.database;

    this.logger.verbose('Processing opportunity notification', {
      opportunityId,
      recipientId,
      priority,
    });

    const opportunity = await db.getOpportunity(opportunityId);
    if (!opportunity) {
      this.logger.warn('Opportunity not found, skipping', { opportunityId });
      return;
    }

    // Shared sanitization standard (UUID strip, truncation) — raw evaluator
    // reasoning must never reach email/Telegram copy verbatim.
    const summary = safeFallbackSummary(opportunity.interpretation.reasoning, {
      emptyText: 'A new match that might be relevant to you.',
    });

    switch (priority) {
      case 'immediate': {
        emitOpportunityNotification({ opportunityId, recipientId });
        this.logger.info('Emitted opportunity notification (WebSocket)', {
          opportunityId,
          recipientId,
        });
        break;
      }
      case 'high': {
        await this.sendHighPriorityEmail(recipientId, opportunityId, summary);
        break;
      }
      default: {
        this.logger.warn('Unknown priority, skipping', { priority });
      }
    }

    // Telegram delivery (independent of priority tier)
    const telegramPrefs = await this.database.getTelegramPrefs(recipientId);
    if (telegramPrefs?.notifications.opportunityAccepted) {
      const appUrl = process.env.WEB_APP_URL || 'https://index.network';
      emitTelegramNotification({
        userId: recipientId,
        message: `New connection: ${summary}`,
        inlineButtons: [{ text: 'View opportunity', url: `${appUrl}/opportunities/${opportunityId}` }],
      });
      this.logger.info('Emitted Telegram opportunity notification', {
        opportunityId,
        recipientId,
      });
    }
  }

  private async sendHighPriorityEmail(
    recipientId: string,
    opportunityId: string,
    summary: string
  ): Promise<void> {
    const recipient = await userService.getUserForNewsletter(recipientId);
    if (!recipient?.email) {
      this.logger.warn('Recipient not found or no email, skipping email', {
        recipientId,
      });
      return;
    }
    if (!recipient.onboarding?.completedAt) {
      this.logger.verbose('Recipient has not completed onboarding, skipping email', {
        recipientId,
      });
      return;
    }
    if (recipient.prefs?.connectionUpdates === false) {
      this.logger.verbose('Recipient has connection/opportunity updates disabled', {
        recipientId,
      });
      return;
    }

    const opportunityUrl = `${WEB_APP_URL}/opportunities/${opportunityId}`;
    let unsubscribeUrl: string | undefined;
    if (recipient.unsubscribeToken) {
      unsubscribeUrl = `${API_URL}/api/notifications/unsubscribe?token=${recipient.unsubscribeToken}&type=connectionUpdates`;
    }

    const redis = getRedisClient();
    const emailDedupeKey = `${EMAIL_OPPORTUNITY_DEDUPE_PREFIX}${recipientId}:${opportunityId}`;
    const setResult = await redis.set(emailDedupeKey, '1', 'EX', EMAIL_DEDUPE_TTL_SEC, 'NX');
    if (setResult !== 'OK') {
      this.logger.verbose('Skipped duplicate opportunity email (dedupe key already set)', {
        recipientId,
        opportunityId,
      });
      return;
    }

    const template = opportunityNotificationTemplate(
      recipient.name ?? 'there',
      summary,
      opportunityUrl,
      unsubscribeUrl
    );

    await executeSendEmail({
      to: recipient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: unsubscribeUrl
        ? {
            'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined,
    });
    this.logger.info('Sent high-priority opportunity email', {
      recipientId,
      opportunityId,
    });
  }
}

/** Singleton notification queue instance. Use for triggering notifications. */
export const notificationQueue = new NotificationQueue();

/**
 * Trigger an opportunity notification (convenience for existing call sites).
 * @param opportunityId - Opportunity to notify about
 * @param recipientId - User to notify
 * @param priority - immediate (WebSocket) or high (email)
 */
export async function queueOpportunityNotification(
  opportunityId: string,
  recipientId: string,
  priority: NotificationPriority
): Promise<void> {
  return notificationQueue.queueOpportunityNotification(opportunityId, recipientId, priority);
}
