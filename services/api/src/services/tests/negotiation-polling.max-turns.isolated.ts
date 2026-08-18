process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { isNegotiationTurnCapReached } from '@indexnetwork/protocol';

const ownerId = 'owner';
const otherId = 'other';
const agentId = 'agent';
const principal = {
  credentialId: 'credential',
  agentId,
  audience: 'hermes-negotiator' as const,
  setupAttemptId: 'setup',
};

const cancelParkTimeout = mock(async () => undefined);
const enqueueParkTimeout = mock(async () => 'park-timeout');
const cancelClaimTimeout = mock(async () => undefined);
const enqueueClaimTimeout = mock(async () => 'claim-timeout');
const createMessage = mock(async () => ({ id: 'new-message' }));
const updateTaskState = mock(async () => undefined);
const createArtifact = mock(async () => ({ id: 'artifact' }));
const commitHermesResponse = mock(async (input: Record<string, unknown>) => ({
  kind: 'committed' as const,
  receipt: {
    version: 1 as const,
    receiptId: 'receipt',
    taskId: 'task',
    messageId: 'response-message',
    artifactId: null,
    action: 'counter',
    finalState: input.finalState as 'completed' | 'waiting_for_agent',
    turnNumber: messages.length + 1,
    completedAt: '2026-01-01T00:02:00.000Z',
  },
  queueIntent: {
    cancelClaimTimeout: true as const,
    claimGeneration: '2026-01-01T00:01:00.000Z',
    rearmParkTimeout: null,
  },
  outboxDelivered: false,
}));
const markHermesResponseOutboxDelivered = mock(async () => true);

let metadata: Record<string, unknown>;
let messages: Array<Record<string, unknown>>;

function message(index: number): Record<string, unknown> {
  return {
    id: `message-${index}`,
    senderId: `agent:${index % 2 === 0 ? otherId : ownerId}`,
    role: 'agent',
    parts: [{
      kind: 'data',
      data: {
        action: 'counter',
        message: null,
        assessment: {
          reasoning: 'fixture',
          suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
        },
      },
    }],
    createdAt: new Date(`2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`),
  };
}

function task() {
  return {
    id: 'task',
    conversationId: 'conversation',
    state: 'claimed',
    statusMessage: null,
    statusTimestamp: null,
    metadata,
    claimedByAgentId: agentId,
    claimedAt: new Date('2026-01-01T00:01:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:01:00.000Z'),
  };
}

const adapter = {
  pickupNegotiationAtomically: mock(async () => ({
    kind: 'existing' as const,
    task: task(),
    parkStartTime: new Date('2026-01-01T00:00:00.000Z'),
    parkGeneration: 'park-generation',
    runCapability: 'run-capability',
  })),
  getTask: mock(async () => task()),
  getMessagesForConversation: mock(async () => messages),
  getNegotiationMessages: mock(async () => messages),
  getPendingHermesResponseOutboxes: mock(async () => []),
  getHermesResponseReplay: mock(async () => null),
  respondHermesNegotiationAtomically: commitHermesResponse,
  markHermesResponseOutboxDelivered,
  transitionClaimedTaskToWorking: mock(async () => task()),
  createMessage,
  updateTaskState,
  createArtifact,
  updateOpportunityStatus: mock(async () => undefined),
};

mock.module('../../adapters/database.adapter', () => ({ conversationDatabaseAdapter: adapter }));
mock.module('../../lib/drizzle/drizzle', () => ({ default: {} }));
mock.module('../../queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: {
    cancelTimeout: cancelParkTimeout,
    enqueueTimeout: enqueueParkTimeout,
    enqueueAskUserExpiry: async () => 'expiry',
  },
}));
mock.module('../../queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: {
    cancelTimeout: cancelClaimTimeout,
    enqueueTimeout: enqueueClaimTimeout,
  },
}));
mock.module('../../queues/questioner.queue', () => ({ questionerEnqueueIfEnabled: () => null }));
mock.module('../../adapters/negotiator-memory.retrieval.adapter', () => ({
  negotiatorMemoryRetrievalAdapter: { retrieveForNegotiation: async () => [] },
}));

const { NegotiationPollingService } = await import('../negotiation-polling.service');
const service = new NegotiationPollingService(
  { authorizePickup: async () => true, authorizeRespond: async () => true } as never,
  adapter as never,
  adapter as never,
);

function setCounterpartyPickup(maxTurns: number | null | undefined, turnCount: number): void {
  metadata = {
    type: 'negotiation',
    protocolVersion: 'v2',
    sourceUserId: otherId,
    candidateUserId: ownerId,
    initiatorUserId: otherId,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  };
  messages = Array.from({ length: turnCount }, (_, index) => message(index));
  if (messages.length > 0) messages[messages.length - 1]!.senderId = `agent:${otherId}`;
}

