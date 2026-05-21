/**
 * Bull Board UI for queue monitoring (dev only).
 *
 * Served at /dev/queues when NODE_ENV !== 'production'.
 * Uses @bull-board/hono because Hono uses the standard fetch Request/Response API,
 * which Bun.serve() supports natively.
 */
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { HonoAdapter } from '@bull-board/hono';
import { serveStatic } from 'hono/bun';
import { Hono } from 'hono';

import { notificationQueue } from '../queues/notification.queue';
import { intentQueue } from '../queues/intent.queue';
import { fromIntentQueue } from '../queues/opportunity/from-intent.queue';
import { fromIntroducerQueue } from '../queues/opportunity/from-introducer.queue';
import { negotiationRunExistingQueue } from '../queues/negotiations/run-existing.queue';
import { profileQueue } from '../queues/profile.queue';
import { emailQueue } from '../queues/email.queue';
import { log } from '../lib/log';

const logger = log.controller.from('dev/queues');

/** Base path for the Bull Board UI (e.g. http://localhost:3001/dev/queues/). */
const BASE_PATH = '/dev/queues';

const app = new Hono();

const serverAdapter = new HonoAdapter(serveStatic);

createBullBoard({
  queues: [
    new BullMQAdapter(notificationQueue.queue),
    new BullMQAdapter(intentQueue.queue),
    new BullMQAdapter(fromIntentQueue.queue),
    new BullMQAdapter(fromIntroducerQueue.queue),
    new BullMQAdapter(negotiationRunExistingQueue.queue),
    new BullMQAdapter(profileQueue.queue),
    new BullMQAdapter(emailQueue.queue),
  ],
  serverAdapter,
});

serverAdapter.setBasePath(BASE_PATH);
const boardApp = serverAdapter.registerPlugin();

// Forward exact BASE_PATH and BASE_PATH/ to the board with path '/' so the entry route matches.
app.get(BASE_PATH, (c) => c.redirect(`${BASE_PATH}/`, 302));
app.get(`${BASE_PATH}/`, async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/';
  const req = new Request(url.toString(), { method: 'GET', headers: c.req.raw.headers });
  return boardApp.fetch(req);
});
app.route(`${BASE_PATH}/`, boardApp);

app.get('/', (c) => c.redirect(`${BASE_PATH}/`, 302));

/** Hono app that serves Bull Board at BASE_PATH. Mounted in main server only when not in production. */
export const adminQueuesApp = app;

logger.info('Dev queues controller initialized', { basePath: BASE_PATH });
