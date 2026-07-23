import { describe, expect, it } from 'bun:test';

import { runTasklessNegotiationReactivation } from '../negotiation-reactivation.atomic';

interface SimulatedOpportunity {
  status: 'negotiating' | 'latent';
  version: number;
  hasFreshTask: boolean;
}

class AsyncMutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  get waiterCount(): number {
    return this.waiters.length;
  }

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
      return;
    }
    this.locked = false;
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => resolve?.(),
  };
}

async function createTaskForOldClaim(
  opportunity: SimulatedOpportunity,
  mutex: AsyncMutex,
  expectedVersion: number,
  holdAfterInsert?: Promise<void>,
  inserted?: () => void,
): Promise<'task' | null> {
  await mutex.acquire();
  try {
    if (opportunity.status !== 'negotiating' || opportunity.version !== expectedVersion) {
      return null;
    }
    opportunity.hasFreshTask = true;
    inserted?.();
    await holdAfterInsert;
    return 'task';
  } finally {
    mutex.release();
  }
}

function reactivate(
  opportunity: SimulatedOpportunity,
  mutex: AsyncMutex,
  beforeMutation?: () => Promise<void>,
): Promise<{ status: 'latent'; version: number } | null> {
  return (async () => {
    try {
      return await runTasklessNegotiationReactivation({
        acquireAttemptLock: () => mutex.acquire(),
        validateEligibility: async () => true,
        lockOpportunity: async () => ({ status: opportunity.status }),
        hasFreshNegotiationTask: async () => opportunity.hasFreshTask,
        reactivate: async () => {
          await beforeMutation?.();
          opportunity.status = 'latent';
          opportunity.version += 1;
          return { status: opportunity.status, version: opportunity.version };
        },
      });
    } finally {
      mutex.release();
    }
  })();
}

describe('taskless negotiation reactivation boundary', () => {
  it('returns null without changing the opportunity when task creation wins', async () => {
    const opportunity: SimulatedOpportunity = {
      status: 'negotiating',
      version: 7,
      hasFreshTask: false,
    };
    const mutex = new AsyncMutex();
    const taskInserted = deferred();
    const releaseTask = deferred();

    const task = createTaskForOldClaim(
      opportunity,
      mutex,
      7,
      releaseTask.promise,
      taskInserted.resolve,
    );
    await taskInserted.promise;

    const reactivation = reactivate(opportunity, mutex);
    expect(mutex.waiterCount).toBe(1);
    releaseTask.resolve();

    expect(await task).toBe('task');
    expect(await reactivation).toBeNull();
    expect(opportunity).toEqual({
      status: 'negotiating',
      version: 7,
      hasFreshTask: true,
    });
  });

  it('makes a later old-claim task fail when reactivation wins the row boundary', async () => {
    const opportunity: SimulatedOpportunity = {
      status: 'negotiating',
      version: 11,
      hasFreshTask: false,
    };
    const mutex = new AsyncMutex();
    const mutationReady = deferred();
    const releaseMutation = deferred();

    const reactivation = reactivate(opportunity, mutex, async () => {
      mutationReady.resolve();
      await releaseMutation.promise;
    });
    await mutationReady.promise;

    const task = createTaskForOldClaim(opportunity, mutex, 11);
    expect(mutex.waiterCount).toBe(1);
    releaseMutation.resolve();

    expect(await reactivation).toEqual({ status: 'latent', version: 12 });
    expect(await task).toBeNull();
    expect(opportunity).toEqual({
      status: 'latent',
      version: 12,
      hasFreshTask: false,
    });
  });
});
