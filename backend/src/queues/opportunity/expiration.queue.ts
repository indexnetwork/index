// backend/src/queues/opportunity/expiration.queue.ts
import cron from 'node-cron';
import { and, isNotNull, lte, notInArray } from 'drizzle-orm';
import { log } from '../../lib/log';
import db from '../../lib/drizzle/drizzle';
import { opportunities } from '../../schemas/database.schema';

export class OpportunityExpirationCron {
  private readonly logger = log.queue.from('OpportunityExpiration');
  private task: ReturnType<typeof cron.schedule> | null = null;

  async expireStale(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          notInArray(opportunities.status, ['accepted', 'rejected', 'expired']),
        ),
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  start(): void {
    if (this.task) return;
    this.task = cron.schedule('*/15 * * * *', () => {
      this.expireStale()
        .then((count) => {
          if (count > 0) {
            this.logger.info(`Expired ${count} opportunit${count === 1 ? 'y' : 'ies'}`);
          }
        })
        .catch((err) => this.logger.error('Cron failed', { error: err }));
    });
    this.logger.info('Expiration cron scheduled (every 15 minutes)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

export const opportunityExpirationCron = new OpportunityExpirationCron();
