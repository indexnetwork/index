import type { LimiterStorage } from './storage';
import { MemoryStorage } from './storage.memory';
import { log } from '../log';

const logger = log.server.from('limiter');

let storagePromise: Promise<LimiterStorage> | null = null;

export async function getStorage(): Promise<LimiterStorage> {
  if (!storagePromise) storagePromise = init();
  return storagePromise;
}

async function init(): Promise<LimiterStorage> {
  if (!process.env.REDIS_URL) {
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
