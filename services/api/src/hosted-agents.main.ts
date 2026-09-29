import './startup.env';
import './bootstrap';

import * as Sentry from '@sentry/bun';

import { ModelClient } from '@indexnetwork/agent';

import { HostedAgent } from './lib/agent/hosted.agent';
import { log } from './lib/log';

const logger = log.agent.from('hosted-agents.main');

// The default seat for owners without an external negotiator.
const hostedAgent = new HostedAgent(new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY! }));
void hostedAgent.start();
logger.info('Hosted agents running');

const shutdown = async () => {
  logger.info('Shutting down...');
  await hostedAgent.stop();
  await Sentry.close(2000);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
