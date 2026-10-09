import '@indexnetwork/api/src/startup.env';
import '@indexnetwork/api/src/bootstrap';

import cron from 'node-cron';

import { closeDb } from '@indexnetwork/api/src/lib/drizzle/drizzle';
import { log } from '@indexnetwork/api/src/lib/log';

import { outreachPass, seedPass } from './ghost';

const logger = log.job.from('ghost.main');

const schedule = process.env.GHOST_NETWORK_SCHEDULE;
if (!schedule) throw new Error('GHOST_NETWORK_SCHEDULE is required.');

let running: Promise<void> | null = null;

const task = cron.schedule(schedule, () => {
  // A pass can outlast the interval; the next tick waits for the next slot.
  if (running) return;
  running = (async () => {
    try {
      const paired = await seedPass();
      const sent = await outreachPass();
      logger.info('Ghost network pass', { paired, sent });
    } catch (error) {
      logger.error('Ghost network pass failed', { error: error instanceof Error ? error.message : String(error) });
    }
  })().finally(() => { running = null; });
});
logger.info('Ghost network running', { schedule });

const shutdown = async () => {
  logger.info('Shutting down...');
  task.stop();
  await running;
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
