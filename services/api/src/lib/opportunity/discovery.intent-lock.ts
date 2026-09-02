/**
 * Same-intent overlap guard for intent-triggered discovery.
 *
 * Discovery is unbounded and runs concurrently across signals, so a second
 * trigger for one already-scanning intent would otherwise start alongside
 * it. Persistence already tolerates that overlap (pair dedup IND-166, the
 * `final_atomic_conflict` re-check, the intent-scoped atomic create+expire),
 * so this guard is not a correctness gate; it stops two runs spending LLM and
 * embedder budget on the same intent at the same time. An in-process map
 * keyed by intentId, scoped to this process only — fine, since the API is
 * single-replica.
 */
export interface IntentDiscoveryLock {
  /** True when this caller now holds the intent's lock for `ttlMs`. */
  tryAcquire(intentId: string, token: string, ttlMs: number): Promise<boolean>;
  /** Releases only when `token` is the current holder; a lapsed lock is a no-op. */
  release(intentId: string, token: string): Promise<void>;
}

/** Module-wide (not per-instance): every IntentDiscovery instance in a process sees the same locks. */
const locks = new Map<string, { token: string; expiresAt: number }>();

export class InMemoryIntentDiscoveryLock implements IntentDiscoveryLock {
  async tryAcquire(intentId: string, token: string, ttlMs: number): Promise<boolean> {
    const existing = locks.get(intentId);
    if (existing && existing.expiresAt > Date.now()) return false;
    locks.set(intentId, { token, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async release(intentId: string, token: string): Promise<void> {
    if (locks.get(intentId)?.token === token) locks.delete(intentId);
  }
}

export function createIntentDiscoveryLock(): IntentDiscoveryLock {
  return new InMemoryIntentDiscoveryLock();
}
