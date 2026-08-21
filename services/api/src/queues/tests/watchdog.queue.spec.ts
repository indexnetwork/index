import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { JOB_NAME, MAX_WATCHDOG_ATTEMPTS, NegotiationWatchdogQueue, SCHEDULER_ID, SUBMITTED_STALE_AFTER_MS, WATCHDOG_INTERVAL_MS, WORKING_STALE_AFTER_MS } from '../negotiations/watchdog.queue';

const now = new Date('2026-07-21T15:00:00.000Z');

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    conversationId: 'conversation-1',
    state: 'submitted',
    createdAt: new Date(now.getTime() - SUBMITTED_STALE_AFTER_MS - 1),
    updatedAt: new Date(now.getTime() - SUBMITTED_STALE_AFTER_MS - 1),
    metadata: {
      type: 'negotiation',
      opportunityId: 'opportunity-1',
      sourceUserId: 'user-1',
    },
    ...overrides,
  };
}

function makeDeps(task: ReturnType<typeof makeTask> | null = makeTask()) {
  const stale = task ? [{
    id: task.id,
    conversationId: task.conversationId,
    state: task.state,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    metadata: task.metadata,
  }] : [];
  const database = {
    getStaleNegotiationTasks: mock(async () => stale),
    getTask: mock(async () => task),
    transitionNegotiationTaskForWatchdog: mock(async () => task),
  };
  const opportunities = {
    getOpportunity: mock(async () => ({ id: 'opportunity-1', status: 'negotiating' })),
  };
  const enqueueRunExisting = mock(async () => undefined);
  return { database, opportunities, enqueueRunExisting };
}

beforeEach(() => {
});

describe('NegotiationWatchdogQueue', () => {
  it('re-enqueues stale submitted tasks after a guarded cancellation and increments attempts', async () => {
    const deps = makeDeps();
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.getStaleNegotiationTasks).toHaveBeenCalledWith({
      submittedOlderThanMs: SUBMITTED_STALE_AFTER_MS,
      workingOlderThanMs: WORKING_STALE_AFTER_MS,
      limit: 25,
    });
    expect(deps.database.transitionNegotiationTaskForWatchdog).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 'task-1',
      expectedState: 'submitted',
      nextState: 'canceled',
      metadata: expect.objectContaining({ watchdogAttempts: 1 }),
    }));
    expect(deps.enqueueRunExisting).toHaveBeenCalledWith({
      opportunityId: 'opportunity-1',
      userId: 'user-1',
    });
  });

  it('re-enqueues stale working tasks using the working-state threshold', async () => {
    const task = makeTask({
      state: 'working',
      createdAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
      updatedAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
    });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.transitionNegotiationTaskForWatchdog).toHaveBeenCalledWith(expect.objectContaining({
      expectedState: 'working',
      nextState: 'canceled',
    }));
    expect(deps.enqueueRunExisting).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the task changed state after the stale-list read', async () => {
    const deps = makeDeps();
    deps.database.getTask.mockResolvedValue(makeTask({ state: 'completed' }) as never);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.database.transitionNegotiationTaskForWatchdog).not.toHaveBeenCalled();
    expect(deps.enqueueRunExisting).not.toHaveBeenCalled();
  });

  it('skips tasks whose opportunity is no longer negotiating', async () => {
    const deps = makeDeps();
    deps.opportunities.getOpportunity.mockResolvedValue({ id: 'opportunity-1', status: 'pending' } as never);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.database.transitionNegotiationTaskForWatchdog).not.toHaveBeenCalled();
    expect(deps.enqueueRunExisting).not.toHaveBeenCalled();
  });

  it('terminal-marks tasks that exhausted the watchdog retry budget without enqueueing', async () => {
    const task = makeTask({ metadata: {
      type: 'negotiation',
      opportunityId: 'opportunity-1',
      sourceUserId: 'user-1',
      watchdogAttempts: MAX_WATCHDOG_ATTEMPTS,
    } });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.transitionNegotiationTaskForWatchdog).toHaveBeenCalledWith(expect.objectContaining({
      nextState: 'failed',
      metadata: expect.objectContaining({ watchdogTerminalReason: 'watchdog_attempts_exhausted' }),
      statusMessage: { reason: 'negotiation_watchdog_terminal', detail: 'watchdog_attempts_exhausted' },
    }));
    expect(deps.enqueueRunExisting).not.toHaveBeenCalled();
  });

  it('terminal-marks legacy negotiation tasks with no opportunity ID', async () => {
    const task = makeTask({ metadata: { type: 'negotiation', sourceUserId: 'user-1' } });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.opportunities.getOpportunity).not.toHaveBeenCalled();
    expect(deps.database.transitionNegotiationTaskForWatchdog).toHaveBeenCalledWith(expect.objectContaining({
      nextState: 'failed',
      metadata: expect.objectContaining({ watchdogTerminalReason: 'missing_opportunity_id' }),
    }));
    expect(deps.enqueueRunExisting).not.toHaveBeenCalled();
  });

  it('makes no mutations for a healthy sweep', async () => {
    const deps = makeDeps(null);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.database.getTask).not.toHaveBeenCalled();
    expect(deps.database.transitionNegotiationTaskForWatchdog).not.toHaveBeenCalled();
    expect(deps.enqueueRunExisting).not.toHaveBeenCalled();
  });

  it('flag on registers the five-minute scheduler and worker', async () => {
    const upsertJobScheduler = mock(async () => undefined);
    const createWorker = mock(() => ({ close: mock(async () => undefined) }));
    const queue = new NegotiationWatchdogQueue({
      queue: { upsertJobScheduler, close: mock(async () => undefined) } as never,
      createWorker: createWorker as never,
    });

    await queue.start();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      SCHEDULER_ID,
      { every: WATCHDOG_INTERVAL_MS },
      expect.objectContaining({ name: JOB_NAME }),
    );
    expect(createWorker).toHaveBeenCalledTimes(1);
  });
});
