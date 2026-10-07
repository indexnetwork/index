import cron from 'node-cron';

import { log } from '../lib/log';
import { negotiationService } from '../services/negotiation.service';

/**
 * Relays the notifications committed negotiation turns still owe, every few
 * seconds. Every API replica runs it; database claims keep replicas off each
 * other's rows, and a pass that fails leaves its rows for a later one.
 */
export class NegotiationDeliveryCron {
  private readonly logger = log.job.from('NegotiationDelivery');
  private task: ReturnType<typeof cron.schedule> | null = null;

  /** Schedule the sweep; a pass still running when the next is due is skipped. */
  start(): void {
    if (this.task) return;
    this.task = cron.schedule('*/5 * * * * *', () => this.deliver(), { noOverlap: true });
    this.logger.info('Negotiation delivery cron scheduled (every 5 seconds)');
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  private async deliver(): Promise<void> {
    try {
      const delivered = await negotiationService.deliverOwedNotifications();
      if (delivered > 0) this.logger.verbose('Delivered negotiation notifications', { delivered });
    } catch (error) {
      this.logger.error('Negotiation delivery pass failed', { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export const negotiationDeliveryCron = new NegotiationDeliveryCron();
