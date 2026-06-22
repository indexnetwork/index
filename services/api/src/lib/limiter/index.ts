import type { LimiterStorage } from './storage';
import { MemoryStorage } from './storage.memory';
import { log } from '../log';

const logger = log.server.from('limiter');

let storagePromise: Promise<LimiterStorage> | null = null;

export async function getStorage(): Promise<LimiterStorage> {
  if (!storagePromise) storagePromise = init();
  try {
    return await storagePromise;
  } catch (err) {
    storagePromise = null; // allow next call to retry
    throw err;
  }
}

async function init(): Promise<LimiterStorage> {
  // Check via the side-effect-free env detector BEFORE importing cache.adapter
  // (which eagerly constructs Redis-backed cache singletons at module load).
  const { isRedisConfigured } = await import('../redis-env');
  if (!isRedisConfigured()) {
    logger.warn('Limiter using in-memory storage (DEV ONLY — not multi-instance safe)');
    return new MemoryStorage();
  }
  const { getRedisClient } = await import('../../adapters/cache.adapter');
  const { RedisStorage } = await import('./storage.redis');
  const s = new RedisStorage(getRedisClient());
  await s.bootstrap();
  logger.info('Limiter using Redis storage');
  return s;
}

export { CLASS_CONFIG, resolveClassConfig, isLimiterDisabled } from './config';
export type { LimiterClass } from './config';
export type { LimiterStorage, HitResult } from './storage';
