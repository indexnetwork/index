/** Characterization tests for NegotiationTimeoutQueue timeout behavior. */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

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

function makeExpiryDeps(taskState: string | null) {
  const task = taskState === null ? null : negTask({ state: taskState });
  const { db } = makeDb(task, []);
  const stored: Array<{ opportunityId: string; disclosureSubject: string }> = [];
  const dismissed: string[] = [];
  const resumed: Array<{ opportunityId: string; userId: string }> = [];
  const q = createQueue({
    database: db as never,
    storeExpiryAnswer: async (opportunityId, disclosureSubject) => { stored.push({ opportunityId, disclosureSubject }); },
    dismissInflightQuestions: async (opportunityId) => { dismissed.push(opportunityId); },
    enqueueResume: async (opportunityId, userId) => { resumed.push({ opportunityId, userId }); },
  });
  return { q, db, stored, dismissed, resumed };
}

const expiryData = { negotiationId: 'task-1', opportunityId: 'opp-1', userId: 'u-src', disclosureSubject: 'budget range' };

describe('NegotiationTimeoutQueue.handleAskUserExpiry', () => {
  it('input_required: stores conservative answer, dismisses questions, cancels task, resumes', async () => {
    const { q, db, stored, dismissed, resumed } = makeExpiryDeps('input_required');
    await q.processJob('ask_user_expiry', expiryData);

    expect(stored).toEqual([{ opportunityId: 'opp-1', disclosureSubject: 'budget range' }]);
    expect(dismissed).toEqual(['opp-1']);
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'canceled', { reason: 'ask_user_window_expired' });
    expect(resumed).toEqual([{ opportunityId: 'opp-1', userId: 'u-src' }]);
  });

  it('no-ops when the task already left input_required (answer won the race)', async () => {
    const { q, db, stored, resumed } = makeExpiryDeps('canceled');
    await q.processJob('ask_user_expiry', expiryData);

    expect(stored).toEqual([]);
    expect(db.updateTaskState).not.toHaveBeenCalled();
    expect(resumed).toEqual([]);
  });

  it('no-ops when the task is missing', async () => {
    const { q, stored, resumed } = makeExpiryDeps(null);
    await q.processJob('ask_user_expiry', expiryData);
    expect(stored).toEqual([]);
    expect(resumed).toEqual([]);
  });

  it('a store failure does not block the resume (negotiation must always terminate)', async () => {
    const { db } = makeDb(negTask({ state: 'input_required' }), []);
    const resumed: string[] = [];
    const q = createQueue({
      database: db as never,
      storeExpiryAnswer: async () => { throw new Error('db down'); },
      dismissInflightQuestions: async () => {},
      enqueueResume: async (oid) => { resumed.push(oid); },
    });
    await q.processJob('ask_user_expiry', expiryData);
    expect(db.updateTaskState).toHaveBeenCalledWith('task-1', 'canceled', { reason: 'ask_user_window_expired' });
    expect(resumed).toEqual(['opp-1']);
  });

  it('enqueueAskUserExpiry adds a delayed job under its own jobId namespace', async () => {
    const q = createQueue();
    await q.enqueueAskUserExpiry('task-1', { opportunityId: 'opp-1', userId: 'u-src', disclosureSubject: 's' }, 86_400_000);
    expect(mockAdd).toHaveBeenCalledWith(
      'ask_user_expiry',
      { negotiationId: 'task-1', opportunityId: 'opp-1', userId: 'u-src', disclosureSubject: 's' },
      expect.objectContaining({ jobId: 'neg-askuser-task-1', delay: 86_400_000 }),
    );
  });
});
