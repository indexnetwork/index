/**
 * Characterization tests for NegotiationClaimTimeoutQueue.handleClaimTimeout.
 * Locks observable side effects (atomic claimed->working transition + db adapter
 * calls + re-arm) before the shared timeout core is extracted. Mocks QueueFactory,
 * drizzle (atomic transition), conversation schema, drizzle-orm, and the protocol
 * IndexNegotiator so no Redis/DB/LLM is touched.
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

// Controllable result of the atomic claimed->working UPDATE ... RETURNING.
let CLAIMED_TASK: Record<string, unknown> | null = null;
mock.module('../../lib/drizzle/drizzle', () => ({
  default: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => (CLAIMED_TASK ? [CLAIMED_TASK] : []),
        }),
      }),
    }),
  },
}));

mock.module('../../schemas/conversation.schema', () => ({
  tasks: { id: { name: 'id' }, state: { name: 'state' }, updatedAt: { name: 'updatedAt' } },
}));

mock.module('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ and: a }),
  eq: (...a: unknown[]) => ({ eq: a }),
}));

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

import { NegotiationClaimTimeoutQueue } from '../negotiations/claim-timeout.queue';

function makeDb(messages: unknown[]) {
  const db = {
    getMessagesForConversation: mock(async () => messages),
    createMessage: mock(async () => ({ id: 'm-new' })),
    updateTaskState: mock(async () => {}),
    createArtifact: mock(async () => {}),
    updateOpportunityStatus: mock(async () => {}),
  };
  return db;
}

const priorTurn = { action: 'counter', assessment: { reasoning: 'prev', suggestedRoles: { ownUser: 'role-prev' } } };
const msg = () => ({ parts: [{ kind: 'data', data: priorTurn }] });

const claimedTask = (overrides: Record<string, unknown> = {}) => ({
  id: 'task-1',
  conversationId: 'conv-1',
  metadata: { type: 'negotiation', sourceUserId: 'src', candidateUserId: 'cand', opportunityId: 'opp-1' },
  ...overrides,
});

const data = (turnNumber: number) => ({ negotiationId: 'task-1', turnNumber, agentId: 'agent-9' });

beforeEach(() => {
  mockAdd.mockClear();
  CLAIMED_TASK = claimedTask();
});

describe('NegotiationClaimTimeoutQueue.handleClaimTimeout', () => {
  it('skips when task no longer claimed (atomic transition no-ops)', async () => {
    CLAIMED_TASK = null;
    const db = makeDb([msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(2));
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips on turn-count mismatch (stale job)', async () => {
    const db = makeDb([msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(99));
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('skips when task is not a negotiation', async () => {
    CLAIMED_TASK = claimedTask({ metadata: { type: 'other' } });
    const db = makeDb([msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(2));
    expect(db.createMessage).not.toHaveBeenCalled();
  });

  it('accept: finalizes (completed + artifact + opportunity pending)', async () => {
    MOCK_TURN = { action: 'accept', assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'role-ai' } } };
    const db = makeDb([msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(2));
    expect(db.createMessage).toHaveBeenCalled();
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.createArtifact).toHaveBeenCalled();
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'pending');
  });

  it('counter under max: re-arms general timeout (waiting_for_agent + enqueue)', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'more', suggestedRoles: { ownUser: 'role-ai' } } };
    const db = makeDb([msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(2));
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'waiting_for_agent');
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(mockAdd).toHaveBeenCalledWith('negotiation_timeout', expect.anything(), expect.anything());
  });

  it('counter at cap: finalizes with stalled opportunity', async () => {
    MOCK_TURN = { action: 'counter', assessment: { reasoning: 'cap', suggestedRoles: { ownUser: 'role-ai' } } };
    const db = makeDb([msg(), msg(), msg(), msg(), msg()]);
    const q = new NegotiationClaimTimeoutQueue({ database: db as never });
    await q.processJob('negotiation_claim_timeout', data(5));
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'completed');
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith('opp-1', 'stalled');
  });
});
