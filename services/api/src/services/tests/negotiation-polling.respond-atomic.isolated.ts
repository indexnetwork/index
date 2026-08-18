process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const agentId = 'agent-hermes';
const ownerId = 'owner';
const taskId = 'task';
const conversationId = 'conversation';
const updatedAt = new Date('2026-01-02T03:04:05.000Z');
const COMMITTED_AT = Date.parse('2026-01-02T03:05:00.000Z');
const DEADLINE_AT = '2026-01-02T03:10:00.000Z';
let now = COMMITTED_AT;
const principal = {
  credentialId: 'credential',
  agentId,
  audience: 'hermes-negotiator' as const,
  setupAttemptId: 'setup',
};
const authority = { runId: 'run', capability: 'capability', outcome: 'responded' as const };

const cancelClaimTimeout = mock(async () => undefined);
const enqueueParkTimeout = mock(async () => 'park-job');

const singletonAdapter = {
  pickupNegotiationAtomically: async () => ({ kind: 'empty' as const }),
};
mock.module('../../adapters/database.adapter', () => ({ conversationDatabaseAdapter: singletonAdapter }));
mock.module('../../lib/drizzle/drizzle', () => ({ default: {} }));
mock.module('../../queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: {
    cancelTimeout: async () => undefined,
    enqueueTimeout: enqueueParkTimeout,
    enqueueAskUserExpiry: async () => 'expiry',
    cancelAskUserExpiry: async () => undefined,
  },
}));
mock.module('../../queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: { cancelTimeout: cancelClaimTimeout, enqueueTimeout: async () => 'claim-job' },
}));
mock.module('../../queues/questioner.queue', () => ({ questionerEnqueueIfEnabled: () => null }));
mock.module('../../adapters/negotiator-memory.retrieval.adapter', () => ({
  negotiatorMemoryRetrievalAdapter: { retrieveForNegotiation: async () => [] },
}));

const { NegotiationPollingService } = await import('../negotiation-polling.service');
const telemetryEvents: Array<{ name: string; attributes: Record<string, string> }> = [];
const telemetry = {
  increment: (name: string, attributes: Record<string, string> = {}) => telemetryEvents.push({ name: `hermes.${name}`, attributes }),
  gauge: () => undefined,
  observe: () => undefined,
};

