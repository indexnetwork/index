import { Job } from 'bullmq';
import { safeFallbackSummary } from '@indexnetwork/protocol';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { userService } from '../services/user.service';
import { emailQueue } from './email.queue';
import { opportunityNotificationTemplate } from '../lib/email/templates/opportunity-notification.template';
import { emitOpportunityNotification, emitTelegramNotification } from '../lib/notification-events';
import { getRedisClient } from '../adapters/cache.adapter';
import { userDatabaseAdapter } from '../adapters/database.adapter';

/** BullMQ queue name for opportunity notification jobs. */
export const QUEUE_NAME = 'notification-queue';

/** Delivery priority: immediate (WebSocket), high (email soon), low (weekly digest). */
export type NotificationPriority = 'immediate' | 'high' | 'low';

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
}

const API_URL = process.env.API_URL || 'https://protocol.index.network';
const WEB_APP_URL = process.env.WEB_APP_URL || 'https://index.network';
const DIGEST_LIST_PREFIX = 'digest:opportunities:';
const DIGEST_DEDUPE_PREFIX = 'digest:dedupe:';
const EMAIL_OPPORTUNITY_DEDUPE_PREFIX = 'email:opportunity:dedupe:';
const DIGEST_TTL_SEC = 7 * 24 * 3600;

/**
 * Notification queue: BullMQ queue plus worker and job handlers for opportunity notifications.
 *
 * Handles `process_opportunity_notification`: loads opportunity, then by priority—immediate
 * (WebSocket emit), high (send email), or low (add to weekly digest). Uses email queue and Redis
 * for digest/dedupe.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link NotificationQueue.startWorker}.
 * CLI scripts may add jobs without starting a worker.
 */
export class NotificationQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<NotificationJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NotificationJob');
  private readonly queueLogger = log.queue.from('NotificationQueue');
  private readonly database: NotificationQueueDatabase;
  private worker: ReturnType<typeof QueueFactory.createWorker<NotificationJobData>> | null = null;

  /**
   * @param deps - Optional overrides for database (for tests).
   */
  constructor(deps?: NotificationQueueDeps) {
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
   * Enqueue an opportunity notification for a recipient at the given priority.
   * @param opportunityId - Opportunity to notify about
   * @param recipientId - User to notify
   * @param priority - immediate (WebSocket), high (email), or low (digest)
   * @returns The BullMQ job
   */
  async queueOpportunityNotification(
    opportunityId: string,
    recipientId: string,
    priority: NotificationPriority
  ): Promise<Job<NotificationJobData>> {
    const priorityNum = priority === 'immediate' ? 0 : priority === 'high' ? 5 : 10;
    return this.queue.add(
      'process_opportunity_notification',
      { opportunityId, recipientId, priority },
      {
        priority: priorityNum,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 60 * 60 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      }
    );
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`process_opportunity_notification`)
   * @param data - Job payload
   */
  async processJob(name: string, data: NotificationJobData): Promise<void> {
    switch (name) {
      case 'process_opportunity_notification':
        await this.processOpportunityNotification(data as NotificationJobData);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /**
   * Start the BullMQ worker for this queue. Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<NotificationJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<NotificationJobData>(QUEUE_NAME, processor);
  }

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private async processOpportunityNotification(data: NotificationJobData): Promise<void> {
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
      case 'low': {
        await this.addToDigest(recipientId, opportunityId);
        break;
      }
      default: {
        this.logger.warn('Unknown priority, treating as low', { priority });
        await this.addToDigest(recipientId, opportunityId);
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
    const setResult = await redis.set(emailDedupeKey, '1', 'EX', DIGEST_TTL_SEC, 'NX');
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

    await emailQueue.addJob(
      {
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
      },
      { jobId: `opportunity-email-${recipientId}-${opportunityId}` }
    );
    this.logger.info('Enqueued high-priority opportunity email', {
      recipientId,
      opportunityId,
    });
  }

  private async addToDigest(recipientId: string, opportunityId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const dedupeKey = `${DIGEST_DEDUPE_PREFIX}${recipientId}:${opportunityId}`;
      const setResult = await redis.set(dedupeKey, '1', 'EX', DIGEST_TTL_SEC, 'NX');
      if (setResult !== 'OK') {
        this.logger.verbose('Skipped duplicate digest entry (dedupe key already set)', {
          recipientId,
          opportunityId,
        });
        return;
      }
      const listKey = `${DIGEST_LIST_PREFIX}${recipientId}`;
      await redis.rpush(listKey, opportunityId);
      await redis.expire(listKey, DIGEST_TTL_SEC);
      this.logger.verbose('Added opportunity to weekly digest list', {
        recipientId,
        opportunityId,
      });
    } catch (err) {
      this.logger.error('Failed to add to digest list', {
        recipientId,
        opportunityId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/** Singleton notification queue instance. Use for enqueueing notifications and starting the worker. */
export const notificationQueue = new NotificationQueue();

/**
 * Enqueue an opportunity notification (convenience for existing call sites).
 * @param opportunityId - Opportunity to notify about
 * @param recipientId - User to notify
 * @param priority - immediate (WebSocket), high (email), or low (digest)
 * @returns The BullMQ job
 */
export async function queueOpportunityNotification(
  opportunityId: string,
  recipientId: string,
  priority: NotificationPriority
): Promise<Job<NotificationJobData>> {
  return notificationQueue.queueOpportunityNotification(opportunityId, recipientId, priority);
}
