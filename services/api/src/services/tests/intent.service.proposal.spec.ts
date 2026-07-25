import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock } from 'bun:test';

import { IntentDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { IntentAdmissionEnqueueError, IntentNetworkMembershipError, IntentService } from '../intent.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NETWORK_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';

function createdIntent() {
  return {
    id: INTENT_ID,
    userId: USER_ID,
    payload: 'Find climate founders',
    summary: null,
    isIncognito: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeHarness(
  result: 'created' | 'existing' | 'membership_required' = 'created',
  committedReplay = false,
  isMember = true,
  questionerThrows = false,
) {
  const getIntentBySourceId = mock(async () => committedReplay
    ? { id: INTENT_ID, archivedAt: null }
    : null);
  const isNetworkMember = mock(async () => isMember);
  const confirmProposalIntent = mock(async () => {
    if (result === 'existing') {
      return { kind: 'existing' as const, intent: { id: INTENT_ID, archivedAt: null } };
    }
    if (result === 'membership_required') {
      return { kind: 'membership_required' as const };
    }
    return { kind: 'created' as const, intent: createdIntent() };
  });
  const generate = mock(async () => [0.5, 0.5]);
  const getUserContext = mock(async () => ({ text: 'Climate founder operator' }));
  const addGenerateHydeJob = mock(async () => 'job-id');
  const questionerEnqueue = mock(async () => {
    if (questionerThrows) throw new Error('questioner unavailable');
  });
  const emitProposalCreated = mock(() => {});

  const service = new IntentService({
    adapter: {
      getIntentBySourceId,
      isNetworkMember,
      confirmProposalIntent,
      getUserContext,
    } as unknown as IntentDatabaseAdapter,
    embedder: { generate } as unknown as EmbedderAdapter,
    proposalQueue: { addGenerateHydeJob } as never,
    questionerEnqueue,
    emitProposalCreated,
  });

  return {
    service,
    calls: {
      getIntentBySourceId,
      isNetworkMember,
      confirmProposalIntent,
      generate,
      getUserContext,
      addGenerateHydeJob,
      questionerEnqueue,
      emitProposalCreated,
    },
  };
}

describe('IntentService.createFromProposal atomic confirmation', () => {
  it('uses the preflight and keeps persistence in the authoritative adapter transaction', async () => {
    const harness = makeHarness('created');

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-member',
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.calls.generate).toHaveBeenCalledTimes(1);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sourceId: 'proposal-member' }),
      NETWORK_ID,
    );
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      userId: USER_ID,
      scopeType: 'network',
      scopeId: NETWORK_ID,
    });
    expect(harness.calls.questionerEnqueue).toHaveBeenCalledWith({
      mode: 'intent',
      userId: USER_ID,
      sourceType: 'intent',
      sourceId: INTENT_ID,
      scopeType: 'network',
      scopeId: NETWORK_ID,
      context: {
        intentId: INTENT_ID,
        payload: 'Find climate founders',
        userContext: 'Climate founder operator',
      },
    });
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('denies a clear non-member before embedding or transaction side effects', async () => {
    const harness = makeHarness('created', false, false);

    await expect(harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-non-member',
      NETWORK_ID,
    )).rejects.toBeInstanceOf(IntentNetworkMembershipError);

    expect(harness.calls.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.questionerEnqueue).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('maps an authoritative membership race without queue or event side effects', async () => {
    const harness = makeHarness('membership_required');

    await expect(harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-stale',
      NETWORK_ID,
    )).rejects.toBeInstanceOf(IntentNetworkMembershipError);

    expect(harness.calls.isNetworkMember).toHaveBeenCalledTimes(1);
    expect(harness.calls.generate).toHaveBeenCalledTimes(1);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.questionerEnqueue).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('preserves no-network proposal success through the same atomic operation', async () => {
    const harness = makeHarness('created');

    await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-global',
    );

    expect(harness.calls.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'proposal-global' }),
      undefined,
    );
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({ intentId: INTENT_ID, userId: USER_ID });
    expect(harness.calls.questionerEnqueue).toHaveBeenCalledWith({
      mode: 'intent',
      userId: USER_ID,
      sourceType: 'intent',
      sourceId: INTENT_ID,
      context: {
        intentId: INTENT_ID,
        payload: 'Find climate founders',
        userContext: 'Climate founder operator',
      },
    });
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('returns a committed replay before embedding or transaction side effects', async () => {
    const harness = makeHarness('created', true);

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-committed-replay',
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.getIntentBySourceId).toHaveBeenCalledWith('proposal-committed-replay', USER_ID);
    expect(harness.calls.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({ intentId: INTENT_ID, userId: USER_ID });
    expect(harness.calls.questionerEnqueue).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('makes a persisted confirmation whose admission enqueue fails observable and retryable', async () => {
    const harness = makeHarness('created');
    harness.calls.addGenerateHydeJob.mockImplementation(async () => {
      throw new Error('redis unavailable');
    });

    await expect(harness.service.createFromProposal(USER_ID, 'Find climate founders', 'proposal-enqueue-failed'))
      .rejects.toBeInstanceOf(IntentAdmissionEnqueueError);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('returns the transaction winner without duplicate queue or event side effects', async () => {
    const harness = makeHarness('existing');

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-replay',
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.questionerEnqueue).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('logs a refinement enqueue failure without rolling back the confirmed intent', async () => {
    const harness = makeHarness('created', false, true, true);

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-questioner-failure',
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.questionerEnqueue).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('lets one concurrent winner enqueue and emit while both calls return the same ID', async () => {
    let claimed = false;
    const confirmProposalIntent = mock(async () => {
      if (!claimed) {
        claimed = true;
        return { kind: 'created' as const, intent: createdIntent() };
      }
      return { kind: 'existing' as const, intent: { id: INTENT_ID, archivedAt: null } };
    });
    const addGenerateHydeJob = mock(async () => 'job-id');
    const emitProposalCreated = mock(() => {});
    const getIntentBySourceId = mock(async () => null);
    const isNetworkMember = mock(async () => true);
    const service = new IntentService({
      adapter: {
        getIntentBySourceId,
        isNetworkMember,
        confirmProposalIntent,
      } as unknown as IntentDatabaseAdapter,
      embedder: { generate: mock(async () => [0.5, 0.5]) } as unknown as EmbedderAdapter,
      proposalQueue: { addGenerateHydeJob } as never,
      emitProposalCreated,
    });

    const results = await Promise.all([
      service.createFromProposal(USER_ID, 'Find climate founders', 'proposal-concurrent', NETWORK_ID),
      service.createFromProposal(USER_ID, 'Find climate founders', 'proposal-concurrent', NETWORK_ID),
    ]);

    expect(results.map((result) => result.id)).toEqual([INTENT_ID, INTENT_ID]);
    expect(getIntentBySourceId).toHaveBeenCalledTimes(2);
    expect(isNetworkMember).toHaveBeenCalledTimes(2);
    expect(confirmProposalIntent).toHaveBeenCalledTimes(2);
    expect(addGenerateHydeJob).toHaveBeenCalledTimes(1);
    expect(emitProposalCreated).toHaveBeenCalledTimes(1);
    expect(emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });
});
