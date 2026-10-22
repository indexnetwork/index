import './startup.env';
import './bootstrap';

import * as Sentry from '@sentry/bun';
import cron from 'node-cron';

import { createDecide, createModel } from '@indexnetwork/agent';

import { HostedAgent } from './lib/agent/hosted.agent';
import { startMorningBrief } from './lib/agent/morning.job';
import { log } from './lib/log';
import { McpEventDispatcher } from './lib/mcp/mcp-events.dispatcher';

const logger = log.agent.from('hosted-agents.main');

// Attributes this process's OpenRouter spend apart from the API's protocol agents.
const headers = { 'HTTP-Referer': 'https://index.network/hosted-agent', 'X-Title': 'Index Hosted Agent' };

// The default seat for owners without an external negotiator.
const apiKey = process.env.OPENROUTER_API_KEY!;
const hostedAgent = new HostedAgent(createModel({ apiKey, headers }), createDecide({ apiKey, headers }));
void hostedAgent.start();
const morningDisabled = process.env.DISABLE_MORNING_BRIEF === 'true';
const morning = morningDisabled
  ? { stop() {} }
  : startMorningBrief({
      wake: (userId, intent, since) => hostedAgent.morningWake(userId, intent, since),
    });
if (morningDisabled) logger.info('Morning brief disabled (DISABLE_MORNING_BRIEF)');
const questionSweep = cron.schedule('*/15 * * * *', () => {
  void hostedAgent.expireQuestions().catch((error: unknown) => {
    logger.error('Question sweep failed', { error: error instanceof Error ? error.message : String(error) });
  });
});
const mcpEventDispatcher = new McpEventDispatcher();
mcpEventDispatcher.start();
logger.info('Hosted agents running');

const shutdown = async () => {
  logger.info('Shutting down...');
  morning.stop();
  questionSweep.stop();
  mcpEventDispatcher.stop();
  await hostedAgent.stop();
  await Sentry.close(2000);
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
