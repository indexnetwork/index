import { describe, expect, it, mock } from 'bun:test';

import { deriveLegacyNegotiationParkOrigin, RedisTimeoutUpgradeLease, TimeoutUpgradeReconciler, type TimeoutUpgradeJobIntent, type TimeoutUpgradeLease } from '../../lib/negotiation/timeout-upgrade-reconciliation';

const NOW = Date.parse('2026-08-07T00:05:00.000Z');
const parkedContinuation = {
  priorTaskId: 'prior', settlementId: 'settlement', successorTaskId: 'successor',
  token: 'token', fence: 4,
};

function row(id: string, overrides: Partial<TimeoutUpgradeJobIntent> = {}): TimeoutUpgradeJobIntent {
  return {
    taskId: id,
    state: 'waiting_for_agent',
    turnNumber: 0,
    generation: `generation-${id}`,
    deadlineAt: '2026-08-07T00:06:00.000Z',
    ...overrides,
  };
}

class MemoryLease implements TimeoutUpgradeLease {
  owner: string | null = null;
  expiresAt = 0;
  failedAcquisitions = 0;

  constructor(private readonly clock: () => number = Date.now) {}

  async tryAcquire(ownerId: string, ttlMs: number): Promise<boolean> {
    if (this.owner && this.expiresAt > this.clock()) {
      this.failedAcquisitions += 1;
      return false;
    }
    this.owner = ownerId;
    this.expiresAt = this.clock() + ttlMs;
    return true;
  }

  async renew(ownerId: string, ttlMs: number): Promise<boolean> {
    if (this.owner !== ownerId || this.expiresAt <= this.clock()) return false;
    this.expiresAt = this.clock() + ttlMs;
    return true;
  }

  async release(ownerId: string): Promise<void> {
    if (this.owner === ownerId) this.owner = null;
  }
}

function fixture(initial: TimeoutUpgradeJobIntent[], options: { locked?: () => boolean } = {}) {
  const pending = [...initial];
  const preparedBatches: string[][] = [];
  const prepare = mock(async ({ limit }: { limit: number }) => {
    if (options.locked?.()) return [];
    const selected = pending.slice(0, limit);
    preparedBatches.push(selected.map((item) => item.taskId));
    return selected;
  });
  const count = mock(async () => pending.length);
  const acknowledge = mock(async ({ taskId, generation }: { taskId: string; generation: string }) => {
    const index = pending.findIndex((item) => item.taskId === taskId && item.generation === generation);
    if (index < 0) return false;
    pending.splice(index, 1);
    return true;
  });
  const enqueueOrdinary = mock(async () => 'ordinary-job');
  const enqueueClaim = mock(async () => 'claim-job');
  return {
    pending,
    preparedBatches,
    prepare,
    count,
    acknowledge,
    enqueueOrdinary,
    enqueueClaim,
    store: {
      prepareLegacyNegotiationTimeoutBatch: prepare,
      countPendingLegacyNegotiationTimeouts: count,
      markLegacyNegotiationTimeoutJobInstalled: acknowledge,
    },
    queues: { enqueueOrdinary, enqueueClaim },
  };
}

function reconciler(
  h: ReturnType<typeof fixture>,
  lease: TimeoutUpgradeLease = new MemoryLease(),
  now: () => number = () => NOW,
  sleep: (ms: number) => Promise<void> = (ms) => Bun.sleep(ms),
  owner = crypto.randomUUID(),
) {
  return new TimeoutUpgradeReconciler(h.store, h.queues, lease, now, sleep, owner);
}

