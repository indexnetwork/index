import './startup.env';
import './bootstrap';

import * as Sentry from '@sentry/bun';

import { ModelClient } from '@indexnetwork/agent';

import { HostedAgent } from './lib/agent/hosted.agent';
import { startMorningBrief } from './lib/agent/morning.job';
import { log } from './lib/log';
import { McpEventDispatcher } from './lib/mcp/mcp-events.dispatcher';

const logger = log.agent.from('hosted-agents.main');

// The default seat for owners without an external negotiator.
const hostedAgent = new HostedAgent(new ModelClient({ apiKey: process.env.OPENROUTER_API_KEY! }));
void hostedAgent.start();
const morningDisabled = process.env.DISABLE_MORNING_BRIEF === 'true';
const morning = morningDisabled
  ? { stop() {} }
  : startMorningBrief({
      wake: (userId, intent) => hostedAgent.morningWake(userId, intent),
    });
if (morningDisabled) logger.info('Morning brief disabled (DISABLE_MORNING_BRIEF)');
const mcpEventDispatcher = new McpEventDispatcher();
mcpEventDispatcher.start();
logger.info('Hosted agents running');

const shutdown = async () => {
  logger.info('Shutting down...');
  morning.stop();
  mcpEventDispatcher.stop();
  await hostedAgent.stop();
  await Sentry.close(2000);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
