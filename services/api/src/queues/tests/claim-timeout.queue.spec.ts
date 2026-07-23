/**
 * Characterization tests for NegotiationClaimTimeoutQueue.handleClaimTimeout.
 * Dependencies are injected so no Redis, Drizzle singleton, protocol model, or
 * process-global Bun module mock is involved.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { NegotiationClaimTimeoutQueue } from '../negotiations/claim-timeout.queue';

let claimedTaskResult: Record<string, unknown> | null = null;
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
  return {
    getTask: mock(async () => claimedTaskResult),
    transitionClaimedTaskToWorking: mock(async () => claimedTaskResult),
    getMessagesForConversation: mock(async () => messages),
    createMessage: mock(async () => ({ id: 'm-new' })),
    updateTaskState: mock(async () => {}),
    createArtifact: mock(async () => {}),
    updateOpportunityStatus: mock(async () => {}),
  };
}

function makeQueue(database: ReturnType<typeof makeDb>) {
  return new NegotiationClaimTimeoutQueue({
    database: database as never,
    invokeNegotiator,
    rearm,
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
  metadata: {
    type: 'negotiation',
    sourceUserId: 'src',
    candidateUserId: 'cand',
    opportunityId: 'opp-1',
  },
  ...overrides,
});

const data = (turnNumber: number) => ({ negotiationId: 'task-1', turnNumber, agentId: 'agent-9' });

beforeEach(() => {
  claimedTaskResult = claimedTask();
  mockTurn = {
    action: 'counter',
    assessment: { reasoning: 'ai-reasoning', suggestedRoles: { ownUser: 'role-ai' } },
  };
  invokeNegotiator.mockClear();
  rearm.mockClear();
});

describe('NegotiationClaimTimeoutQueue.handleClaimTimeout', () => {
  it('skips when task no longer claimed (atomic transition no-ops)', async () => {
    claimedTaskResult = null;
    const database = makeDb([msg(), msg()]);

    await makeQueue(database).processJob('negotiation_claim_timeout', data(2));

    expect(database.transitionClaimedTaskToWorking).toHaveBeenCalledWith('task-1');
    expect(database.createMessage).not.toHaveBeenCalled();
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

  it('reject: finalizes with rejected opportunity', async () => {
    mockTurn = {
      action: 'reject',
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

    expect(database.updateTaskState).toHaveBeenCalledWith('task-1', 'waiting_for_agent');
    expect(database.updateOpportunityStatus).not.toHaveBeenCalled();
    expect(rearm).toHaveBeenCalledWith('task-1', 3);
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
});