describe('legacy timeout park chronology', () => {
  it('uses preserved pre-claim statusTimestamp for actual old claimed metadata, never claim-time updatedAt', () => {
    const parkAt = new Date('2020-01-02T03:04:05.000Z');
    const claimAt = new Date('2020-01-02T03:05:05.000Z');
    expect(deriveLegacyNegotiationParkOrigin({
      taskId: 'legacy-claimed',
      state: 'claimed',
      metadata: { type: 'negotiation', legacyPollingMetadata: { claimedBy: 'agent-1' } },
      statusTimestamp: parkAt,
      claimedAt: claimAt,
    })).toEqual(parkAt);
  });

  it('fails closed for malformed or reversed historical chronology', () => {
    expect(() => deriveLegacyNegotiationParkOrigin({
      taskId: 'malformed-origin',
      state: 'claimed',
      metadata: { type: 'negotiation', hermesParkStartedAt: 'not-a-date' },
      statusTimestamp: new Date('2020-01-02T03:04:05.000Z'),
      claimedAt: new Date('2020-01-02T03:05:05.000Z'),
    })).toThrow('no valid park chronology');
    expect(() => deriveLegacyNegotiationParkOrigin({
      taskId: 'reversed-origin',
      state: 'claimed',
      metadata: { type: 'negotiation' },
      statusTimestamp: new Date('2020-01-02T03:06:05.000Z'),
      claimedAt: new Date('2020-01-02T03:05:05.000Z'),
    })).toThrow('malformed chronology');
  });
});

describe('TimeoutUpgradeReconciler serialized startup seam', () => {
  it('installs ordinary, claimed, and parked-continuation replacements with preserved remaining delay', async () => {
    const h = fixture([
      row('waiting', { turnNumber: 2, generation: 'legacy-park:waiting:origin' }),
      row('claimed', {
        state: 'claimed', turnNumber: 3, agentId: 'agent-1',
        generation: '2026-08-07T00:01:00.000Z', deadlineAt: '2026-08-07T00:04:00.000Z',
      }),
      row('continuation', {
        turnNumber: 4, generation: 'legacy-park:continuation:origin',
        deadlineAt: '2026-08-07T00:07:00.000Z', continuation: parkedContinuation,
      }),
    ]);

    await expect(reconciler(h).reconcile({ parkWindowMs: 300_000, batchSize: 3 }))
      .resolves.toEqual({ batches: 1, prepared: 3, installed: 3, pending: 0, exhausted: true });
    expect(h.enqueueOrdinary).toHaveBeenNthCalledWith(
      1, 'waiting', 2, 60_000, 'legacy-park:waiting:origin', undefined,
    );
    expect(h.enqueueClaim).toHaveBeenCalledWith(
      'claimed', 3, 'agent-1', '2026-08-07T00:01:00.000Z', 0, undefined,
    );
    expect(h.enqueueOrdinary).toHaveBeenNthCalledWith(
      2, 'continuation', 4, 120_000, 'legacy-park:continuation:origin', parkedContinuation,
    );
  });

  it('processes disjoint batches under one lease and peers wait then observe the completed reconciliation', async () => {
    const h = fixture([row('a'), row('b'), row('c'), row('d')]);
    const lease = new MemoryLease();
    h.enqueueOrdinary.mockImplementation(async () => {
      await Bun.sleep(3);
      return 'job';
    });
    const first = reconciler(h, lease, () => Date.now(), (ms) => Bun.sleep(ms), 'starter-a');
    const peer = reconciler(h, lease, () => Date.now(), (ms) => Bun.sleep(ms), 'starter-b');

    const [firstResult, peerResult] = await Promise.all([
      first.reconcile({ parkWindowMs: 300_000, batchSize: 2, maxBatches: 2, leaseRetryMs: 1 }),
      peer.reconcile({ parkWindowMs: 300_000, batchSize: 2, maxBatches: 2, leaseRetryMs: 1 }),
    ]);

    expect(firstResult).toMatchObject({ batches: 2, installed: 4, pending: 0, exhausted: true });
    expect(peerResult).toMatchObject({ batches: 0, installed: 0, pending: 0, exhausted: true });
    expect(h.preparedBatches).toEqual([['a', 'b'], ['c', 'd']]);
    expect(lease.failedAcquisitions).toBeGreaterThan(0);
  });

  it('leaves a crash-before-delivery row pending and a later starter takes over after lease expiry', async () => {
    let clock = 0;
    const lease = new MemoryLease(() => clock);
    expect(await lease.tryAcquire('crashed-peer', 5)).toBe(true);
    const h = fixture([row('recoverable')]);
    const takeover = reconciler(
      h,
      lease,
      () => clock,
      async (delayMs) => { clock += delayMs; },
      'takeover-peer',
    );

    await expect(takeover.reconcile({
      parkWindowMs: 300_000,
      leaseTtlMs: 1_000,
      leaseRetryMs: 5,
      leaseWaitTimeoutMs: 2_000,
    })).resolves.toMatchObject({ installed: 1, pending: 0, exhausted: true });
    expect(lease.failedAcquisitions).toBeGreaterThan(0);
  });

  it('keeps the durable install outbox pending when queue delivery fails, then retries safely', async () => {
    const intent = row('waiting');
    const h = fixture([intent]);
    h.enqueueOrdinary.mockRejectedValueOnce(new Error('redis unavailable'));

    await expect(reconciler(h).reconcile({ parkWindowMs: 300_000 })).rejects.toThrow('redis unavailable');
    expect(h.acknowledge).not.toHaveBeenCalled();
    expect(h.pending).toEqual([intent]);

    await expect(reconciler(h).reconcile({ parkWindowMs: 300_000 }))
      .resolves.toMatchObject({ installed: 1, pending: 0, exhausted: true });
  });

  it('uses a final authoritative probe so exact capacity succeeds and capacity plus one fails closed', async () => {
    const exact = fixture([row('a'), row('b'), row('c'), row('d')]);
    await expect(reconciler(exact).reconcile({ parkWindowMs: 300_000, batchSize: 2, maxBatches: 2 }))
      .resolves.toEqual({ batches: 2, prepared: 4, installed: 4, pending: 0, exhausted: true });
    expect(exact.count).toHaveBeenCalledTimes(3);

    const over = fixture([row('a'), row('b'), row('c'), row('d'), row('e')]);
    await expect(reconciler(over).reconcile({ parkWindowMs: 300_000, batchSize: 2, maxBatches: 2 }))
      .resolves.toEqual({ batches: 2, prepared: 4, installed: 4, pending: 1, exhausted: false });
    expect(over.pending.map((item) => item.taskId)).toEqual(['e']);
  });

  it('does not infer exhaustion from temporarily row-locked empty scans', async () => {
    let locked = true;
    let sleeps = 0;
    const h = fixture([row('locked')], { locked: () => locked });
    const result = await reconciler(h, new MemoryLease(), () => NOW, async () => {
      sleeps += 1;
      locked = false;
    }).reconcile({
      parkWindowMs: 300_000,
      batchSize: 1,
      maxBatches: 1,
      quiescentRetryLimit: 2,
    });

    expect(result).toEqual({ batches: 1, prepared: 1, installed: 1, pending: 0, exhausted: true });
    expect(sleeps).toBe(1);
    expect(h.count).toHaveBeenCalledTimes(3);
  });

  it('fails closed when rows remain locked through the bounded quiescent rescan', async () => {
    const h = fixture([row('locked')], { locked: () => true });
    await expect(reconciler(h, new MemoryLease(), () => NOW, async () => undefined).reconcile({
      parkWindowMs: 300_000,
      quiescentRetryLimit: 2,
    })).resolves.toEqual({ batches: 0, prepared: 0, installed: 0, pending: 1, exhausted: false });
  });
});

