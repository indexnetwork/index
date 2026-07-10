/**
 * IND-397 — timeout fallback uses the parked seat's schema (v2 seat rules).
 *
 * When a parked turn times out and the system agent takes over, the agent must
 * be invoked with the parked seat + the task's protocol version — an
 * initiator-seat fallback can never accept on the user's behalf. Speaker
 * attribution derives from the last message's sender, not turn parity.
 * Hermetic: protocol barrel mocked (capturing IndexNegotiator), database faked.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

import { describe, expect, it, mock, afterAll, beforeEach } from 'bun:test';

let MOCK_TURN: Record<string, unknown> = {
  action: 'counter',
  assessment: { reasoning: 'ai', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
};
const invokeInputs: Array<Record<string, unknown>> = [];

mock.module('@indexnetwork/protocol', () => ({
  IndexNegotiator: class {
    async invoke(input: Record<string, unknown>) {
      invokeInputs.push(input);
      return MOCK_TURN;
    }
  },
  AMBIENT_PARK_WINDOW_MS: 1000,
  isTerminalAction: (a: string) => a === 'accept' || a === 'reject' || a === 'withdraw' || a === 'decline',
  isRejectLikeAction: (a: string) => a === 'reject' || a === 'withdraw' || a === 'decline',
  readProtocolVersion: (m: { protocolVersion?: unknown } | null) =>
    (m?.protocolVersion === 'v2' ? 'v2' : m?.protocolVersion === 'v1' ? 'v1' : null),
  resolveSeat: (userId: string, m: { initiatorUserId?: string; sourceUserId?: string } | null) =>
    ((m?.initiatorUserId || m?.sourceUserId) === userId ? 'initiator' : 'counterparty'),
}));

afterAll(() => {
  mock.restore();
});

const { runTimeoutFallback } = await import('../negotiations/timeout.shared');
const { log } = await import('../../lib/log');

function makeDb() {
  return {
    getMessagesForConversation: mock(async () => []),
    createMessage: mock(async () => ({ id: 'm-new' })),
    updateTaskState: mock(async () => {}),
    createArtifact: mock(async () => {}),
    updateOpportunityStatus: mock(async () => {}),
  };
}

const turnData = { action: 'counter', assessment: { reasoning: 'r', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } };
const msgFrom = (senderUserId: string) => ({ senderId: `agent:${senderUserId}`, parts: [{ kind: 'data', data: turnData }] });
const legacyMsg = () => ({ parts: [{ kind: 'data', data: turnData }] });

const labels = { fallback: 'f', finalized: 'z', statusUpdateFailed: 's' };

function run(meta: Record<string, unknown>, messages: Array<Record<string, unknown>>, opts?: { maxTurns?: number }) {
  const db = makeDb();
  return {
    db,
    done: runTimeoutFallback({
      database: db as never,
      logger: log.job.from('TimeoutSharedSeatSpec'),
      labels,
      negotiationId: 'neg-1',
      taskId: 'task-1',
      conversationId: 'conv-1',
      meta: meta as never,
      messages: messages as never,
      currentTurnCount: messages.length,
      seedReasoning: 'seed',
      maxTurns: opts?.maxTurns ?? 6,
      rearm: async () => {},
    }),
  };
}

const v2Meta = {
  type: 'negotiation',
  sourceUserId: 'u-a',
  candidateUserId: 'u-b',
  initiatorUserId: 'u-a',
  protocolVersion: 'v2',
  opportunityId: 'opp-1',
};

beforeEach(() => {
  invokeInputs.length = 0;
  MOCK_TURN = { action: 'counter', assessment: { reasoning: 'ai', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } };
});

describe('runTimeoutFallback — seat-scoped schema selection (IND-397)', () => {
  it('v2: parked counterparty turn invokes the agent with counterparty seat + v2', async () => {
    // Initiator (u-a) spoke last → the parked seat is u-b (counterparty).
    const { done } = run(v2Meta, [msgFrom('u-a')]);
    await done;

    expect(invokeInputs[0].seat).toBe('counterparty');
    expect(invokeInputs[0].protocolVersion).toBe('v2');
  });

  it('v2: counterparty-spoke-first continuation parks the initiator seat (parity would flip it)', async () => {
    // One message from u-b → parity (odd count) would call the active speaker
    // "candidate" (u-b); senderId-based attribution correctly parks u-a.
    MOCK_TURN = { action: 'withdraw', assessment: { reasoning: 'not a fit', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } };
    const { db, done } = run(v2Meta, [msgFrom('u-b')]);
    await done;

    expect(invokeInputs[0].seat).toBe('initiator');
    // The withdrawing turn is attributed to the initiator's agent
    const created = (db.createMessage.mock.calls[0] as unknown[])[0] as { senderId: string };
    expect(created.senderId).toBe('agent:u-a');
    // withdraw is reject-like → opportunity rejected
    const statusCall = (db.updateOpportunityStatus.mock.calls[0] as unknown[]) as [string, string];
    expect(statusCall[1]).toBe('rejected');
  });

  it('v2: final allowed turn passes isFinalTurn so the final seat schema is selected', async () => {
    MOCK_TURN = { action: 'decline', assessment: { reasoning: 'no', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } };
    const { done } = run(v2Meta, [msgFrom('u-a')], { maxTurns: 2 });
    await done;

    expect(invokeInputs[0].isFinalTurn).toBe(true);
    expect(invokeInputs[0].seat).toBe('counterparty');
  });

  it('v1 tasks keep legacy behavior: v1 version, no final-turn forcing', async () => {
    const v1Meta = { type: 'negotiation', sourceUserId: 'u-a', candidateUserId: 'u-b' };
    const { done } = run(v1Meta, [legacyMsg()], { maxTurns: 2 });
    await done;

    expect(invokeInputs[0].protocolVersion).toBe('v1');
    expect(invokeInputs[0].isFinalTurn).toBeUndefined();
  });

  it('legacy rows without senderId fall back to parity attribution', async () => {
    const v1Meta = { type: 'negotiation', sourceUserId: 'u-a', candidateUserId: 'u-b' };
    const { db, done } = run(v1Meta, [legacyMsg()]); // 1 message, no senderId → parity: candidate speaks
    await done;

    const created = (db.createMessage.mock.calls[0] as unknown[])[0] as { senderId: string };
    expect(created.senderId).toBe('agent:u-b');
  });
});
