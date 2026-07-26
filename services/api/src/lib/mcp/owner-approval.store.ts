/**
 * IND-593 Batch A: injected async challenge store for the opportunity
 * owner-approval authority.
 *
 * The authority (owner-approval.ts) keeps NO process-local state: every
 * challenge lifecycle transition goes through this store so that any number of
 * authority instances — the MCP composition and the direct tool composition
 * in-process today, multiple API replicas over Redis in production — observe
 * one atomic one-shot issuance and exactly-one consumption per challenge.
 *
 * Contract:
 * - Keys are opaque hashes derived by the authority (never raw interaction
 *   ids); adapters must not need to interpret them.
 * - `record` is an opaque JSON string owned by the authority; it embeds the
 *   challenge's own expiry, which the authority (not the store) judges for
 *   `stale` verdicts.
 * - Adapters retain entries for RETENTION_FACTOR × ttlMs so recently-expired
 *   challenges still resolve to a `stale` (not `unknown`) outcome, then evict
 *   them entirely (TTL cleanup — no unbounded growth).
 * - `issueOnce` and `consumeOnce` must be atomic: exactly one concurrent
 *   caller wins, in-process and cross-instance alike.
 * - Adapters may throw on backend failure; the authority fails closed.
 */

export type OwnerApprovalPeek =
  | { state: 'pending'; record: string; issued: boolean }
  | { state: 'consumed' }
  | { state: 'absent' };

export interface OpportunityOwnerApprovalStore {
  /** Register a fresh challenge record under an opaque key with TTL cleanup. */
  putChallenge(key: string, record: string, ttlMs: number): Promise<void>;
  /** Non-mutating read of the challenge state. */
  peekChallenge(key: string): Promise<OwnerApprovalPeek>;
  /** Atomically flip the one-shot issued flag; exactly one caller wins. */
  issueOnce(key: string): Promise<'issued' | 'already_issued' | 'absent'>;
  /**
   * Atomically consume the challenge and arm a replay marker: exactly one
   * concurrent caller observes `consumed`; later callers observe `replayed`
   * until the marker's TTL lapses; unknown/evicted keys observe `absent`.
   */
  consumeOnce(key: string, replayTtlMs: number): Promise<'consumed' | 'replayed' | 'absent'>;
}

/** Entries are retained for this multiple of their TTL before eviction. */
export const OWNER_APPROVAL_RETENTION_FACTOR = 2;

export interface MemoryOwnerApprovalStoreOptions {
  /** Clock override for deterministic tests. */
  now?: () => number;
}

type MemoryChallenge = {
  record: string;
  issued: boolean;
  /** Absolute eviction time (retention window, not challenge expiry). */
  retainUntilMs: number;
};

/**
 * In-memory adapter: an explicitly injected deterministic test double ONLY.
 * It is never selected by environment fallback in production composition —
 * the production authority requires the shared Redis store and fails closed
 * (`unavailable`) when Redis is unconfigured or unreachable, because a silent
 * process-local store would void the cross-replica single-use guarantee.
 * Mutating operations are synchronous under the hood, so one-shot issue and
 * exactly-one consume hold under concurrent async callers.
 */
export function createMemoryOwnerApprovalStore(
  options: MemoryOwnerApprovalStoreOptions = {},
): OpportunityOwnerApprovalStore {
  const now = options.now ?? (() => Date.now());
  const challenges = new Map<string, MemoryChallenge>();
  const replayMarkers = new Map<string, number>(); // key -> marker expiry ms

  /** Lazy TTL cleanup keeping both maps bounded without a timer. */
  function sweep(): void {
    const at = now();
    for (const [key, entry] of challenges) {
      if (entry.retainUntilMs <= at) challenges.delete(key);
    }
    for (const [key, expiresAtMs] of replayMarkers) {
      if (expiresAtMs <= at) replayMarkers.delete(key);
    }
  }

  function liveChallenge(key: string): MemoryChallenge | undefined {
    const entry = challenges.get(key);
    if (!entry) return undefined;
    if (entry.retainUntilMs <= now()) {
      challenges.delete(key);
      return undefined;
    }
    return entry;
  }

  function liveMarker(key: string): boolean {
    const expiresAtMs = replayMarkers.get(key);
    if (expiresAtMs === undefined) return false;
    if (expiresAtMs <= now()) {
      replayMarkers.delete(key);
      return false;
    }
    return true;
  }

  return {
    async putChallenge(key, record, ttlMs) {
      sweep();
      challenges.set(key, {
        record,
        issued: false,
        retainUntilMs: now() + ttlMs * OWNER_APPROVAL_RETENTION_FACTOR,
      });
    },

    async peekChallenge(key) {
      if (liveMarker(key)) return { state: 'consumed' };
      const entry = liveChallenge(key);
      if (!entry) return { state: 'absent' };
      return { state: 'pending', record: entry.record, issued: entry.issued };
    },

    async issueOnce(key) {
      const entry = liveChallenge(key);
      if (!entry) return 'absent';
      if (entry.issued) return 'already_issued';
      entry.issued = true;
      return 'issued';
    },

    async consumeOnce(key, replayTtlMs) {
      if (liveMarker(key)) return 'replayed';
      const entry = liveChallenge(key);
      if (!entry) return 'absent';
      challenges.delete(key);
      replayMarkers.set(key, now() + replayTtlMs);
      return 'consumed';
    },
  };
}
