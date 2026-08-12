import { randomUUID } from 'node:crypto';
import type { NegotiationContinuationTimeoutIdentity } from '@indexnetwork/protocol';

/** Derive a legacy park origin without ever consulting claim-time updatedAt. */
export function deriveLegacyNegotiationParkOrigin(input: {
  taskId: string;
  state: 'waiting_for_agent' | 'claimed';
  metadata: unknown;
  statusTimestamp: Date | null;
  claimedAt: Date | null;
}): Date {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const hasStoredOrigin = Object.prototype.hasOwnProperty.call(metadata, 'hermesParkStartedAt');
  const rawOrigin = hasStoredOrigin ? metadata.hermesParkStartedAt : input.statusTimestamp;
  const origin = typeof rawOrigin === 'string' || rawOrigin instanceof Date
    ? new Date(rawOrigin)
    : null;
  if (!origin || !Number.isFinite(origin.getTime())) {
    throw new Error(`Legacy negotiation timeout has no valid park chronology for ${input.taskId}`);
  }
  if (input.state === 'claimed') {
    const claimAt = input.claimedAt;
    if (!claimAt || !Number.isFinite(claimAt.getTime()) || origin.getTime() > claimAt.getTime()) {
      throw new Error(`Legacy claimed negotiation timeout has malformed chronology for ${input.taskId}`);
    }
  }
  return origin;
}

export interface TimeoutUpgradeJobIntent {
  taskId: string;
  state: 'waiting_for_agent' | 'claimed';
  turnNumber: number;
  generation: string;
  deadlineAt: string;
  agentId?: string;
  continuation?: NegotiationContinuationTimeoutIdentity;
}

export interface TimeoutUpgradeReconciliationStore {
  prepareLegacyNegotiationTimeoutBatch(input: {
    limit: number;
    parkWindowMs: number;
  }): Promise<TimeoutUpgradeJobIntent[]>;
  countPendingLegacyNegotiationTimeouts(): Promise<number>;
  markLegacyNegotiationTimeoutJobInstalled(input: {
    taskId: string;
    state: 'waiting_for_agent' | 'claimed';
    generation: string;
  }): Promise<boolean>;
}

export interface TimeoutUpgradeQueues {
  enqueueOrdinary(
    taskId: string,
    turnNumber: number,
    delayMs: number,
    parkGeneration: string,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ): Promise<unknown>;
  enqueueClaim(
    taskId: string,
    turnNumber: number,
    agentId: string,
    claimedAt: string,
    delayMs: number,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ): Promise<unknown>;
}

export interface TimeoutUpgradeLease {
  tryAcquire(ownerId: string, ttlMs: number): Promise<boolean>;
  renew(ownerId: string, ttlMs: number): Promise<boolean>;
  release(ownerId: string): Promise<void>;
}

export interface TimeoutUpgradeReconciliationResult {
  batches: number;
  prepared: number;
  installed: number;
  pending: number;
  exhausted: boolean;
}

