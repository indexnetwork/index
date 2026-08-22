/**
 * Same-intent overlap guard for intent-triggered discovery.
 *
 * Enqueue-time BullMQ deduplication (the IND-419 tier-1 debounce) only covers
 * jobs that are still waiting: once job A for intent X is active, a second
 * enqueue for X is admitted and — now that the from-intent worker runs several
 * jobs at once — would start alongside A. Persistence already tolerates that
 * overlap (pair dedup IND-166, the `final_atomic_conflict` re-check, the
 * intent-scoped atomic create+expire), so this guard is not a correctness gate;
 * it stops two runs spending LLM and embedder budget on the same intent at the
 * same time. It is the cheapest correct shape: a short-TTL Redis lock keyed by
 * intentId (`SET NX PX` + holder-checked release), with an in-process map in the
 * hermetic test baseline so worker specs exercise the real acquire→defer path
 * without Redis.
 */
import { useHermeticRedis } from '../../lib/bullmq/bullmq';

export interface IntentDiscoveryLock {
  /** True when this caller now holds the intent's lock for `ttlMs`. */
  tryAcquire(intentId: string, token: string, ttlMs: number): Promise<boolean>;
  /** Releases only when `token` is the current holder; a lapsed lock is a no-op. */
  release(intentId: string, token: string): Promise<void>;
}

const LOCK_KEY_PREFIX = 'opportunity:from-intent:running:';

const RELEASE_LUA = `
-- from-intent lock release: only the holder may delete.
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

interface RedisLockClient {
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export class RedisIntentDiscoveryLock implements IntentDiscoveryLock {
  constructor(private readonly getClient: () => Promise<RedisLockClient>) {}

  async tryAcquire(intentId: string, token: string, ttlMs: number): Promise<boolean> {
    const redis = await this.getClient();
    return await redis.set(LOCK_KEY_PREFIX + intentId, token, 'PX', ttlMs, 'NX') === 'OK';
  }

  async release(intentId: string, token: string): Promise<void> {
    const redis = await this.getClient();
    await redis.eval(RELEASE_LUA, 1, LOCK_KEY_PREFIX + intentId, token);
  }
}

/**
 * Module-wide (not per-instance) so it models Redis faithfully: every
 * FromIntentQueue instance in a process sees the same locks.
 */
const hermeticLocks = new Map<string, { token: string; expiresAt: number }>();

export class InMemoryIntentDiscoveryLock implements IntentDiscoveryLock {
  async tryAcquire(intentId: string, token: string, ttlMs: number): Promise<boolean> {
    const existing = hermeticLocks.get(intentId);
    if (existing && existing.expiresAt > Date.now()) return false;
    hermeticLocks.set(intentId, { token, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async release(intentId: string, token: string): Promise<void> {
    if (hermeticLocks.get(intentId)?.token === token) hermeticLocks.delete(intentId);
  }
}

export function createIntentDiscoveryLock(): IntentDiscoveryLock {
  if (useHermeticRedis()) return new InMemoryIntentDiscoveryLock();
  // Lazy so importing the queue module never constructs the cache adapter's
  // Redis singletons (same pattern as intent-agent-reply.stream).
  return new RedisIntentDiscoveryLock(async () => {
    const { getRedisClient } = await import('../../adapters/cache.adapter');
    return getRedisClient();
  });
}
