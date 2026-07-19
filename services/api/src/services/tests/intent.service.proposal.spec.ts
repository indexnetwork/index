import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock } from 'bun:test';

import { IntentDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { IntentNetworkMembershipError, IntentService } from '../intent.service';

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

function makeHarness(options: {
  existing?: boolean;
  member?: boolean;
  memberAtCommit?: boolean;
} = {}) {
  const existing = options.existing ? createdIntent() : null;
  const getIntentBySourceId = mock(async () => existing);
  const isNetworkMember = mock(async () => options.member ?? false);
  const createIntent = mock(async () => createdIntent());
  const createIntentForNetworkMember = mock(async () =>
    options.memberAtCommit === false ? null : createdIntent()
  );
  const generate = mock(async () => [0.5, 0.5]);
  const addGenerateHydeJob = mock(async () => 'job-id');
  const emitProposalCreated = mock(() => {});

  const service = new IntentService({
    adapter: {
      getIntentBySourceId,
      isNetworkMember,
      createIntent,
      createIntentForNetworkMember,
    } as unknown as IntentDatabaseAdapter,
    embedder: { generate } as unknown as EmbedderAdapter,
    proposalQueue: { addGenerateHydeJob } as never,
    emitProposalCreated,
  });

  return {
    service,
    calls: {
      getIntentBySourceId,
      isNetworkMember,
      createIntent,
      createIntentForNetworkMember,
      generate,
      addGenerateHydeJob,
      emitProposalCreated,
    },
  };
}

describe('IntentService.createFromProposal network authorization', () => {
  it('validates a current member before embedding and atomically creates the assignment', async () => {
    const harness = makeHarness({ member: true });

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-member',
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.calls.generate).toHaveBeenCalledTimes(1);
    expect(harness.calls.createIntent).not.toHaveBeenCalled();
    expect(harness.calls.createIntentForNetworkMember).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, sourceId: 'proposal-member' }),
      NETWORK_ID,
    );
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('rejects a non-member or stale membership before embedding and all persistence side effects', async () => {
    const harness = makeHarness({ member: false });

    await expect(harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-stale',
      NETWORK_ID,
    )).rejects.toBeInstanceOf(IntentNetworkMembershipError);

    expect(harness.calls.isNetworkMember).toHaveBeenCalledWith(NETWORK_ID, USER_ID);
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.createIntent).not.toHaveBeenCalled();
    expect(harness.calls.createIntentForNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('fails closed when membership is revoked between preflight and the locked transaction', async () => {
    const harness = makeHarness({ member: true, memberAtCommit: false });

    await expect(harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-race',
      NETWORK_ID,
    )).rejects.toBeInstanceOf(IntentNetworkMembershipError);

    expect(harness.calls.generate).toHaveBeenCalledTimes(1);
    expect(harness.calls.createIntentForNetworkMember).toHaveBeenCalledTimes(1);
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('preserves no-network proposal success without a membership lookup', async () => {
    const harness = makeHarness();

    await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-global',
    );

    expect(harness.calls.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.createIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.createIntentForNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({ intentId: INTENT_ID, userId: USER_ID });
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('keeps idempotent replay ahead of membership validation and all side effects', async () => {
    const harness = makeHarness({ existing: true, member: false });

    const result = await harness.service.createFromProposal(
      USER_ID,
      'Find climate founders',
      'proposal-replay',
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.createIntent).not.toHaveBeenCalled();
    expect(harness.calls.createIntentForNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });
});
