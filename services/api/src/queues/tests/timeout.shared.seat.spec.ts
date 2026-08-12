/**
 * IND-397 — timeout fallback uses the parked seat's schema (v2 seat rules).
 *
 * When a parked turn times out and the system agent takes over, the agent must
 * be invoked with the parked seat + the task's protocol version — an
 * initiator-seat fallback can never accept on the user's behalf. Speaker
 * attribution derives from the canonical action-aware speaker helper, not turn parity.
 * Hermetic: negotiator invocation and database are injected directly.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { log } from '../../lib/log';
import { runTimeoutFallback } from '../negotiations/timeout.shared';

let MOCK_TURN: Record<string, unknown> = {
  action: 'counter',
  assessment: { reasoning: 'ai', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
};
const invokeInputs: Array<Record<string, unknown>> = [];

const invokeNegotiator = async (input: Record<string, unknown>) => {
  invokeInputs.push(input);
  return MOCK_TURN as never;
};

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
const actionMsgFrom = (senderUserId: string, action: string) => ({
  senderId: `agent:${senderUserId}`,
  parts: [{ kind: 'data', data: { ...turnData, action } }],
});
const settlementNoise = { senderId: 'system:index', parts: [{ kind: 'data', data: { action: 'settled' } }] };
const legacyMsg = () => ({ parts: [{ kind: 'data', data: turnData }] });

const labels = { fallback: 'f', finalized: 'z', statusUpdateFailed: 's' };

function run(meta: Record<string, unknown>, messages: Array<Record<string, unknown>>, opts?: { maxTurns?: number | null }) {
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
      maxTurns: opts && Object.hasOwn(opts, 'maxTurns') ? opts.maxTurns : undefined,
      rearm: async () => {},
      invokeNegotiator,
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

  it.each([
    ['u-a', 'initiator'],
    ['u-b', 'counterparty'],
  ] as const)('v2: %s ask_user retains its seat after settlement noise', async (speaker, expectedSeat) => {
    const { done } = run(v2Meta, [actionMsgFrom(speaker, 'ask_user'), settlementNoise]);
    await done;

    expect(invokeInputs[0].seat).toBe(expectedSeat);
  });

  it.each([
    { sourceUserId: '', candidateUserId: 'u-b' },
    { sourceUserId: 'u-a', candidateUserId: 'u-a' },
  ])('fails closed before timeout invocation for malformed participants %#', async (participantMeta) => {
    const { done } = run({ ...v2Meta, ...participantMeta }, []);

    await expect(done).rejects.toThrow(/malformed bilateral speaker metadata/);
    expect(invokeInputs).toHaveLength(0);
  });

  it('v2: final allowed turn passes isFinalTurn so the final seat schema is selected', async () => {
    MOCK_TURN = { action: 'decline', assessment: { reasoning: 'no', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } };
    const { done } = run(v2Meta, [msgFrom('u-a')], { maxTurns: 2 });
    await done;

    expect(invokeInputs[0].isFinalTurn).toBe(true);
    expect(invokeInputs[0].seat).toBe('counterparty');
  });

  it.each([
    ['uncapped zero', 0, false, 'waiting_for_agent'],
    ['absent defaults to six', undefined, true, 'completed'],
    ['positive boundary', 6, true, 'completed'],
  ] as const)('legacy fallback applies %s cap semantics to final-turn and persistence', async (_label, maxTurns, final, expectedState) => {
    const messages = Array.from({ length: 5 }, (_, index) => msgFrom(index % 2 === 0 ? 'u-a' : 'u-b'));
    const { db, done } = run(v2Meta, messages, { maxTurns });
    await done;

    expect(invokeInputs[0].isFinalTurn === true).toBe(final);
    expect(db.updateTaskState.mock.calls[0]?.[1]).toBe(expectedState);
  });

  it('v1 tasks keep legacy behavior: v1 version, no final-turn forcing', async () => {
    const v1Meta = { type: 'negotiation', sourceUserId: 'u-a', candidateUserId: 'u-b' };
    const { done } = run(v1Meta, [legacyMsg()], { maxTurns: 2 });
    await done;

    expect(invokeInputs[0].protocolVersion).toBe('v1');
    expect(invokeInputs[0].isFinalTurn).toBeUndefined();
  });

  it('legacy rows without a canonical participant sender fail safely to the source opener', async () => {
    const v1Meta = { type: 'negotiation', sourceUserId: 'u-a', candidateUserId: 'u-b' };
    const { db, done } = run(v1Meta, [legacyMsg()]);
    await done;

    const created = (db.createMessage.mock.calls[0] as unknown[])[0] as { senderId: string };
    expect(created.senderId).toBe('agent:u-a');
  });
});
