// services/api/src/queues/opportunity/expiration.queue.ts
import cron from 'node-cron';
import { log } from '../../lib/log';
import { OpportunityDatabaseAdapter } from '../../adapters/opportunity.database.adapter';

/** The persistence surface the cron needs: a single stale-opportunity sweep. */
export interface OpportunityExpirationDeps {
  expireStaleOpportunities: () => Promise<number>;
}

export class OpportunityExpirationCron {
  private readonly logger = log.queue.from('OpportunityExpiration');
  private task: ReturnType<typeof cron.schedule> | null = null;
  private readonly deps: OpportunityExpirationDeps;

  constructor(deps?: OpportunityExpirationDeps) {
    this.deps = deps ?? new OpportunityDatabaseAdapter();
  }

  async expireStale(): Promise<number> {
    return this.deps.expireStaleOpportunities();
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
