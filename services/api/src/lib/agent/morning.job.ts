import cron from 'node-cron';

import type { Intent } from '@indexnetwork/agent';

import { log } from '../log';

import { HostedIndex } from './hosted.index';
import { createMorningBrief } from './morning';
import { claimMorningBrief, listHostedOwners, networkedIntentIds } from './morning.store';

/**
 * Start the minute tick that wakes hosted owners in the hour after their
 * local 08:00. Each owner keeps one stable minute, and only one process
 * claims the day.
 *
 * @param options - Where one signal's morning wake runs.
 * @returns A stop handle for shutdown.
 */
export function startMorningBrief(options: {
  wake: (userId: string, intent: Intent) => Promise<void>;
}): { stop: () => void } {
  const logger = log.agent.from('MorningBrief');
  const brief = createMorningBrief({
    listHostedOwners,
    claim: claimMorningBrief,
    onError: (error) => {
      logger.error('Morning pass failed', { error: error instanceof Error ? error.message : String(error) });
    },
    work: async (owner) => {
      const networks = await networkedIntentIds(owner.id);
      const intents = (await new HostedIndex(owner.id).listIntents())
        .filter((item) => item.status === 'active' && networks.has(item.id));
      for (const item of intents) {
        await options.wake(owner.id, { id: item.id, statement: item.statement });
      }
    },
  });
  const task = cron.schedule('* * * * *', () => {
    void brief.tick().catch((error: unknown) => {
      logger.error('Morning tick failed', { error: error instanceof Error ? error.message : String(error) });
    });
  });
  logger.info('Morning brief scheduled (every minute, staggered after 08:00 local)');
  return {
    stop() {
      task.stop();
    },
  };
}