interface RedisLeaseClient {
  set(key: string, value: string, mode: 'PX', ttlMs: number, condition: 'NX'): Promise<unknown>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

const TIMEOUT_UPGRADE_LEASE_KEY = 'index:negotiation-timeout-upgrade:v1';
const RENEW_LEASE_SCRIPT = `
-- timeout-upgrade:renew
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`;
const RELEASE_LEASE_SCRIPT = `
-- timeout-upgrade:release
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

/** Redis lease with compare-by-owner renewal/release and crash-recoverable TTL. */
export class RedisTimeoutUpgradeLease implements TimeoutUpgradeLease {
  constructor(
    private readonly redis: RedisLeaseClient,
    private readonly key = TIMEOUT_UPGRADE_LEASE_KEY,
  ) {}

  async tryAcquire(ownerId: string, ttlMs: number): Promise<boolean> {
    return await this.redis.set(this.key, ownerId, 'PX', ttlMs, 'NX') === 'OK';
  }

  async renew(ownerId: string, ttlMs: number): Promise<boolean> {
    return Number(await this.redis.eval(RENEW_LEASE_SCRIPT, 1, this.key, ownerId, ttlMs)) === 1;
  }

  async release(ownerId: string): Promise<void> {
    await this.redis.eval(RELEASE_LEASE_SCRIPT, 1, this.key, ownerId);
  }
}

/**
 * Serialized, bounded startup reconciliation. Every starter first owns the
 * distributed lease, then uses an authoritative count after each scan/delivery
 * pass. A short SKIP LOCKED batch is never treated as global exhaustion.
 */
export class TimeoutUpgradeReconciler {
  constructor(
    private readonly store: TimeoutUpgradeReconciliationStore,
    private readonly queues: TimeoutUpgradeQueues,
    private readonly lease: TimeoutUpgradeLease,
    private readonly now: () => number = Date.now,
    private readonly sleep: (delayMs: number) => Promise<void> = (delayMs) => Bun.sleep(delayMs),
    private readonly ownerId: string = randomUUID(),
  ) {}

  async reconcile(input: {
    parkWindowMs: number;
    batchSize?: number;
    maxBatches?: number;
    leaseTtlMs?: number;
    leaseRetryMs?: number;
    leaseWaitTimeoutMs?: number;
    quiescentRetryLimit?: number;
  }): Promise<TimeoutUpgradeReconciliationResult> {
    const batchSize = Math.max(1, Math.min(250, Math.floor(input.batchSize ?? 50)));
    const maxBatches = Math.max(1, Math.min(100, Math.floor(input.maxBatches ?? 20)));
    const leaseTtlMs = Math.max(1_000, Math.floor(input.leaseTtlMs ?? 30_000));
    const leaseRetryMs = Math.max(1, Math.floor(input.leaseRetryMs ?? 100));
    const leaseWaitTimeoutMs = Math.max(leaseTtlMs, Math.floor(input.leaseWaitTimeoutMs ?? 300_000));
    const quiescentRetryLimit = Math.max(1, Math.min(100, Math.floor(input.quiescentRetryLimit ?? 5)));
    const waitStartedAt = this.now();

    while (!await this.lease.tryAcquire(this.ownerId, leaseTtlMs)) {
      if (this.now() - waitStartedAt >= leaseWaitTimeoutMs) {
        throw new Error('Timed out waiting for negotiation timeout upgrade reconciliation lease');
      }
      await this.sleep(leaseRetryMs);
    }

    let leaseLost = false;
    let renewal = Promise.resolve();
    const renewEveryMs = Math.max(250, Math.floor(leaseTtlMs / 3));
    const renewalTimer = setInterval(() => {
      renewal = renewal.then(async () => {
        if (!await this.lease.renew(this.ownerId, leaseTtlMs)) leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, renewEveryMs);
    renewalTimer.unref?.();
    const assertLease = () => {
      if (leaseLost) throw new Error('Negotiation timeout upgrade reconciliation lease was lost');
    };

    try {
      let prepared = 0;
      let installed = 0;
      let batches = 0;
      let quiescentRetries = 0;
      let pending = await this.store.countPendingLegacyNegotiationTimeouts();
      assertLease();

      while (pending > 0 && batches < maxBatches) {
        const rows = await this.store.prepareLegacyNegotiationTimeoutBatch({
          limit: batchSize,
          parkWindowMs: input.parkWindowMs,
        });
        assertLease();
        if (rows.length === 0) {
          pending = await this.store.countPendingLegacyNegotiationTimeouts();
          assertLease();
          if (pending === 0) break;
          quiescentRetries += 1;
          if (quiescentRetries >= quiescentRetryLimit) {
            return { batches, prepared, installed, pending, exhausted: false };
          }
          await this.sleep(leaseRetryMs);
          assertLease();
          continue;
        }

        quiescentRetries = 0;
        batches += 1;
        prepared += rows.length;
        for (const row of rows) {
          const deadline = new Date(row.deadlineAt).getTime();
          if (!Number.isFinite(deadline)) throw new Error(`Malformed timeout upgrade deadline for ${row.taskId}`);
          const delayMs = Math.max(0, deadline - this.now());
          if (row.state === 'waiting_for_agent') {
            await this.queues.enqueueOrdinary(
              row.taskId,
              row.turnNumber,
              delayMs,
              row.generation,
              row.continuation,
            );
          } else {
            if (!row.agentId) throw new Error(`Claimed timeout upgrade lacks agent for ${row.taskId}`);
            await this.queues.enqueueClaim(
              row.taskId,
              row.turnNumber,
              row.agentId,
              row.generation,
              delayMs,
              row.continuation,
            );
          }
          assertLease();
          if (!await this.store.markLegacyNegotiationTimeoutJobInstalled({
            taskId: row.taskId,
            state: row.state,
            generation: row.generation,
          })) throw new Error(`Timeout upgrade generation changed before acknowledgement for ${row.taskId}`);
          assertLease();
          installed += 1;
        }

        // This is the authoritative final probe. It makes exact capacity
        // succeed and capacity+1 fail closed without trusting batch length.
        pending = await this.store.countPendingLegacyNegotiationTimeouts();
        assertLease();
      }

      return { batches, prepared, installed, pending, exhausted: pending === 0 };
    } finally {
      clearInterval(renewalTimer);
      await renewal;
      await this.lease.release(this.ownerId);
    }
  }
}