const metadata = {
  type: 'negotiation',
  protocolVersion: 'v2',
  sourceUserId: 'counterparty',
  candidateUserId: ownerId,
  initiatorUserId: 'counterparty',
  opportunityId: 'opportunity',
  maxTurns: 6,
};
const task = {
  id: taskId,
  conversationId,
  state: 'claimed',
  claimedByAgentId: agentId,
  metadata,
  updatedAt,
};
const messages = [{
  id: 'prior',
  senderId: 'agent:counterparty',
  role: 'agent' as const,
  parts: [{ kind: 'data', data: {
    action: 'propose',
    message: 'prior',
    assessment: { reasoning: 'prior', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
  } }],
  createdAt: new Date('2026-01-02T03:00:00.000Z'),
}];

const getTask = mock(async () => task);
const getMessages = mock(async () => messages);
const getReplay = mock(async () => null as never);
const commit = mock(async (input: Record<string, unknown>) => ({
  kind: 'committed' as const,
  receipt: {
    version: 1 as const,
    receiptId: (input.identity as { receiptId: string }).receiptId,
    taskId,
    messageId: (input.identity as { messageId: string }).messageId,
    artifactId: null,
    action: (input.turn as { action: string }).action,
    finalState: 'waiting_for_agent' as const,
    turnNumber: 2,
    completedAt: '2026-01-02T03:05:00.000Z',
  },
  queueIntent: {
    cancelClaimTimeout: true as const,
    claimGeneration: '2026-01-02T03:04:05.000Z',
    rearmParkTimeout: { turnNumber: 2, deadlineAt: DEADLINE_AT, parkGeneration: 'receipt-park-generation' },
  },
  outboxDelivered: false,
}));
const markDelivered = mock(async () => true);
const responsePersistence = {
  getTask,
  getMessagesForConversation: getMessages,
  getNegotiationMessages: getMessages,
  getPendingHermesResponseOutboxes: async () => [],
  getHermesResponseReplay: getReplay,
  respondHermesNegotiationAtomically: commit,
  markHermesResponseOutboxDelivered: markDelivered,
};
const service = new NegotiationPollingService(
  { authorizePickup: async () => true, authorizeRespond: async () => true } as never,
  singletonAdapter as never,
  responsePersistence as never,
  () => now,
  telemetry as never,
);

beforeEach(() => {
  getTask.mockClear();
  getMessages.mockClear();
  getReplay.mockClear();
  getReplay.mockResolvedValue(null as never);
  commit.mockClear();
  markDelivered.mockClear();
  cancelClaimTimeout.mockClear();
  enqueueParkTimeout.mockClear();
  telemetryEvents.length = 0;
  now = COMMITTED_AT;
});

afterAll(() => mock.restore());

describe('NegotiationPollingService closed Hermes atomic response seam', () => {
  it.each(['source', 'candidate'] as const)(
    'admits the %s owner for the exact ask_user consultation successor',
    async (ownerRole) => {
      const counterpartyId = 'counterparty';
      const roleMetadata = {
        ...metadata,
        sourceUserId: ownerRole === 'source' ? ownerId : counterpartyId,
        candidateUserId: ownerRole === 'candidate' ? ownerId : counterpartyId,
        initiatorUserId: ownerRole === 'source' ? ownerId : counterpartyId,
      };
      getTask.mockResolvedValueOnce({ ...task, metadata: roleMetadata } as never);
      getMessages.mockResolvedValueOnce([
        {
          ...messages[0],
          senderId: `agent:${ownerId}`,
          parts: [{ kind: 'data', data: { ...messages[0].parts[0].data, action: 'ask_user' } }],
        },
        { ...messages[0], id: 'settlement', senderId: 'system:index', parts: [] },
      ] as never);

      await expect(service.respondHermes(
        agentId,
        ownerId,
        taskId,
        { action: 'request_time', roleAlignment: 'peers' },
        principal,
        authority,
      )).resolves.toEqual({ success: true });

      expect(commit).toHaveBeenCalledTimes(1);
    },
  );

  it('ignores an unrelated ask_user message when admitting an ordinary bilateral successor', async () => {
    getMessages.mockResolvedValueOnce([
      ...messages,
      { ...messages[0], id: 'unrelated', senderId: 'agent:unrelated', parts: [{ kind: 'data', data: { action: 'ask_user' } }] },
    ] as never);

    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'request_time', roleAlignment: 'peers' },
      principal,
      authority,
    )).resolves.toEqual({ success: true });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { sourceUserId: '', candidateUserId: ownerId },
    { sourceUserId: ownerId, candidateUserId: ownerId },
  ])('fails closed before persistence for malformed participants %#', async (participantMetadata) => {
    getTask.mockResolvedValueOnce({ ...task, metadata: { ...metadata, ...participantMetadata } } as never);
    getMessages.mockResolvedValueOnce([] as never);

    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'request_time', roleAlignment: 'peers' },
      principal,
      authority,
    )).rejects.toThrow(/turn to respond/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('computes a fixed request-time turn before one atomic persistence call and delivers its durable outbox', async () => {
    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'request_time', roleAlignment: 'counterparty_leads' },
      principal,
      authority,
    )).resolves.toEqual({ success: true });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0][0]).toMatchObject({
      taskId,
      expectedConversationId: conversationId,
      expectedTaskUpdatedAt: updatedAt,
      expectedTurnCount: 1,
      finalState: 'waiting_for_agent',
      turn: {
        action: 'counter',
        message: 'I need more time before deciding.',
        assessment: {
          reasoning: 'Hermes selected the closed request_time directive.',
          suggestedRoles: { ownUser: 'patient', otherUser: 'agent' },
        },
      },
    });
    expect(cancelClaimTimeout).toHaveBeenCalledWith(taskId, '2026-01-02T03:04:05.000Z');
    expect(enqueueParkTimeout).toHaveBeenCalledWith(
      taskId, 2, 300_000, 'receipt-park-generation', undefined,
    );
    expect(markDelivered).toHaveBeenCalledTimes(1);
  });

  it('computes terminal task, artifact, opportunity, and continuation outcome intent before mutation', async () => {
    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'decline', roleAlignment: 'peers' },
      principal,
      authority,
    )).resolves.toEqual({ success: true });

    expect(commit.mock.calls[0][0]).toMatchObject({
      finalState: 'completed',
      turn: {
        action: 'decline',
        message: 'I am going to decline this opportunity.',
      },
      outcome: {
        hasOpportunity: false,
        turnCount: 2,
      },
      opportunity: { id: 'opportunity', status: 'rejected' },
      continuationOutcome: 'rejected',
    });
  });

  it('rejects ordinary success when committed outbox delivery remains pending', async () => {
    enqueueParkTimeout.mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'request_time', roleAlignment: 'counterparty_leads' },
      principal,
      authority,
    )).rejects.toThrow('queue unavailable');

    expect(commit).toHaveBeenCalledTimes(1);
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('repairs a pending replay outbox without recomputing or mutating the response', async () => {
    getReplay.mockResolvedValue({
      kind: 'replay',
      receipt: {
        version: 1, receiptId: 'receipt', taskId, messageId: 'message', artifactId: null,
        action: 'counter', finalState: 'waiting_for_agent', turnNumber: 2,
        completedAt: '2026-01-02T03:05:00.000Z',
      },
      queueIntent: {
        cancelClaimTimeout: true,
        claimGeneration: '2026-01-02T03:04:05.000Z',
        rearmParkTimeout: { turnNumber: 2, deadlineAt: DEADLINE_AT, parkGeneration: 'receipt-park-generation' },
      },
      outboxDelivered: false,
    } as never);

    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'decline', roleAlignment: 'peers' },
      principal,
      authority,
    )).resolves.toEqual({ success: true });

    expect(getTask).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(enqueueParkTimeout).toHaveBeenCalledWith(
      taskId, 2, 300_000, 'receipt-park-generation', undefined,
    );
    expect(markDelivered).toHaveBeenCalledWith(taskId, 'receipt');
    expect(telemetryEvents).toEqual([
      { name: 'hermes.outbox_replay_attempted', attributes: { reason: 'outbox_pending' } },
    ]);
    expect(JSON.stringify(telemetryEvents)).not.toMatch(/task|receipt|owner|agent|run|capability/);
  });

  it('does not count or attempt delivery for an already-delivered idempotent replay', async () => {
    getReplay.mockResolvedValue({
      kind: 'replay',
      receipt: {
        version: 1, receiptId: 'receipt', taskId, messageId: 'message', artifactId: null,
        action: 'counter', finalState: 'waiting_for_agent', turnNumber: 2,
        completedAt: '2026-01-02T03:05:00.000Z',
      },
      queueIntent: {
        cancelClaimTimeout: true,
        claimGeneration: '2026-01-02T03:04:05.000Z',
        rearmParkTimeout: null,
      },
      outboxDelivered: true,
    } as never);

    await expect(service.respondHermes(
      agentId,
      ownerId,
      taskId,
      { action: 'decline', roleAlignment: 'peers' },
      principal,
      authority,
    )).resolves.toEqual({ success: true });

    expect(telemetryEvents).toEqual([]);
    expect(cancelClaimTimeout).not.toHaveBeenCalled();
    expect(enqueueParkTimeout).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('never extends the committed response deadline across a substantial outage or repeated replay', async () => {
    getReplay.mockResolvedValue({
      kind: 'replay',
      receipt: {
        version: 1, receiptId: 'receipt', taskId, messageId: 'message', artifactId: null,
        action: 'counter', finalState: 'waiting_for_agent', turnNumber: 2,
        completedAt: '2026-01-02T03:05:00.000Z',
      },
      queueIntent: {
        cancelClaimTimeout: true,
        claimGeneration: '2026-01-02T03:04:05.000Z',
        rearmParkTimeout: { turnNumber: 2, deadlineAt: DEADLINE_AT, parkGeneration: 'receipt-park-generation' },
      },
      outboxDelivered: false,
    } as never);

    now = Date.parse('2026-01-02T03:09:00.000Z');
    await service.respondHermes(agentId, ownerId, taskId, { action: 'decline', roleAlignment: 'peers' }, principal, authority);
    now = Date.parse('2026-01-02T04:09:00.000Z');
    await service.respondHermes(agentId, ownerId, taskId, { action: 'decline', roleAlignment: 'peers' }, principal, authority);

    expect(enqueueParkTimeout).toHaveBeenNthCalledWith(
      1, taskId, 2, 60_000, 'receipt-park-generation', undefined,
    );
    expect(enqueueParkTimeout).toHaveBeenNthCalledWith(
      2, taskId, 2, 0, 'receipt-park-generation', undefined,
    );
  });
});
