import '@indexnetwork/api/src/startup.env';
import '@indexnetwork/api/src/bootstrap';

import { closeDb } from '@indexnetwork/api/src/lib/drizzle/drizzle';
import { log } from '@indexnetwork/api/src/lib/log';

import { startListener, stopListener } from './listen';

const logger = log.job.from('ghost.main');

startListener();
logger.info('Ghost network listening');

const shutdown = async () => {
  logger.info('Shutting down...');
  await stopListener();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
