process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { consultationExpiryReadiness } from '../../lib/negotiation/consultation-expiry';

const agentId = 'agent-1';
const userId = 'user-owner';
const taskId = 'task-1';
const enqueueExpiry = mock(async () => 'expiry-job');
const cancelExpiry = mock(async () => undefined);
const cancelClaim = mock(async () => undefined);
const enqueueQuestion = mock(async () => undefined);
const pause = mock(async () => ({ task: { id: taskId }, binding: { consultationAttemptId: 'winner' } }));
const transition = mock(async () => null);

const metadata = {
  type: 'negotiation', protocolVersion: 'v2', sourceUserId: 'counterparty', candidateUserId: userId,
  initiatorUserId: 'counterparty', sourceIntentId: 'intent-other', candidateIntentId: 'intent-owner',
  opportunityId: 'opp-1', networkId: 'network-1', maxTurns: 6,
  participantBindings: [
    { userId: 'counterparty', intentId: 'intent-other', networkId: 'network-1' },
    { userId, intentId: 'intent-owner', networkId: 'network-1' },
  ],
  turnContext: {
    sourceUser: { id: 'counterparty', profile: { name: 'Counterparty Person', bio: 'private counterparty biography', location: 'Somewhere' }, intents: [] },
    candidateUser: { id: userId, profile: { name: 'Owner' }, intents: [] },
    indexContext: { networkId: 'network-1', prompt: 'private network prompt' },
    seedAssessment: { reasoning: 'private seed assessment' },
  },
};
const claimedAt = new Date('2026-08-07T00:00:01.000Z');
let task: Record<string, unknown> = {
  id: taskId, conversationId: 'conversation-1', state: 'claimed', claimedByAgentId: agentId,
  claimedAt, metadata, updatedAt: new Date(),
};
const messages = [
  { id: 'm1', senderId: `agent:${userId}`, parts: [{ kind: 'data', data: { action: 'outreach', assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } } } }] },
  { id: 'm2', senderId: 'agent:counterparty', parts: [{ kind: 'data', data: { action: 'counter', assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } } } }] },
];
const material = {
  intentFingerprint: 'fingerprint', opportunityStatus: 'negotiating',
  opportunityUpdatedAt: '2026-08-07T00:00:00.000Z', counterpartyUserId: 'counterparty',
  counterpartyBinding: { kind: 'intent' as const, id: 'intent-other' },
};
const getMaterial = mock(async () => material);
const adapter = {
  getTask: mock(async () => task),
  getMessagesForConversation: mock(async () => messages),
  getNegotiationMessages: mock(async () => messages),
  getClaimedNegotiationConsultationMaterial: getMaterial,
  pauseClaimedNegotiationForConsultation: pause,
  transitionClaimedTaskToWorking: transition,
};

mock.module('../../adapters/database.adapter', () => ({ conversationDatabaseAdapter: adapter }));
mock.module('../../lib/drizzle/drizzle', () => ({ default: {} }));
mock.module('../../queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: { enqueueAskUserExpiry: enqueueExpiry, cancelAskUserExpiry: cancelExpiry, cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
}));
mock.module('../../queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: { cancelTimeout: cancelClaim, enqueueTimeout: async () => {} },
}));
mock.module('../../queues/parked-question.enqueue', () => ({ parkedQuestionEnqueue: () => enqueueQuestion }));
mock.module('../../adapters/negotiator-memory.retrieval.adapter', () => ({
  negotiatorMemoryRetrievalAdapter: { retrieveForNegotiation: async () => [] },
}));

const { NegotiationPollingService, ConflictError, NotFoundError, SeatViolationError } = await import('../negotiation-polling.service');
const authorization = { authorizePickup: async () => true, authorizeRespond: async () => true };
const service = new NegotiationPollingService(
  authorization as never,
  undefined as never,
);
const principal = {
  credentialId: 'credential-current', agentId, audience: 'hermes-negotiator' as const, setupAttemptId: 'setup-current',
};
const reason = { reason: 'consequential_disclosure_permission' as const };

beforeEach(() => {
  task = {
    id: taskId, conversationId: 'conversation-1', state: 'claimed', claimedByAgentId: agentId,
    claimedAt, metadata, updatedAt: new Date(),
  };
  enqueueExpiry.mockClear(); cancelExpiry.mockClear(); cancelClaim.mockClear(); enqueueQuestion.mockClear();
  getMaterial.mockClear(); getMaterial.mockResolvedValue(material);
  pause.mockClear(); pause.mockResolvedValue({ task: { id: taskId }, binding: { consultationAttemptId: 'winner' } } as never);
  transition.mockClear();
});

afterAll(() => mock.restore());