describe('RedisTimeoutUpgradeLease ownership', () => {
  it('uses owner-checked TTL renewal and release', async () => {
    let owner: string | null = null;
    let expiresAt = 0;
    let now = 0;
    const redis = {
      set: mock(async (_key: string, value: string, _px: 'PX', ttl: number, _nx: 'NX') => {
        if (owner && expiresAt > now) return null;
        owner = value;
        expiresAt = now + ttl;
        return 'OK';
      }),
      eval: mock(async (script: string, _keys: number, _key: string, expectedOwner: string, ttl?: number) => {
        if (owner !== expectedOwner || expiresAt <= now) return 0;
        if (script.includes('timeout-upgrade:renew')) {
          expiresAt = now + Number(ttl);
          return 1;
        }
        owner = null;
        return 1;
      }),
    };
    const lease = new RedisTimeoutUpgradeLease(redis);

    expect(await lease.tryAcquire('a', 10)).toBe(true);
    expect(await lease.tryAcquire('b', 10)).toBe(false);
    expect(await lease.renew('b', 20)).toBe(false);
    expect(await lease.renew('a', 20)).toBe(true);
    now = 25;
    expect(await lease.tryAcquire('b', 10)).toBe(true);
    await lease.release('a');
    expect(owner).toBe('b');
    await lease.release('b');
    expect(owner).toBeNull();
  });
});
