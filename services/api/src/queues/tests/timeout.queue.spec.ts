/** Characterization tests for NegotiationTimeoutQueue timeout behavior. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { consultationExpiryReadiness } from '../../lib/negotiation/consultation-expiry';
import { NegotiationTimeoutQueue, type NegotiationTimeoutQueueDeps } from '../negotiations/timeout.queue';
import { negotiationTimeoutExecutionId, parseNegotiationTimeoutExecution, remainingDeadlineDelayMs, type NegotiationTimeoutExecutionRecord } from '../../lib/negotiation/timeout-execution';

const mockAdd = mock(async () => ({ id: 'job-1' }));
const mockGetJob = mock(async () => null as unknown);
const queue = {
  add: mockAdd,
  getJob: mockGetJob,
  close: async () => {},
};

let timeoutNow = Date.parse('2026-08-07T00:00:02.000Z');

let MOCK_TURN: {
  action: string;
  assessment: { reasoning: string; suggestedRoles: { ownUser: string } };
} = {
  action: 'counter',
  assessment: { reasoning: 'ai-reasoning', suggestedRoles: { ownUser: 'role-ai' } },
};

function createQueue(deps: NegotiationTimeoutQueueDeps = {}): NegotiationTimeoutQueue {
  return new NegotiationTimeoutQueue({
    queue: queue as never,
    invokeNegotiator: async () => MOCK_TURN as never,
    parkWindowMs: 1_000,
    now: () => timeoutNow,
    ...deps,
  });
}

type Calls = Record<string, unknown[][]>;

const parkedContinuation = {
  priorTaskId: 'prior-task', settlementId: 'settlement', successorTaskId: 'task-1',
  token: 'continuation-token', fence: 2,
};
const continuationFence = {
  taskId: parkedContinuation.priorTaskId,
  settlementId: parkedContinuation.settlementId,
  successorTaskId: parkedContinuation.successorTaskId,
  token: parkedContinuation.token,
  fence: parkedContinuation.fence,
  conversationId: 'conv-1',
  opportunityId: 'opp-1', userId: 'src', recipientIntentId: 'intent-src', networkId: 'network',
  intentFingerprint: 'fingerprint', opportunityStatus: 'negotiating',
  opportunityUpdatedAt: '2026-08-07T00:00:00.000Z', counterpartyUserId: 'cand',
  counterpartyBinding: { kind: 'intent' as const, id: 'intent-cand' }, leaseExpiresAt: '2026-08-07T00:10:00.000Z',
  consultation: { recipientUserId: 'src', recipientIntentId: 'intent-src', kind: 'answer' as const, selectedOptions: [] },
};

function makeDb(task: unknown, messages: unknown[]) {
  const calls: Calls = {};
  const rec = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); return undefined; };
  let current = task as (Record<string, unknown> & { metadata?: Record<string, unknown> }) | null;
  let execution: NegotiationTimeoutExecutionRecord | null = null;
  const createMessage = mock(async (...a: unknown[]) => { rec('createMessage')(...a); return { id: 'm-new' }; });
  const updateTaskState = mock(async (...a: unknown[]) => { rec('updateTaskState')(...a); });
  const createArtifact = mock(async (...a: unknown[]) => { rec('createArtifact')(...a); });
  const updateOpportunityStatus = mock(async (...a: unknown[]) => { rec('updateOpportunityStatus')(...a); });
  const acquireWaitingNegotiationTimeoutExecution = mock(async (input: {
    taskId: string; parkGeneration: string; turnNumber: number; continuation?: typeof parkedContinuation;
  }) => {
    if (!current || current.metadata?.type !== 'negotiation') return null;
    const executionId = negotiationTimeoutExecutionId({
      taskId: input.taskId, source: 'ordinary', generation: input.parkGeneration,
      turnNumber: input.turnNumber,
      ...(input.continuation ? { continuation: input.continuation } : {}),
    });
    if (execution?.executionId === executionId) {
      return {
        task: current,
        execution,
        ...(input.continuation ? { continuationExecution: continuationFence } : {}),
      };
    }
    if (current.state !== 'waiting_for_agent'
      || current.metadata?.negotiationParkGeneration !== input.parkGeneration
      || messages.length !== input.turnNumber) return null;
    const continuationMetadata = current.metadata.continuationExecution as { status?: string } | undefined;
    if (continuationMetadata?.status === 'parked' && !input.continuation) return null;
    execution = {
      version: 1, executionId, taskId: input.taskId, source: 'ordinary',
      generation: input.parkGeneration, turnNumber: input.turnNumber,
      status: 'pending', createdAt: '2026-08-07T00:00:00.000Z',
    };
    current = { ...current, state: 'working' };
    return {
      task: current,
      execution,
      ...(input.continuation ? { continuationExecution: continuationFence } : {}),
    };
  });
  const db = {
    getTask: mock(async () => current),
    acquireWaitingNegotiationTimeoutExecution,
    acquireClaimedNegotiationTimeoutExecution: mock(async () => null),
    getMessagesForConversation: mock(async () => messages),
    getNegotiationMessages: mock(async () => messages),
    recordNegotiationTimeoutInvocation: mock(async (input: { turn: never }) => {
      if (!current || !execution) return null;
      execution = { ...execution, status: 'invoked', turn: input.turn, invokedAt: '2026-08-07T00:00:01.000Z' };
      return { task: current, execution };
    }),
    completeNegotiationTimeoutExecution: mock(async (plan: {
      finalState: string; turnNumber: number; outcome?: unknown; opportunity?: { id: string; status: string };
      rearm: null | { parkGeneration: string; parkWindowMs: number; continuation?: unknown };
    }, _continuation: unknown, fault?: (step: 'message' | 'task' | 'artifact' | 'opportunity' | 'continuation' | 'receipt') => Promise<void>) => {
      if (!current || !execution) return null;
      // Model transaction rollback: visit every adapter boundary before the
      // in-memory commit. A throw leaves the durable invoked record resumable.
      for (const step of ['message', 'task', 'artifact', 'opportunity', 'continuation', 'receipt'] as const) {
        await fault?.(step);
      }
      await createMessage({});
      if (plan.finalState === 'completed') {
        await updateTaskState('task-1', 'completed');
        await createArtifact({});
        if (plan.opportunity) await updateOpportunityStatus(plan.opportunity.id, plan.opportunity.status);
      } else {
        await updateTaskState('task-1', 'waiting_for_agent', undefined, undefined, plan.rearm?.parkGeneration);
      }
      execution = {
        ...execution, status: 'completed', completedAt: '2026-08-07T00:00:02.000Z',
        receipt: {
          version: 1, executionId: execution.executionId, taskId: execution.taskId,
          messageId: `${execution.executionId}:message`, artifactId: plan.finalState === 'completed' ? 'artifact' : null,
          finalState: plan.finalState as 'completed' | 'waiting_for_agent', turnNumber: plan.turnNumber,
          completedAt: '2026-08-07T00:00:02.000Z',
          rearm: plan.rearm
            ? {
                parkGeneration: plan.rearm.parkGeneration,
                deadlineAt: new Date(Date.parse('2026-08-07T00:00:02.000Z') + plan.rearm.parkWindowMs).toISOString(),
                ...(plan.rearm.continuation ? { continuation: plan.rearm.continuation } : {}),
              }
            : null,
        },
      };
      current = { ...current, state: plan.finalState };
      return { task: current, execution };
    }),
    markNegotiationTimeoutOutboxDelivered: mock(async () => {
      if (!execution) return false;
      execution = { ...execution, outboxDeliveredAt: '2026-08-07T00:00:03.000Z' };
      return true;
    }),
    createMessage,
    updateTaskState,
    createArtifact,
    updateOpportunityStatus,
  };
  return { db, calls };
}

const priorTurn = { action: 'counter', assessment: { reasoning: 'prev', suggestedRoles: { ownUser: 'role-prev' } } };
const msg = () => ({ parts: [{ kind: 'data', data: priorTurn }] });

const negTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  conversationId: 'conv-1',
  state: 'waiting_for_agent',
  updatedAt: new Date('2026-08-07T00:00:00.000Z'),
  metadata: {
    type: 'negotiation',
    sourceUserId: 'src',
    candidateUserId: 'cand',
    opportunityId: 'opp-1',
    negotiationParkGeneration: 'park-generation-current',
  },
  ...overrides,
});

beforeEach(() => {
  mockAdd.mockClear();
  timeoutNow = Date.parse('2026-08-07T00:00:02.000Z');
});

describe('timeout completion outbox deadline schema', () => {
  const completed = (rearm: unknown) => ({
    version: 1,
    executionId: 'execution',
    taskId: 'task-1',
    source: 'ordinary',
    generation: 'generation',
    turnNumber: 1,
    status: 'completed',
    createdAt: '2026-08-07T00:00:00.000Z',
    turn: priorTurn,
    receipt: {
      version: 1,
      executionId: 'execution',
      taskId: 'task-1',
      messageId: 'message',
      artifactId: null,
      finalState: 'waiting_for_agent',
      turnNumber: 2,
      completedAt: '2026-08-07T00:00:02.000Z',
      rearm,
    },
  });

  it('accepts only an absolute rearm deadline and rejects the legacy relative-delay shape', () => {
    expect(parseNegotiationTimeoutExecution(completed({
      parkGeneration: 'next', deadlineAt: '2026-08-07T00:00:03.000Z',
    }))).not.toBeNull();
    expect(parseNegotiationTimeoutExecution(completed({
      parkGeneration: 'next', delayMs: 1_000,
    }))).toBeNull();
  });

  it('clamps elapsed deadlines to immediate delivery and fails closed when malformed', () => {
    expect(remainingDeadlineDelayMs('2026-08-07T00:00:03.000Z', Date.parse('2026-08-07T00:00:02.000Z'))).toBe(1_000);
    expect(remainingDeadlineDelayMs('2026-08-07T00:00:03.000Z', Date.parse('2026-08-07T01:00:02.000Z'))).toBe(0);
    expect(() => remainingDeadlineDelayMs('not-a-deadline')).toThrow('malformed absolute deadline');
  });
});

describe('NegotiationTimeoutQueue.handleTimeout', () => {
  it('safely no-ops a legacy payload without an exact generation', async () => {
    const { db } = makeDb(negTask(), []);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 0,
    } as never);
    expect(db.acquireWaitingNegotiationTimeoutExecution).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task not found', async () => {
    const { db } = makeDb(null, []);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 0, parkGeneration: 'park-generation-current',
    });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task no longer waiting_for_agent', async () => {
    const { db } = makeDb(negTask({ state: 'completed' }), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
    });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('does not run fallback when pickup wins the exact waiting-generation CAS', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    db.acquireWaitingNegotiationTimeoutExecution.mockResolvedValueOnce(null);
    const q = createQueue({ database: db as never });

    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-stale',
    });

    expect(db.acquireWaitingNegotiationTimeoutExecution).toHaveBeenCalledWith({
      taskId: 'task-1',
      parkGeneration: 'park-generation-stale',
      turnNumber: 2,
    });
    expect(db.getMessagesForConversation).not.toHaveBeenCalled();
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips on turn-count mismatch (stale job)', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 99, parkGeneration: 'park-generation-current',
    });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task is not a negotiation', async () => {
    const { db } = makeDb(negTask({ metadata: { type: 'other' } }), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
    });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('accept: finalizes (completed + artifact + opportunity pending)', async () => {
    MOCK_TURN = { action: 'accept', assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
    });
    expect(db.createMessage).toHaveBeenCalled();
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.createArtifact).toHaveBeenCalled();
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'pending');
  });

  it('withdraw: finalizes with rejected opportunity for the initiator seat', async () => {
    MOCK_TURN = { action: 'withdraw', assessment: { reasoning: 'no', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
    });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'rejected');
  });

  it('counter under max: re-arms (waiting_for_agent + enqueue)', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'more', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
    });
    expect(db.updateTaskState).toHaveBeenCalledWith(
      'task-1', 'waiting_for_agent', undefined, undefined, expect.any(String),
    );
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(mockAdd).toHaveBeenCalledWith('negotiation_timeout', expect.anything(), expect.anything());
  });

  it('counter at cap: finalizes with stalled opportunity', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'cap', suggestedRoles: { ownUser: 'role-ai' } } };
    const five = [msg(), msg(), msg(), msg(), msg()];
    const { db } = makeDb(negTask(), five);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 5, parkGeneration: 'park-generation-current',
    });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'stalled');
  });

  it.each([
    ['uncapped zero', 0, false, 'waiting_for_agent'],
    ['absent defaults to six', undefined, true, 'completed'],
    ['positive boundary', 6, true, 'completed'],
  ] as const)('ordinary resumable timeout applies %s cap semantics', async (_label, maxTurns, final, expectedState) => {
    const five = [msg(), msg(), msg(), msg(), msg()];
    const metadata = {
      type: 'negotiation', sourceUserId: 'src', candidateUserId: 'cand',
      opportunityId: 'opp-1',
      negotiationParkGeneration: 'park-generation-current',
      ...(maxTurns !== undefined ? { maxTurns } : {}),
    };
    const invoke = mock(async (input: { isFinalTurn?: boolean }) => {
      expect(input.isFinalTurn === true).toBe(final);
      return { action: 'counter', assessment: { reasoning: 'cap matrix', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } } as never;
    });
    const { db } = makeDb(negTask({ metadata }), five);
    const q = createQueue({ database: db as never, invokeNegotiator: invoke as never });

    await q.processJob('negotiation_timeout', {
      negotiationId: 'task-1', turnNumber: 5, parkGeneration: 'park-generation-current',
    });

    expect(db.updateTaskState.mock.calls[0]?.[1]).toBe(expectedState);
  });

  it('a real Bull retry resumes ordinary waiting execution after the pre-invocation CAS', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'resume', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const invoke = mock(async () => MOCK_TURN as never);
    let crash = true;
    const q = createQueue({
      database: db as never,
      invokeNegotiator: invoke,
      faultAfterStep: async (step) => {
        if (step === 'cas' && crash) {
          crash = false;
          throw new Error('crash after CAS');
        }
      },
    });
    const job = { negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current' };

    await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow('crash after CAS');
    await expect(q.processJob('negotiation_timeout', job)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(db.markNegotiationTimeoutOutboxDelivered).toHaveBeenCalledTimes(1);
  });

  it('replays a completed ordinary outbox against one absolute deadline without extending across outages', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    let outboxCrashes = 2;
    const q = createQueue({
      database: db as never,
      faultAfterStep: async (step) => {
        if (step === 'outbox' && outboxCrashes > 0) {
          outboxCrashes -= 1;
          throw new Error('crash before outbox acknowledgement');
        }
      },
    });
    const job = { negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current' };

    await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow('crash before outbox acknowledgement');
    timeoutNow += 500;
    await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow('crash before outbox acknowledgement');
    timeoutNow += 3_600_000;
    await expect(q.processJob('negotiation_timeout', job)).resolves.toBeUndefined();

    expect(mockAdd.mock.calls.map((call) => call[2]?.delay)).toEqual([1_000, 500, 0]);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(db.markNegotiationTimeoutOutboxDelivered).toHaveBeenCalledTimes(1);
  });

  it('a real Bull retry reuses the durable invocation after an injected post-invocation failure', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const invoke = mock(async () => ({ action: 'counter', assessment: { reasoning: 'once', suggestedRoles: { ownUser: 'role-ai' } } }) as never);
    let crash = true;
    const q = createQueue({
      database: db as never,
      invokeNegotiator: invoke,
      faultAfterStep: async (step) => {
        if (step === 'invocation' && crash) {
          crash = false;
          throw new Error('crash after invocation');
        }
      },
    });
    const job = { negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current' };

    await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow('crash after invocation');
    await expect(q.processJob('negotiation_timeout', job)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
  });

  it.each(['message', 'task', 'artifact', 'opportunity', 'continuation', 'receipt'] as const)(
    'retries atomically after the %s persistence boundary without a duplicate turn or artifact',
    async (boundary) => {
      const { db } = makeDb(negTask(), [msg(), msg()]);
      const invoke = mock(async () => ({ action: 'accept', assessment: { reasoning: 'terminal', suggestedRoles: { ownUser: 'role-ai' } } }) as never);
      let crash = true;
      const q = createQueue({
        database: db as never,
        invokeNegotiator: invoke,
        faultAfterStep: async (step) => {
          if (step === boundary && crash) {
            crash = false;
            throw new Error(`crash at ${boundary}`);
          }
        },
      });
      const job = { negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current' };

      await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow(`crash at ${boundary}`);
      await expect(q.processJob('negotiation_timeout', job)).resolves.toBeUndefined();
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(db.createMessage).toHaveBeenCalledTimes(1);
      expect(db.createArtifact).toHaveBeenCalledTimes(1);
    },
  );

  it('a parked continuation resumes the same fenced execution on real job retry', async () => {
    const task = negTask({
      metadata: {
        ...(negTask().metadata as Record<string, unknown>),
        continuationExecution: { ...parkedContinuation, status: 'parked' },
      },
    });
    const { db } = makeDb(task, [msg(), msg()]);
    const invoke = mock(async () => ({ action: 'counter', assessment: { reasoning: 'continue', suggestedRoles: { ownUser: 'role-ai' } } }) as never);
    let crash = true;
    const q = createQueue({
      database: db as never,
      invokeNegotiator: invoke,
      faultAfterStep: async (step) => {
        if (step === 'invocation' && crash) {
          crash = false;
          throw new Error('continuation crash');
        }
      },
    });
    const job = {
      negotiationId: 'task-1', turnNumber: 2, parkGeneration: 'park-generation-current',
      continuation: parkedContinuation,
    };

    await expect(q.processJob('negotiation_timeout', job)).rejects.toThrow('continuation crash');
    await expect(q.processJob('negotiation_timeout', job)).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(db.createMessage).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith(
      'negotiation_timeout',
      expect.objectContaining({ continuation: parkedContinuation }),
      expect.objectContaining({ delay: 1_000 }),
    );
  });

  it('enqueues the exact park generation under a deterministic generation job id', async () => {
    const q = createQueue();
    await q.enqueueTimeout('task-1', 2, 30_000, 'park-generation-1');
    await q.enqueueTimeout('task-1', 2, 15_000, 'park-generation-1');

    expect(mockAdd).toHaveBeenCalledTimes(2);
    const first = mockAdd.mock.calls[0];
    const second = mockAdd.mock.calls[1];
    expect(first[1]).toEqual({
      negotiationId: 'task-1',
      turnNumber: 2,
      parkGeneration: 'park-generation-1',
    });
    expect(first[2]?.jobId).toBe(second[2]?.jobId);
    expect(mockGetJob).not.toHaveBeenCalled();
  });
});

// ─── ask_user answer-window expiry (IND-401) ─────────────────────────────────

const expiryData = {
  negotiationId: 'task-1',
  consultationAttemptId: 'attempt-1',
  claimedByAgentId: 'agent-external',
  settlementId: 'negotiation-question-settlement-v1-task-1',
  opportunityId: 'opp-1',
  userId: 'u-src',
  recipientIntentId: 'intent-src',
  networkId: 'network-1',
  intentFingerprint: 'fingerprint-1',
  opportunityStatus: 'negotiating',
  opportunityUpdatedAt: '2026-08-07T00:00:00.000Z',
  counterpartyUserId: 'u-counterparty',
  counterpartyBinding: { kind: 'intent' as const, id: 'intent-counterparty' },
};

describe('NegotiationTimeoutQueue.handleAskUserExpiry', () => {
  it('redelivers the same exact settlement payload for deterministic queue deduplication', async () => {
    const settled: string[] = [];
    const resumed: Array<Omit<typeof expiryData, 'negotiationId'> & { taskId: string }> = [];
    const q = createQueue({
      settleInflightExpiry: async (input) => {
        settled.push(input.taskId);
        return input;
      },
      enqueueResume: async (input) => { resumed.push(input); },
    });

    await q.processJob('ask_user_expiry', expiryData);
    await q.processJob('ask_user_expiry', expiryData);

    expect(settled).toEqual(['task-1', 'task-1']);
    const { negotiationId, ...coordinates } = expiryData;
    const expected = { ...coordinates, taskId: negotiationId };
    expect(resumed).toEqual([expected, expected]);
  });

  it('Bull redelivery reconciles a first continuation enqueue rejection', async () => {
    let attempts = 0;
    const resumed: string[] = [];
    const q = createQueue({
      settleInflightExpiry: async (input) => input,
      enqueueResume: async (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error('redis unavailable');
        resumed.push(input.settlementId);
      },
    });

    await expect(q.processJob('ask_user_expiry', expiryData)).rejects.toThrow('redis unavailable');
    await expect(q.processJob('ask_user_expiry', expiryData)).resolves.toBeUndefined();
    expect(resumed).toEqual(['negotiation-question-settlement-v1-task-1']);
  });

  it('authoritative stale settlement performs no continuation', async () => {
    const enqueueResume = mock(async () => {});
    const q = createQueue({ settleInflightExpiry: async () => null, enqueueResume });
    await q.processJob('ask_user_expiry', expiryData);
    expect(enqueueResume).not.toHaveBeenCalled();
  });

  it('retries an expiry processed before pause commit, then reconciles after commit', async () => {
    let taskState: 'claimed' | 'input_required' = 'claimed';
    const taskMetadata = {
      type: 'negotiation',
      opportunityId: 'opp-1',
      networkId: 'network-1',
      participantBindings: [
        { userId: 'u-src', intentId: 'intent-src', networkId: 'network-1' },
        { userId: 'u-counterparty', intentId: 'intent-counterparty', networkId: 'network-1' },
      ],
    };
    const resumed: string[] = [];
    const q = createQueue({
      settleInflightExpiry: async (input) => {
        if (consultationExpiryReadiness({
          taskState,
          taskClaimedByAgentId: 'agent-external',
          taskMetadata,
          coordinates: input,
        }) === 'pending_pause') throw new Error('consultation pause not committed');
        return taskState === 'input_required' ? input : null;
      },
      enqueueResume: async (input) => { resumed.push(input.taskId); },
    });

    await expect(q.processJob('ask_user_expiry', expiryData)).rejects.toThrow('consultation pause not committed');
    taskState = 'input_required';
    await expect(q.processJob('ask_user_expiry', expiryData)).resolves.toBeUndefined();
    expect(resumed).toEqual(['task-1']);
  });

  it('enqueueAskUserExpiry configures BullMQ retries and backoff for pre-commit races', async () => {
    const q = createQueue();
    await q.enqueueAskUserExpiry('task-1', 'attempt-1', {
      claimedByAgentId: 'agent-external',
      settlementId: 'negotiation-question-settlement-v1-task-1',
      opportunityId: 'opp-1',
      userId: 'u-src',
      recipientIntentId: 'intent-src',
      networkId: 'network-1',
      intentFingerprint: 'fingerprint-1',
      opportunityStatus: 'negotiating',
      opportunityUpdatedAt: '2026-08-07T00:00:00.000Z',
      counterpartyUserId: 'u-counterparty',
      counterpartyBinding: { kind: 'intent' as const, id: 'intent-counterparty' },
    }, 86_400_000);
    expect(mockAdd).toHaveBeenCalledWith(
      'ask_user_expiry',
      expiryData,
      expect.objectContaining({
        jobId: 'neg-askuser-task-1-attempt-1',
        delay: 86_400_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      }),
    );
  });

  it('cancels only the exact consultation attempt expiry', async () => {
    const remove = mock(async () => undefined);
    mockGetJob.mockResolvedValueOnce({ getState: async () => 'delayed', remove });
    const q = createQueue();
    await q.cancelAskUserExpiry('task-1', 'attempt-loser');
    expect(mockGetJob).toHaveBeenCalledWith('neg-askuser-task-1-attempt-loser');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
