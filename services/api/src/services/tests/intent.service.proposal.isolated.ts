import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock } from 'bun:test';

mock.module('../../adapters/database.adapter', () => ({
  IntentDatabaseAdapter: class IntentDatabaseAdapter {},
  intentDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
}));
mock.module('../../adapters/intent-proposal.database.adapter', () => ({
  IntentProposalDatabaseAdapter: class IntentProposalDatabaseAdapter {},
  intentProposalDatabaseAdapter: {},
}));
mock.module('../../queues/intent.queue', () => ({
  intentQueue: { addGenerateHydeJob: async () => 'job-id' },
}));
mock.module('../../queues/questioner.queue', () => ({
  questionerEnqueueIfEnabled: () => undefined,
}));
mock.module('../../events/intent.event', () => ({
  IntentEvents: { onCreated: () => {} },
}));

const {
  IntentAdmissionEnqueueError,
  IntentNetworkMembershipError,
  IntentProposalConfirmationError,
  IntentService,
} = await import('../intent.service');

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NETWORK_ID = '22222222-2222-4222-8222-222222222222';
const INTENT_ID = '33333333-3333-4333-8333-333333333333';
const DESCRIPTION = 'Find climate founders';

const analysis = {
  verifierOutput: {
    reasoning: 'A directive with a concrete counterparty class.',
    classification: 'DIRECTIVE' as const,
    felicity_scores: { clarity: 91, authority: 83, sincerity: 88 },
    semantic_entropy: 0.24,
    referential_anchor: null,
    referential_breadth: 'moderate' as const,
    missing_selectional_constraints: [],
    specificity_warning: null,
    flags: [],
  },
  combinedScore: 83,
};

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    userId: USER_ID,
    description: DESCRIPTION,
    networkId: NETWORK_ID,
    analysis,
    status: 'pending' as const,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    consumedAt: null,
    consumedIntentId: null,
    ...overrides,
  };
}

