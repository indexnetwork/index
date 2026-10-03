import { randomUUID } from 'node:crypto';

import cron from 'node-cron';

import type { Intent } from '@indexnetwork/agent';

import { createRedisClient } from '../../adapters/cache.adapter';
import { log } from '../log';

import { describeFailure } from './failure-line';
import { HostedIndex } from './hosted.index';
import { createMorningBrief } from './morning';
import { claimMorningBrief, listHostedOwners, networkedIntentIds } from './morning.store';

const LOCK_KEY = 'hosted:morning:tick';
/** Long enough that a refresh can slip, short enough that a dead process gives the pass back. */
const LOCK_TTL_SEC = 120;
const RELEASE_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const REFRESH_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end';

/**
 * One replica claims the minute. The gate stays held until that pass's work
 * finishes, so the others cannot each start their own cap.
 *
 * @returns A release, or null when another replica holds the pass.
 */
async function acquireMorningLock(): Promise<(() => Promise<void>) | null> {
  const redis = createRedisClient();
  const token = randomUUID();
  try {
    const acquired = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX');
    if (acquired !== 'OK') {
      redis.disconnect();
      return null;
    }
  } catch (error) {
    redis.disconnect();
    throw error;
  }

  const refresh = setInterval(() => {
    void redis.eval(REFRESH_LOCK, 1, LOCK_KEY, token, String(LOCK_TTL_SEC)).catch(() => undefined);
  }, (LOCK_TTL_SEC * 1000) / 3);
  refresh.unref();

  return async () => {
    clearInterval(refresh);
    try {
      await redis.eval(RELEASE_LOCK, 1, LOCK_KEY, token);
    } finally {
      redis.disconnect();
    }
  };
}

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
    lock: acquireMorningLock,
    onError: (error) => {
      logger.error(describeFailure('Morning pass failed', error), {
        error: error instanceof Error ? error.message : String(error),
      });
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
      logger.error(describeFailure('Morning tick failed', error), {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  logger.info('Morning brief scheduled (every minute, staggered after 08:00 local)');
  return {
    stop() {
      task.stop();
    },
  };
}
