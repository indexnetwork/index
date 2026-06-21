/**
 * Characterization tests for NegotiationTimeoutQueue.handleTimeout.
 * Locks the observable side effects (db adapter calls + re-arm) before the
 * shared timeout core is extracted. Mocks QueueFactory + protocol IndexNegotiator
 * so no Redis/LLM is touched.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll, beforeEach } from 'bun:test';

const mockAdd = mock(async () => ({ id: 'job-1' }));
const mockGetJob = mock(async () => null as unknown);

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, getJob: mockGetJob, close: async () => {} }),
    createWorker: () => ({ close: async () => {} }),
    createQueueEvents: () => ({ on: () => {}, close: async () => {} }),
  },
}));

// Controllable AI turn returned by the mocked negotiator.
let MOCK_TURN: { action: string; assessment: { reasoning: string; suggestedRoles: { ownUser: string } } } = {
  action: 'counter',
  assessment: { reasoning: 'ai-reasoning', suggestedRoles: { ownUser: 'role-ai' } },
};

mock.module('@indexnetwork/protocol', () => ({
  IndexNegotiator: class {
    async invoke() {
      return MOCK_TURN;
    }
  },
  AMBIENT_PARK_WINDOW_MS: 1000,
}));

afterAll(() => {
  mock.restore();
});

import { NegotiationTimeoutQueue } from '../negotiations/timeout.queue';

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
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 0 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task no longer waiting_for_agent', async () => {
    const { db } = makeDb(negTask({ state: 'completed' }), [msg(), msg()]);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips on turn-count mismatch (stale job)', async () => {
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 99 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task is not a negotiation', async () => {
    const { db } = makeDb(negTask({ metadata: { type: 'other' } }), [msg(), msg()]);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('accept: finalizes (completed + artifact + opportunity pending)', async () => {
    MOCK_TURN = { action: 'accept', assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.createMessage).toHaveBeenCalled();
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.createArtifact).toHaveBeenCalled();
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'pending');
  });

  it('counter under max: re-arms (waiting_for_agent + enqueue)', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'more', suggestedRoles: { ownUser: 'role-ai' } } };
    const { db } = makeDb(negTask(), [msg(), msg()]);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 2 });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'waiting_for_agent');
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(mockAdd).toHaveBeenCalledWith('negotiation_timeout', expect.anything(), expect.anything());
  });

  it('counter at cap: finalizes with stalled opportunity', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'cap', suggestedRoles: { ownUser: 'role-ai' } } };
    const five = [msg(), msg(), msg(), msg(), msg()];
    const { db } = makeDb(negTask(), five);
    const q = new NegotiationTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_timeout', { negotiationId: 'task-1', turnNumber: 5 });
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'stalled');
  });
});
