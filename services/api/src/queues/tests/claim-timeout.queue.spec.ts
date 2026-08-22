/**
 * Characterization tests for NegotiationClaimTimeoutQueue.handleClaimTimeout.
 * Dependencies are injected so no Redis, Drizzle singleton, protocol model, or
 * process-global Bun module mock is involved.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { NegotiationClaimTimeoutQueue } from '../negotiations/claim-timeout.queue';
import { negotiationTimeoutExecutionId, type NegotiationTimeoutExecutionRecord } from '../../lib/negotiation/timeout-execution';

let claimedTaskResult: Record<string, unknown> | null = null;
let claimNow = Date.parse('2026-08-07T00:00:04.000Z');
let mockTurn: {
  action: string;
  assessment: { reasoning: string; suggestedRoles: { ownUser: string } };
} = {
  action: 'counter',
  assessment: { reasoning: 'ai-reasoning', suggestedRoles: { ownUser: 'role-ai' } },
};

const invokeNegotiator = mock(async () => mockTurn as never);
const rearm = mock(async () => undefined);

function makeDb(messages: unknown[]) {
  let current = claimedTaskResult;
  let execution: NegotiationTimeoutExecutionRecord | null = null;
  const createMessage = mock(async () => ({ id: 'm-new' }));
  const updateTaskState = mock(async () => {});
  const createArtifact = mock(async () => {});
  const updateOpportunityStatus = mock(async () => {});
  const acquireClaimedNegotiationTimeoutExecution = mock(async (input: {
    taskId: string; claimedAt: Date; turnNumber: number; continuation?: unknown;
  }) => {
    if (!current || input.turnNumber !== messages.length) return null;
    const taskClaimedAt = current.claimedAt as Date | undefined;
    if (!taskClaimedAt || taskClaimedAt.getTime() !== input.claimedAt.getTime()) return null;
    const metadata = current.metadata as Record<string, unknown> | undefined;
    if (metadata?.type !== 'negotiation') return null;
    const hasContinuation = Object.prototype.hasOwnProperty.call(metadata ?? {}, 'continuationExecution')
      || metadata?.isContinuation === true
      || typeof metadata?.resumeFromTaskId === 'string'
      || typeof metadata?.continuationSettlementId === 'string';
    if (hasContinuation && !input.continuation) return null;
    const generation = input.claimedAt.toISOString();
    execution ??= {
      version: 1,
      executionId: negotiationTimeoutExecutionId({
        taskId: input.taskId, source: 'claim', generation, turnNumber: input.turnNumber,
      }),
      taskId: input.taskId, source: 'claim', generation, turnNumber: input.turnNumber,
      status: 'pending', createdAt: '2026-08-07T00:00:02.000Z',
    };
    current = { ...current, state: 'working' };
    return { task: current, execution };
  });
  return {
    getTask: mock(async () => current),
    acquireClaimedNegotiationTimeoutExecution,
    acquireWaitingNegotiationTimeoutExecution: mock(async () => null),
    getMessagesForConversation: mock(async () => messages),
    getNegotiationMessages: mock(async () => messages),
    recordNegotiationTimeoutInvocation: mock(async (input: { turn: never }) => {
      if (!current || !execution) return null;
      execution = { ...execution, status: 'invoked', turn: input.turn, invokedAt: '2026-08-07T00:00:03.000Z' };
      return { task: current, execution };
    }),
    completeNegotiationTimeoutExecution: mock(async (plan: {
      finalState: string; turnNumber: number; opportunity?: { id: string; status: string };
      rearm: null | { parkGeneration: string; parkWindowMs: number; continuation?: unknown };
    }) => {
      if (!current || !execution) return null;
      await createMessage();
      if (plan.finalState === 'completed') {
        await updateTaskState('task-1', 'completed');
        await createArtifact();
        if (plan.opportunity) await updateOpportunityStatus(plan.opportunity.id, plan.opportunity.status);
      } else {
        await updateTaskState('task-1', 'waiting_for_agent', undefined, undefined, plan.rearm?.parkGeneration);
      }
      execution = {
        ...execution, status: 'completed', completedAt: '2026-08-07T00:00:04.000Z',
        receipt: {
          version: 1, executionId: execution.executionId, taskId: execution.taskId,
          messageId: 'message', artifactId: plan.finalState === 'completed' ? 'artifact' : null,
          finalState: plan.finalState as 'completed' | 'waiting_for_agent', turnNumber: plan.turnNumber,
          completedAt: '2026-08-07T00:00:04.000Z',
          rearm: plan.rearm
            ? {
                parkGeneration: plan.rearm.parkGeneration,
                deadlineAt: new Date(Date.parse('2026-08-07T00:00:04.000Z') + plan.rearm.parkWindowMs).toISOString(),
                ...(plan.rearm.continuation ? { continuation: plan.rearm.continuation as never } : {}),
              }
            : null,
        },
      };
      current = { ...current, state: plan.finalState };
      return { task: current, execution };
    }),
    markNegotiationTimeoutOutboxDelivered: mock(async () => {
      if (!execution) return false;
      execution = { ...execution, outboxDeliveredAt: '2026-08-07T00:00:05.000Z' };
      return true;
    }),
    createMessage,
    updateTaskState,
    createArtifact,
    updateOpportunityStatus,
  };
}

function makeQueue(database: ReturnType<typeof makeDb>) {
  return new NegotiationClaimTimeoutQueue({
    database: database as never,
    invokeNegotiator,
    rearm,
    now: () => claimNow,
  });
}

const priorTurn = {
  action: 'counter',
  assessment: { reasoning: 'prev', suggestedRoles: { ownUser: 'role-prev' } },
};
const msg = () => ({ parts: [{ kind: 'data', data: priorTurn }] });

const claimedTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  conversationId: 'conv-1',
  state: 'claimed',
  claimedByAgentId: 'agent-9',
  claimedAt: new Date('2026-08-07T00:00:01.000Z'),
  metadata: {
    type: 'negotiation',
    sourceUserId: 'src',
    candidateUserId: 'cand',
    opportunityId: 'opp-1',
  },
  ...overrides,
});

const data = (turnNumber: number, claimedAt = '2026-08-07T00:00:01.000Z') => ({
  negotiationId: 'task-1', turnNumber, agentId: 'agent-9', claimedAt,
});

beforeEach(() => {
  claimedTaskResult = claimedTask();
  mockTurn = {
    action: 'counter',
    assessment: { reasoning: 'ai-reasoning', suggestedRoles: { ownUser: 'role-ai' } },
  };
  invokeNegotiator.mockClear();
  rearm.mockClear();
  claimNow = Date.parse('2026-08-07T00:00:04.000Z');
});

describe('NegotiationClaimTimeoutQueue.handleClaimTimeout', () => {
  it('enqueues an exact claim generation idempotently without removing the same job', async () => {
    const add = mock(async () => ({ id: 'claim-job' }));
    const getJob = mock(async () => null);
    const queue = { add, getJob, close: async () => undefined };
    const q = new NegotiationClaimTimeoutQueue({ queue: queue as never });

    await q.enqueueTimeout('task-1', 2, 'agent-9', '2026-08-07T00:00:01.000Z', 30_000);
    await q.enqueueTimeout('task-1', 2, 'agent-9', '2026-08-07T00:00:01.000Z', 10_000);

    expect(add).toHaveBeenCalledTimes(2);
    expect(add.mock.calls[0]?.[1]).toEqual({
      negotiationId: 'task-1',
      turnNumber: 2,
      agentId: 'agent-9',
      claimedAt: '2026-08-07T00:00:01.000Z',
    });
    expect(add.mock.calls[0]?.[2]?.jobId).toBe(add.mock.calls[1]?.[2]?.jobId);
    expect(getJob).not.toHaveBeenCalled();
  });
  it('safely no-ops a legacy payload without an exact claim generation', async () => {
    const database = makeDb([]);
    await makeQueue(database).processJob('negotiation_claim_timeout', {
      negotiationId: 'task-1', turnNumber: 0, agentId: 'agent-9',
    } as never);
    expect(database.acquireClaimedNegotiationTimeoutExecution).not.toHaveBeenCalled();
    expect(database.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task no longer claimed (atomic transition no-ops)', async () => {
    claimedTaskResult = null;
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.acquireClaimedNegotiationTimeoutExecution).toHaveBeenCalledWith({
      taskId: 'task-1',
      claimedByAgentId: 'agent-9',
      claimedAt: new Date('2026-08-07T00:00:01.000Z'),
      turnNumber: 2,
    });
    expect(database.createMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['missing execution', { isContinuation: true, resumeFromTaskId: 'prior-1', continuationSettlementId: 'settlement-1' }],
    ['malformed execution', { resumeFromTaskId: 'prior-1', continuationExecution: { status: 'claimed' } }],
    ['wrong execution state', { continuationSettlementId: 'settlement-1', continuationExecution: { status: 'parked' } }],
  ])('fails closed for %s continuation provenance without a current fence', async (_label, continuationMetadata) => {
    claimedTaskResult = claimedTask({ metadata: { type: 'negotiation', sourceUserId: 'src', candidateUserId: 'cand', ...continuationMetadata } });
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.acquireClaimedNegotiationTimeoutExecution).toHaveBeenCalled();
    expect(database.createMessage).not.toHaveBeenCalled();
    expect(database.updateTaskState).not.toHaveBeenCalled();
    expect(database.createArtifact).not.toHaveBeenCalled();
    expect(database.updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('skips on turn-count mismatch (stale job)', async () => {
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(99));

    expect(database.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task is not a negotiation', async () => {
    claimedTaskResult = claimedTask({ metadata: { type: 'other' } });
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.createMessage).not.toHaveBeenCalled();
  });

  it('accept: finalizes (completed + artifact + opportunity pending)', async () => {
    mockTurn = {
      action: 'accept',
      assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'role-ai' } },
    };
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.createMessage).toHaveBeenCalled();
    expect(database.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(database.createArtifact).toHaveBeenCalled();
    expect(database.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'pending');
  });

  it('withdraw: finalizes with rejected opportunity for the initiator seat', async () => {
    mockTurn = {
      action: 'withdraw',
      assessment: { reasoning: 'no', suggestedRoles: { ownUser: 'role-ai' } },
    };
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(database.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'rejected');
  });

  it('counter under max: re-arms general timeout', async () => {
    mockTurn = {
      action: 'counter',
      assessment: { reasoning: 'more', suggestedRoles: { ownUser: 'role-ai' } },
    };
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.updateTaskState).toHaveBeenCalledWith(
      'task-1', 'waiting_for_agent', undefined, undefined, expect.any(String),
    );
    expect(database.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(rearm).toHaveBeenCalledWith('task-1', 3, expect.any(String), 300_000, undefined);
  });

  it('a real Bull retry resumes a claimed generation after durable invocation without duplicating effects', async () => {
    const database = makeDb([msg(), msg()]);
    let crash = true;
    const q = new NegotiationClaimTimeoutQueue({
      database: database as never,
      invokeNegotiator,
      rearm,
      faultAfterStep: async (step) => {
        if (step === 'invocation' && crash) {
          crash = false;
          throw new Error('claim crash after invocation');
        }
      },
    });

    await expect(q.processJob('negotiation_claim_timeout', data(2)))
      .rejects.toThrow('claim crash after invocation');
    await expect(q.processJob('negotiation_claim_timeout', data(2))).resolves.toBeUndefined();

    expect(invokeNegotiator).toHaveBeenCalledTimes(1);
    expect(database.createMessage).toHaveBeenCalledTimes(1);
    expect(database.markNegotiationTimeoutOutboxDelivered).toHaveBeenCalledTimes(1);
  });

  it('counter at cap: finalizes with stalled opportunity', async () => {
    mockTurn = {
      action: 'counter',
      assessment: { reasoning: 'cap', suggestedRoles: { ownUser: 'role-ai' } },
    };
    const database = makeDb([msg(), msg(), msg(), msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(5));

    expect(database.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(database.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'stalled');
  });

  it.each([
    ['uncapped zero', 0, false, 'waiting_for_agent'],
    ['absent defaults to six', undefined, true, 'completed'],
    ['positive boundary', 6, true, 'completed'],
  ] as const)('claim resumable timeout applies %s cap semantics', async (_label, maxTurns, final, expectedState) => {
    claimedTaskResult = claimedTask({
      metadata: {
        type: 'negotiation', sourceUserId: 'src', candidateUserId: 'cand',
        initiatorUserId: 'src', opportunityId: 'opp-1',
        ...(maxTurns !== undefined ? { maxTurns } : {}),
      },
    });
    const database = makeDb([msg(), msg(), msg(), msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(5));

    expect(invokeNegotiator.mock.calls.at(-1)?.[0]?.isFinalTurn === true).toBe(final);
    expect(database.updateTaskState.mock.calls[0]?.[1]).toBe(expectedState);
  });
});