function setInitiatorResponse(maxTurns: number | null | undefined, priorTurnCount: number): void {
  metadata = {
    type: 'negotiation',
    protocolVersion: 'v2',
    sourceUserId: ownerId,
    candidateUserId: otherId,
    initiatorUserId: ownerId,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
  };
  messages = Array.from({ length: priorTurnCount }, (_, index) => message(index));
  if (messages.length > 0) messages[messages.length - 1]!.senderId = `agent:${otherId}`;
}

const response = (action: 'counter' | 'withdraw') => ({
  action,
  message: null,
  assessment: {
    reasoning: 'fixture',
    suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const },
  },
});

beforeEach(() => {
  setCounterpartyPickup(6, 0);
  for (const fn of [
    cancelParkTimeout,
    enqueueParkTimeout,
    cancelClaimTimeout,
    enqueueClaimTimeout,
    createMessage,
    updateTaskState,
    createArtifact,
    commitHermesResponse,
    markHermesResponseOutboxDelivered,
  ]) fn.mockClear();
});

afterAll(() => mock.restore());

describe('negotiation polling maxTurns semantics', () => {
  it.each([
    ['absent below default', undefined, 5, false],
    ['absent at default', undefined, 6, true],
    ['null at default', null, 6, true],
    ['zero far beyond the default', 0, 100, false],
    ['positive below boundary', 3, 2, false],
    ['positive at boundary', 3, 3, true],
    ['positive beyond boundary', 3, 4, true],
  ] as const)('%s', (_label, maxTurns, turnCount, expected) => {
    expect(isNegotiationTurnCapReached(turnCount, maxTurns)).toBe(expected);
  });

  it.each([
    ['uncapped zero', 0, 100, ['accept', 'decline', 'request_time', 'continue']],
    ['absent defaults to six', undefined, 5, ['accept', 'decline']],
    ['null defaults to six', null, 5, ['accept', 'decline']],
    ['positive before boundary', 3, 1, ['accept', 'decline', 'request_time', 'continue']],
    ['positive at boundary', 3, 2, ['accept', 'decline']],
    ['positive beyond boundary', 3, 3, ['accept', 'decline']],
  ] as const)('Hermes pickup action set is correct for %s', async (_label, maxTurns, turnCount, expected) => {
    setCounterpartyPickup(maxTurns, turnCount);

    const result = await service.pickup(agentId, ownerId, principal, 'run');

    expect(result?.allowedActions).toEqual([...expected]);
  });

  it.each([
    ['uncapped zero', 0, 100, 'waiting_for_agent'],
    ['absent before default', undefined, 4, 'waiting_for_agent'],
    ['absent at default', undefined, 5, 'completed'],
    ['null at default', null, 5, 'completed'],
    ['positive before boundary', 3, 1, 'waiting_for_agent'],
    ['positive at boundary', 3, 2, 'completed'],
    ['positive beyond boundary', 3, 3, 'completed'],
  ] as const)('closed Hermes respond state is correct for %s', async (_label, maxTurns, priorTurnCount, expectedState) => {
    setInitiatorResponse(maxTurns, priorTurnCount);

    await service.respondHermes(
      agentId,
      ownerId,
      'task',
      { action: 'request_time', roleAlignment: 'peers' },
      principal,
      { runId: 'run', capability: 'capability', outcome: 'responded' },
    );

    expect(commitHermesResponse.mock.calls[0]?.[0]).toMatchObject({ finalState: expectedState });
  });

  it.each([
    ['uncapped zero', 0, 100, 'waiting_for_agent'],
    ['absent before default', undefined, 4, 'waiting_for_agent'],
    ['absent at default', undefined, 5, 'completed'],
    ['null at default', null, 5, 'completed'],
    ['positive before boundary', 3, 1, 'waiting_for_agent'],
    ['positive at boundary', 3, 2, 'completed'],
    ['positive beyond boundary', 3, 3, 'completed'],
  ] as const)('legacy respond state is correct for %s', async (_label, maxTurns, priorTurnCount, expectedState) => {
    setInitiatorResponse(maxTurns, priorTurnCount);

    await service.respond(agentId, ownerId, 'task', response('counter'), {
      ...principal,
      audience: null,
      setupAttemptId: null,
    });

    expect(updateTaskState).toHaveBeenCalledWith(
      'task',
      expectedState,
      undefined,
      undefined,
      ...(expectedState === 'waiting_for_agent' ? [expect.any(String)] : []),
    );
  });

  it('terminal actions still complete an uncapped negotiation', async () => {
    setInitiatorResponse(0, 20);

    await service.respond(agentId, ownerId, 'task', response('withdraw'), {
      ...principal,
      audience: null,
      setupAttemptId: null,
    });

    expect(updateTaskState).toHaveBeenCalledWith('task', 'completed', undefined, undefined);
    expect(createArtifact).toHaveBeenCalledTimes(1);
    expect(enqueueParkTimeout).not.toHaveBeenCalled();
  });
});