describe('NegotiationPollingService.consult', () => {
  it('arms attempt-specific expiry, atomically pauses, cancels the claim timer, and enqueues safe Questioner context', async () => {
    const result = await service.consult(agentId, userId, taskId, reason, principal);
    expect(result).toEqual({ success: true, status: 'input_required', settlementId: `negotiation-question-settlement-v1-${taskId}` });
    expect(getMaterial).toHaveBeenCalledWith(expect.objectContaining({
      counterpartyUserId: 'counterparty',
      counterpartyBinding: { kind: 'intent', id: 'intent-other' },
    }));
    expect(enqueueExpiry).toHaveBeenCalledTimes(1);
    const attemptId = enqueueExpiry.mock.calls[0][1];
    expect(typeof attemptId).toBe('string');
    expect(enqueueExpiry.mock.calls[0][2]).toMatchObject({
      claimedByAgentId: agentId,
      counterpartyUserId: 'counterparty',
      counterpartyBinding: { kind: 'intent', id: 'intent-other' },
    });
    expect(pause.mock.calls[0][0]).toMatchObject({
      claimedByAgentId: agentId,
      consultationAttemptId: attemptId,
      expectedMaterial: material,
      principal,
      safeAskUser: {
        disclosureSubject: 'your permission',
        draftQuestion: 'May I share the information needed to explore this collaboration?',
      },
    });
    expect(cancelClaim).toHaveBeenCalledWith(taskId, claimedAt.toISOString());
    const payload = enqueueQuestion.mock.calls[0][0];
    expect(JSON.stringify(payload.context)).not.toContain('Counterparty Person');
    expect(payload.context).toEqual({
      negotiationId: taskId,
      counterpartyHint: 'the other participant',
      indexContext: 'the selected network',
      consultationPolicyReason: 'consequential_disclosure_permission',
    });
    expect(JSON.stringify(payload)).not.toContain('Ignore prior instructions');
  });

  it('rejects stale actor-derived counterparty intent material before arming expiry', async () => {
    getMaterial.mockResolvedValueOnce({ ...material, counterpartyBinding: { kind: 'intent' as const, id: 'intent-stale' } });

    await expect(service.consult(agentId, userId, taskId, reason, principal))
      .rejects.toBeInstanceOf(ConflictError);

    expect(enqueueExpiry).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(task).toMatchObject({ state: 'claimed', claimedByAgentId: agentId });
  });

  it('keeps a bound expiry retryable when locked material rejects the later pause', async () => {
    pause.mockImplementationOnce(async () => {
      const [, consultationAttemptId, payload] = enqueueExpiry.mock.calls[0];
      expect(consultationExpiryReadiness({
        taskState: 'claimed',
        taskClaimedByAgentId: agentId,
        taskMetadata: metadata,
        coordinates: { consultationAttemptId, ...payload },
      })).toBe('pending_pause');
      return null;
    });

    await expect(service.consult(agentId, userId, taskId, reason, principal))
      .rejects.toBeInstanceOf(ConflictError);

    const attemptId = enqueueExpiry.mock.calls[0][1];
    expect(cancelExpiry).toHaveBeenCalledWith(taskId, attemptId);
    expect(task).toMatchObject({ state: 'claimed', claimedByAgentId: agentId });
  });

  it('rejects a different claimant without consuming the claim', async () => {
    task = { ...task, claimedByAgentId: 'agent-other' };
    await expect(service.consult(agentId, userId, taskId, reason, principal)).rejects.toBeInstanceOf(ConflictError);
    expect(pause).not.toHaveBeenCalled();
    expect(enqueueExpiry).not.toHaveBeenCalled();
  });

  it('rejects the wrong owner before arming expiry or pausing the claim', async () => {
    const admission = service.consult(agentId, 'user-stranger', taskId, reason, principal);
    await expect(admission).rejects.toBeInstanceOf(NotFoundError);
    await expect(admission).rejects.toThrow(`Negotiation ${taskId} not found`);
    expect(enqueueExpiry).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(cancelClaim).not.toHaveBeenCalled();
    expect(task.state).toBe('claimed');
  });

  it('rejects a category that does not match the server-derived consultation reason', async () => {
    await expect(service.consult(agentId, userId, taskId, { reason: 'unresolved_owner_constraint' }, principal))
      .rejects.toBeInstanceOf(SeatViolationError);
    expect(pause).not.toHaveBeenCalled();
    expect(task.state).toBe('claimed');
  });

  it('expiry enqueue failure preserves the original claim and claim deadline', async () => {
    enqueueExpiry.mockRejectedValueOnce(new Error('expiry queue unavailable'));

    await expect(service.consult(agentId, userId, taskId, reason, principal))
      .rejects.toThrow('expiry queue unavailable');

    expect(pause).not.toHaveBeenCalled();
    expect(cancelClaim).not.toHaveBeenCalled();
    expect(cancelExpiry).not.toHaveBeenCalled();
    expect(enqueueQuestion).not.toHaveBeenCalled();
    expect(task).toMatchObject({ state: 'claimed', claimedByAgentId: agentId });
  });

  it('duplicate loser cancels only its own attempt-specific expiry', async () => {
    pause.mockResolvedValueOnce(null);
    await expect(service.consult(agentId, userId, taskId, reason, principal)).rejects.toBeInstanceOf(ConflictError);
    const attemptId = enqueueExpiry.mock.calls[0][1];
    expect(cancelExpiry).toHaveBeenCalledWith(taskId, attemptId);
  });

  it('Questioner enqueue failure leaves the committed pause recoverable by expiry', async () => {
    enqueueQuestion.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(service.consult(agentId, userId, taskId, reason, principal)).resolves.toMatchObject({ status: 'input_required' });
    expect(enqueueExpiry).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(cancelExpiry).not.toHaveBeenCalled();
  });

  it('wrong-agent respond cannot consume the claim at the adapter CAS boundary', async () => {
    task = { ...task, claimedByAgentId: 'agent-other' };
    await expect(service.respond(agentId, userId, taskId, {
      action: 'counter', message: null,
      assessment: { reasoning: 'safe', suggestedRoles: { ownUser: 'patient', otherUser: 'agent' } },
    }, principal)).rejects.toBeInstanceOf(ConflictError);
    expect(transition).toHaveBeenCalledWith(taskId, agentId, undefined, principal, userId);
  });
});
