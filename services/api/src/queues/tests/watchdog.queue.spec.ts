import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { MAX_WATCHDOG_ATTEMPTS, NegotiationWatchdogQueue, SUBMITTED_STALE_AFTER_MS, WORKING_STALE_AFTER_MS } from '../negotiations/watchdog.queue';

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
    recordNegotiationWatchdogRecoveryCheck: mock(async () => true),
    clearNegotiationReflectPending: mock(async () => undefined),
    getIntentsWithInterruptedKickoff: mock(async () => []),
  };
  // Settled by default: an opening_complete marker plus every opened task
  // already stopped, so `maybeEnqueueRoundReflect` enqueues immediately.
  const roundLog = {
    appendNegotiationRoundLogEvent: mock(async () => undefined),
    readNegotiationRoundLogEvents: mock(async () => [
      { kind: 'opened' as const, taskId: 'task-1', batchId: 'batch-1' },
      { kind: 'opening_complete' as const, batchId: 'batch-1' },
      { kind: 'stopped' as const, taskId: 'task-1', batchId: 'batch-1', via: 'completed' as const },
    ]),
  };
  const opportunities = {
    getOpportunity: mock(async () => ({ id: 'opportunity-1', status: 'negotiating' })),
  };
  const negotiationGraph = { invoke: mock(async () => ({ negotiationId: task?.id ?? '', status: 'paused' as const, turns: [] })) };
  const reflectEnqueue = mock(async () => undefined);
  const matchesReady = mock(async () => undefined);
  return { database, roundLog, opportunities, negotiationGraph, reflectEnqueue, matchesReady };
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

  it('expires a stale principal-needed pause through the graph', async () => {
    const task = makeTask({
      state: 'paused',
      updatedAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
      metadata: { type: 'negotiation', opportunityId: 'opportunity-1', pause: { reason: 'needs_principal' } },
    });
    const deps = makeDeps(task);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.database.recordNegotiationWatchdogAttempt).not.toHaveBeenCalled();
    expect(deps.opportunities.getOpportunity).not.toHaveBeenCalled();
    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({
      negotiationId: task.id,
      expire: { expectedUpdatedAt: task.updatedAt, reason: 'needs_principal' },
    });
  });

  it('retries a failed durable reflect dedupe key on the next ready_for_verdict sweep', async () => {
    const task = makeTask({
      state: 'paused',
      metadata: {
        type: 'negotiation',
        opportunityId: 'opportunity-1',
        sourceUserId: 'user-1',
        candidateUserId: 'user-2',
        initiatorUserId: 'user-1',
        networkId: 'network-1',
        seats: { 'intent-1': { userId: 'user-1', batchId: 'batch-1' } },
        pause: { reason: 'ready_for_verdict', pausedBy: 'user-1' },
      },
    });
    const deps = makeDeps(task);
    deps.reflectEnqueue
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockRejectedValueOnce(new Error('redis unavailable'));
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();
    expect(deps.reflectEnqueue).toHaveBeenCalledTimes(3);

    await queue.sweep();

    expect(deps.reflectEnqueue).toHaveBeenLastCalledWith({
      userId: 'user-1',
      intentId: 'intent-1',
      batchId: 'batch-1',
      dedupeKey: 'task-1.2',
    });
    expect(deps.reflectEnqueue).toHaveBeenCalledTimes(4);
    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
    expect(deps.database.recordNegotiationWatchdogRecoveryCheck).toHaveBeenCalledWith({
      taskId: 'task-1',
      expectedUpdatedAt: task.updatedAt,
      checkedAt: now,
    });
  });

  it('recovers an active task left behind after an owner verdict committed', async () => {
    const task = makeTask({ state: 'working' });
    const deps = makeDeps(task);
    deps.opportunities.getOpportunity.mockResolvedValue({ id: 'opportunity-1', status: 'accepted' } as never);
    deps.negotiationGraph.invoke.mockResolvedValue({ negotiationId: task.id, status: 'resolved', turns: [] } as never);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({
      negotiationId: task.id,
      close: {
        reason: 'owner_verdict',
        verdict: 'pending',
        reasoning: 'Recovered after the owner verdict committed before negotiation closure.',
      },
      byUserId: 'user-1',
    });
    expect(deps.database.recordNegotiationWatchdogAttempt).not.toHaveBeenCalled();
  });

  it('recovers an active task left behind after its opportunity expired', async () => {
    const task = makeTask({ state: 'working' });
    const deps = makeDeps(task);
    deps.opportunities.getOpportunity.mockResolvedValue({ id: 'opportunity-1', status: 'expired' } as never);
    deps.negotiationGraph.invoke.mockResolvedValue({ negotiationId: task.id, status: 'resolved', turns: [] } as never);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).toHaveBeenCalledWith({
      negotiationId: task.id,
      close: { reason: 'opportunity_expired' },
    });
    expect(deps.database.recordNegotiationWatchdogAttempt).not.toHaveBeenCalled();
  });

  it('keeps a completed verdict durable until its reflect check succeeds', async () => {
    const task = makeTask({
      state: 'completed',
      metadata: {
        type: 'negotiation',
        opportunityId: 'opportunity-1',
        sourceUserId: 'user-1',
        candidateUserId: 'user-2',
        seats: { 'intent-1': { userId: 'user-1', batchId: 'batch-1' } },
        watchdogReflectPending: true,
      },
    });
    const deps = makeDeps(task);
    deps.reflectEnqueue
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockRejectedValueOnce(new Error('redis unavailable'))
      .mockRejectedValueOnce(new Error('redis unavailable'));
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();
    expect(deps.database.clearNegotiationReflectPending).not.toHaveBeenCalled();
    expect(deps.database.recordNegotiationWatchdogRecoveryCheck).toHaveBeenCalledTimes(1);

    await queue.sweep();
    expect(deps.database.clearNegotiationReflectPending).toHaveBeenCalledWith(task.id);
  });

  it('does not expire a paused task changed after the stale-list read', async () => {
    const task = makeTask({
      state: 'paused',
      updatedAt: new Date(now.getTime() - WORKING_STALE_AFTER_MS - 1),
      metadata: { type: 'negotiation', opportunityId: 'opportunity-1', pause: { reason: 'counterparty_silent' } },
    });
    const deps = makeDeps(task);
    deps.database.getTask.mockResolvedValue({ ...task, updatedAt: now } as never);
    const queue = new NegotiationWatchdogQueue({ ...deps, clock: () => now });

    await queue.sweep();

    expect(deps.negotiationGraph.invoke).not.toHaveBeenCalled();
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
    expect(deps.database.recordNegotiationWatchdogRecoveryCheck).toHaveBeenCalledTimes(1);
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
    expect(deps.matchesReady).not.toHaveBeenCalled();
  });

  it('re-wakes a signal whose kickoff started but never finished settling', async () => {
    const deps = makeDeps(null);
    deps.database.getIntentsWithInterruptedKickoff = mock(async () => [
      { id: 'intent-1', userId: 'user-1' },
    ]);
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.matchesReady).toHaveBeenCalledWith({ userId: 'user-1', intentId: 'intent-1' });
  });

  it('continues the sweep when re-waking one interrupted kickoff fails', async () => {
    const deps = makeDeps(null);
    deps.database.getIntentsWithInterruptedKickoff = mock(async () => [
      { id: 'intent-1', userId: 'user-1' },
      { id: 'intent-2', userId: 'user-2' },
    ]);
    deps.matchesReady = mock(async (input: { intentId: string }) => {
      if (input.intentId === 'intent-1') throw new Error('boom');
    });
    const queue = new NegotiationWatchdogQueue(deps);

    await queue.sweep();

    expect(deps.matchesReady).toHaveBeenCalledWith({ userId: 'user-1', intentId: 'intent-1' });
    expect(deps.matchesReady).toHaveBeenCalledWith({ userId: 'user-2', intentId: 'intent-2' });
  });

  it('flag on schedules the sweep cron and is idempotent on a second call', async () => {
    // node-cron isn't mocked in this (non-isolated) test file — mocking it
    // here would leak into every other suite that imports node-cron in the
    // same test run. This exercises the real scheduler, then stops whatever
    // task it registered so the interval doesn't outlive the test.
    const cron = await import('node-cron');
    const before = new Set(cron.getTasks().keys());
    const queue = new NegotiationWatchdogQueue();
    try {
      await queue.start();
      await queue.start();
      const after = cron.getTasks();
      const newIds = [...after.keys()].filter((id) => !before.has(id));
      // Idempotent: only one new task registered across both calls.
      expect(newIds).toHaveLength(1);
    } finally {
      const after = cron.getTasks();
      for (const [id, task] of after) if (!before.has(id)) task.stop();
    }
  });
});
