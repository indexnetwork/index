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
    recordNegotiationWatchdogAttempt: mock(async () => task),
  };
  const opportunities = {
    getOpportunity: mock(async () => ({ id: 'opportunity-1', status: 'negotiating' })),
  };
  const negotiationGraph = { invoke: mock(async () => ({ negotiationId: task?.id ?? '', status: 'paused' as const, turns: [] })) };
  return { database, opportunities, negotiationGraph };
}

beforeEach(() => {
});

describe('NegotiationWatchdogQueue', () => {
  it('pauses stale submitted tasks straight through the negotiation graph', async () => {
    const deps = makeDeps();
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.getStaleNegotiationTasks).toHaveBeenCalledWith({
      submittedOlderThanMs: SUBMITTED_STALE_AFTER_MS,
      workingOlderThanMs: WORKING_STALE_AFTER_MS,
      limit: 25,
    });
    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({
      negotiationId: 'task-1',
      pause: 'counterparty_silent',
    });
  });

  it('records the attempt before invoking, so a discarded error status still counts toward the retry budget', async () => {
    const deps = makeDeps();
    deps.negotiationGraph.invoke.mockResolvedValue({ negotiationId: 'task-1', status: 'error', turns: [], error: 'boom' } as never);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.recordNegotiationWatchdogAttempt).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedUpdatedAt: expect.any(Date),
      attempts: 1,
    });
  });

  it('does not invoke the graph when the attempt record loses a race', async () => {
    const deps = makeDeps();
    deps.database.recordNegotiationWatchdogAttempt.mockResolvedValue(null as never);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
  });

  it('pauses stale working tasks using the working-state threshold', async () => {
    const task = makeTask({
      state: 'working',
      createdAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
      updatedAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
    });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the task changed state after the stale-list read', async () => {
    const deps = makeDeps();
    deps.database.getTask.mockResolvedValue(makeTask({ state: 'completed' }) as never);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
  });

  it('skips tasks whose opportunity is no longer negotiating', async () => {
    const deps = makeDeps();
    deps.opportunities.getOpportunity.mockResolvedValue({ id: 'opportunity-1', status: 'pending' } as never);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
  });

  it('a task that exhausted the watchdog retry budget is paused through the graph, not marked with an out-of-union state', async () => {
    const task = makeTask({ metadata: {
      type: 'negotiation',
      opportunityId: 'opportunity-1',
      sourceUserId: 'user-1',
      watchdogAttempts: MAX_WATCHDOG_ATTEMPTS,
    } });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    // The exhausted-budget path never records another attempt — it pauses
    // through the same system-pause input the routine path uses.
    expect(deps.database.recordNegotiationWatchdogAttempt).not.toHaveBeenCalled();
    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({ negotiationId: task.id, pause: 'counterparty_silent' });
  });

  it('a legacy negotiation task with no opportunity ID is paused through the graph, not marked with an out-of-union state', async () => {
    const task = makeTask({ metadata: { type: 'negotiation', sourceUserId: 'user-1' } });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.opportunities.getOpportunity).not.toHaveBeenCalled();
    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({ negotiationId: task.id, pause: 'counterparty_silent' });
  });

  it('makes no mutations for a healthy sweep', async () => {
    const deps = makeDeps(null);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.database.getTask).not.toHaveBeenCalled();
    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
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
