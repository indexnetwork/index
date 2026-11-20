import cron from 'node-cron';

import { log } from '../lib/log';
import { introducerService } from '../services/introducer.service';

/**
 * The introducer's background pass: embed contact cards, match new public
 * intents to members' contacts, email contacts a member said yes to, and
 * forget seats whose introduction ended. Each step is idempotent.
 */
export class IntroducerCron {
  private readonly logger = log.job.from('IntroducerCron');
  private task: ReturnType<typeof cron.schedule> | null = null;

  start(): void {
    if (this.task) return;
    this.task = cron.schedule('*/2 * * * *', () => {
      introducerService.sweep().catch((error) => this.logger.error('Introducer sweep failed', { error: String(error) }));
    });
    this.logger.info('Introducer cron scheduled (every 2 minutes)');
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}

export const introducerCron = new IntroducerCron();
