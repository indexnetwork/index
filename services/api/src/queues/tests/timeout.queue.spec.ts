/** Characterization tests for NegotiationTimeoutQueue timeout behavior. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { consultationExpiryReadiness } from '../../lib/negotiation/consultation-expiry';
import { NegotiationTimeoutQueue, type NegotiationTimeoutQueueDeps } from '../negotiations/timeout.queue';

const mockAdd = mock(async () => ({ id: 'job-1' }));
const mockGetJob = mock(async () => null as unknown);
const queue = {
  add: mockAdd,
  getJob: mockGetJob,
  close: async () => {},
};

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
    ...deps,
  });
}

type Calls = Record<string, unknown[][]>;

function makeDb(task: unknown, messages: unknown[]) {
  const calls: Calls = {};
  const rec = (name: string) => (...args: unknown[]) => { (calls[name] ??= []).push(args); return undefined; };
  const db = {
    getTask: mock(async () => task),
    getMessagesForConversation: mock(async () => messages),
    createMessage: mock(async (...a: unknown[]) => { rec('createMessage')(...a); return { id: 'm-new' }; }),
    updateTaskState: mock(async (...a: unknown[]) => { rec('updateTaskState')(...a); }),
    createArtifact: mock(async (...a: unknown[]) => { rec('createArtifact')(...a); }),
    updateOpportunityStatus: mock(async (...a: unknown[]) => { rec('updateOpportunityStatus')(...a); }),
  };
  return { db, calls };
}

const priorTurn = { action: 'counter', assessment: { reasoning: 'prev', suggestedRoles: { ownUser: 'role-prev' } } };
const msg = () => ({ parts: [{ kind: 'data', data: priorTurn }] });

const negTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  conversationId: 'conv-1',
  state: 'waiting_for_agent',
  metadata: { type: 'negotiation', sourceUserId: 'src', candidateUserId: 'cand', opportunityId: 'opp-1' },
  ...overrides,
});

beforeEach(() => {
  mockAdd.mockClear();
});

describe('NegotiationTimeoutQueue.handleTimeout', () => {
  it('skips when task not found', async () => {
    const { db } = makeDb(null, []);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 0 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task no longer waiting_for_agent', async () => {
    const { db } = makeDb(negTask({ state: 'completed' }), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips on turn-count mismatch (stale job)', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 99 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task is not a negotiation', async () => {
    const { db } = makeDb(negTask({ metadata: { type: 'other' } }), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('accept: finalizes (completed + artifact + opportunity pending)', async () => {
    MOCK_TURN = { action: 'accept', assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).toHaveBeenCalled();
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.createArtifact).toHaveBeenCalled();
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'pending');
  });

  it('reject: finalizes with rejected opportunity', async () => {
    MOCK_TURN = { action: 'reject', assessment: { reasoning: 'no', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'rejected');
  });

  it('counter under max: re-arms (waiting_for_agent + enqueue)', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'more', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'waiting_for_agent');
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(mockAdd).toHaveBeenCalledWith('negotiation_timeout', expect.anything(), expect.anything());
  });

  it('counter at cap: finalizes with stalled opportunity', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'cap', suggestedRoles: { ownUser: 'role-ai' } } };
    const five = [msg(), msg(), msg(), msg(), msg()];
    const { db } = makeDb(negTask(), five);
    const q = createQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 5 });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'stalled');
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
  counterpartyIntentId: 'intent-counterparty',
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
      counterpartyIntentId: 'intent-counterparty',
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