function createdIntent() {
  return {
    id: INTENT_ID,
    userId: USER_ID,
    payload: DESCRIPTION,
    summary: null,
    isIncognito: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeHarness(options: {
  proposal?: ReturnType<typeof proposal> | null;
  confirmation?: 'created' | 'replay' | 'membership_required' | 'analysis_missing';
  isMember?: boolean;
} = {}) {
  const authoritativeProposal = options.proposal === undefined ? proposal() : options.proposal;
  const getProposalForOwner = mock(async () => authoritativeProposal);
  const rejectProposal = mock(async () => true);
  const getIntentBySourceId = mock(async () => (
    authoritativeProposal?.consumedIntentId
      ? { id: authoritativeProposal.consumedIntentId, archivedAt: null }
      : null
  ));
  const isNetworkMember = mock(async () => options.isMember ?? true);
  const confirmProposalIntent = mock(async () => {
    if (options.confirmation === 'replay') {
      return { kind: 'replay' as const, intent: { id: INTENT_ID, archivedAt: null } };
    }
    if (options.confirmation === 'membership_required') return { kind: 'membership_required' as const };
    if (options.confirmation === 'analysis_missing') return { kind: 'analysis_missing' as const };
    return { kind: 'created' as const, intent: createdIntent() };
  });
  const generate = mock(async () => [0.5, 0.5]);
  const getUserContext = mock(async () => ({ text: 'Climate founder operator' }));
  const addGenerateHydeJob = mock(async () => 'job-id');
  const emitProposalCreated = mock(() => {});

  const service = new IntentService({
    adapter: {
      getIntentBySourceId,
      isNetworkMember,
      confirmProposalIntent,
      getUserContext,
    } as never,
    proposalAdapter: {
      getProposalForOwner,
      rejectProposal,
    } as never,
    embedder: { generate } as never,
    proposalQueue: { addGenerateHydeJob } as never,
    emitProposalCreated,
  });

  return {
    service,
    calls: {
      getProposalForOwner,
      getIntentBySourceId,
      isNetworkMember,
      confirmProposalIntent,
      generate,
      addGenerateHydeJob,
      emitProposalCreated,
    },
  };
}

describe('IntentService.createFromProposal authoritative confirmation', () => {
  it('uses the authoritative description/network and leaves persistence to one atomic adapter call', async () => {
    const harness = makeHarness();
    const result = await harness.service.createFromProposal(
      USER_ID,
      DESCRIPTION,
      proposal().id,
      NETWORK_ID,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledWith({
      proposalId: proposal().id,
      userId: USER_ID,
      description: DESCRIPTION,
      networkId: NETWORK_ID,
      embedding: [0.5, 0.5],
    });
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledTimes(1);
  });

  it('preserves no-network proposal admission and refinement without inventing scope', async () => {
    const harness = makeHarness({ proposal: proposal({ networkId: null }) });

    const result = await harness.service.createFromProposal(
      USER_ID,
      DESCRIPTION,
      proposal().id,
    );

    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.isNetworkMember).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledWith({
      proposalId: proposal().id,
      userId: USER_ID,
      description: DESCRIPTION,
      embedding: [0.5, 0.5],
    });
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      userId: USER_ID,
    });
  });

  it('rejects a missing or foreign proposal before embedding', async () => {
    const harness = makeHarness({ proposal: null });
    await expect(harness.service.createFromProposal(
      USER_ID,
      DESCRIPTION,
      proposal().id,
      NETWORK_ID,
    )).rejects.toMatchObject({ code: 'proposal_not_found' });
    expect(harness.calls.generate).not.toHaveBeenCalled();
  });

  it('rejects description and network tampering before embedding', async () => {
    const harness = makeHarness();
    await expect(harness.service.createFromProposal(
      USER_ID,
      `${DESCRIPTION}!`,
      proposal().id,
      NETWORK_ID,
    )).rejects.toMatchObject({ code: 'proposal_payload_mismatch' });
    await expect(harness.service.createFromProposal(
      USER_ID,
      DESCRIPTION,
      proposal().id,
      undefined,
    )).rejects.toMatchObject({ code: 'proposal_payload_mismatch' });
    expect(harness.calls.generate).not.toHaveBeenCalled();
  });

  it('rejects expired, rejected/consumed, and analysis-free proposals', async () => {
    const expired = makeHarness({ proposal: proposal({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }) });
    await expect(expired.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toMatchObject({ code: 'proposal_expired' });

    const rejected = makeHarness({ proposal: proposal({ status: 'rejected' }) });
    await expect(rejected.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toMatchObject({ code: 'proposal_consumed' });

    const consumed = makeHarness({ proposal: proposal({ status: 'consumed' }) });
    await expect(consumed.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toMatchObject({ code: 'proposal_consumed' });

    const absentAnalysis = makeHarness({ proposal: proposal({ analysis: null }) });
    await expect(absentAnalysis.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toMatchObject({ code: 'proposal_analysis_missing' });
  });

  it('retries queue admission for a committed replay without embedding or event side effects', async () => {
    const harness = makeHarness({
      proposal: proposal({ status: 'consumed', consumedIntentId: INTENT_ID }),
    });
    const result = await harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID);
    expect(result.id).toBe(INTENT_ID);
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).not.toHaveBeenCalled();
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledWith({
      intentId: INTENT_ID,
      userId: USER_ID,
      scopeType: 'network',
      scopeId: NETWORK_ID,
    });
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('makes a persisted confirmation whose admission enqueue fails observable and retryable', async () => {
    const harness = makeHarness();
    harness.calls.addGenerateHydeJob.mockImplementation(async () => {
      throw new Error('redis unavailable');
    });

    await expect(harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toBeInstanceOf(IntentAdmissionEnqueueError);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('maps the authoritative membership race without queue or event side effects', async () => {
    const harness = makeHarness({ confirmation: 'membership_required' });
    await expect(harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toBeInstanceOf(IntentNetworkMembershipError);
    expect(harness.calls.confirmProposalIntent).toHaveBeenCalledTimes(1);
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('denies a clear non-member before embedding or transaction work', async () => {
    const harness = makeHarness({ isMember: false });
    await expect(harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toBeInstanceOf(IntentNetworkMembershipError);
    expect(harness.calls.generate).not.toHaveBeenCalled();
    expect(harness.calls.confirmProposalIntent).not.toHaveBeenCalled();
  });

  it('lets one concurrent winner own queue and event side effects', async () => {
    let calls = 0;
    const harness = makeHarness();
    harness.calls.confirmProposalIntent.mockImplementation(async () => {
      calls += 1;
      return calls === 1
        ? { kind: 'created' as const, intent: createdIntent() }
        : { kind: 'replay' as const, intent: { id: INTENT_ID, archivedAt: null } };
    });

    const results = await Promise.all([
      harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID),
      harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID),
    ]);
    expect(results.map((result) => result.id)).toEqual([INTENT_ID, INTENT_ID]);
    expect(harness.calls.addGenerateHydeJob).toHaveBeenCalledTimes(1);
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledTimes(1);
  });

  it('maps an analysis record invalidated during confirmation to a typed failure', async () => {
    const harness = makeHarness({ confirmation: 'analysis_missing' });
    await expect(harness.service.createFromProposal(USER_ID, DESCRIPTION, proposal().id, NETWORK_ID))
      .rejects.toBeInstanceOf(IntentProposalConfirmationError);
    expect(harness.calls.addGenerateHydeJob).not.toHaveBeenCalled();
  });
});
