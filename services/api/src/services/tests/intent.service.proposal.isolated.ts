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
mock.module('../../lib/intent/indexing', () => ({
  intentIndexing: { generateHyde: async () => undefined },
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
const PROPOSAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DESCRIPTION = 'Find climate founders';

/**
 * `IntentService.createFromProposal` is now a thin wrapper: it invokes the
 * intent graph's `confirm` action and maps the graph's `confirmResult.kind`
 * to the same public contract the controller already expects (a plain
 * `{ id }` on success, or one of the three typed errors). The graph's own
 * mechanics (proposal revision/re-verification, the atomic adapter
 * transaction, HyDE admission) are covered at the protocol layer
 * (`intent.graph.spec.ts`) and by IntentDatabaseAdapter's own integration
 * tests; this file only exercises the mapping.
 */
function makeHarness(confirmResult: Record<string, unknown> | undefined) {
  const emitProposalCreated = mock(() => {});
  const invoke = mock(async (input: Record<string, unknown>) => ({ confirmResult, __input: input }));
  const service = new IntentService({
    emitProposalCreated,
    intentGraph: { invoke } as never,
  });
  return { service, calls: { invoke, emitProposalCreated } };
}

describe('IntentService.createFromProposal', () => {
  it('invokes the graph with the confirm-route input shape', async () => {
    const harness = makeHarness({ kind: 'created', intentId: INTENT_ID });
    await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID);

    expect(harness.calls.invoke).toHaveBeenCalledWith(
      { userId: USER_ID, userProfile: '', proposalId: PROPOSAL_ID, description: DESCRIPTION, networkId: NETWORK_ID },
      { recursionLimit: 100 },
    );
  });

  it('omits networkId from the graph input when not provided', async () => {
    const harness = makeHarness({ kind: 'created', intentId: INTENT_ID });
    await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID);

    expect(harness.calls.invoke).toHaveBeenCalledWith(
      { userId: USER_ID, userProfile: '', proposalId: PROPOSAL_ID, description: DESCRIPTION },
      { recursionLimit: 100 },
    );
  });

  it('returns the intent id and emits onCreated for a fresh creation', async () => {
    const harness = makeHarness({ kind: 'created', intentId: INTENT_ID });
    const result = await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID);

    expect(result).toEqual({ id: INTENT_ID });
    expect(harness.calls.emitProposalCreated).toHaveBeenCalledWith(INTENT_ID, USER_ID);
  });

  it('returns the intent id for a replay without emitting onCreated', async () => {
    const harness = makeHarness({ kind: 'replay', intentId: INTENT_ID });
    const result = await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID);

    expect(result).toEqual({ id: INTENT_ID });
    expect(harness.calls.emitProposalCreated).not.toHaveBeenCalled();
  });

  it('maps membership_required to IntentNetworkMembershipError', async () => {
    const harness = makeHarness({ kind: 'membership_required', networkId: NETWORK_ID });
    const error = await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID).catch((e) => e);

    expect(error).toBeInstanceOf(IntentNetworkMembershipError);
    expect(error.networkId).toBe(NETWORK_ID);
  });

  it('maps admission_enqueue_failed to IntentAdmissionEnqueueError', async () => {
    const harness = makeHarness({ kind: 'admission_enqueue_failed', intentId: INTENT_ID });
    const error = await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID).catch((e) => e);

    expect(error).toBeInstanceOf(IntentAdmissionEnqueueError);
    expect(error.intentId).toBe(INTENT_ID);
  });

  const proposalErrorCases: Array<[string, string]> = [
    ['missing', 'proposal_not_found'],
    ['expired', 'proposal_expired'],
    ['consumed', 'proposal_consumed'],
    ['payload_mismatch', 'proposal_payload_mismatch'],
    ['analysis_missing', 'proposal_analysis_missing'],
    ['proposal_edit_rejected', 'proposal_edit_rejected'],
  ];
  for (const [kind, code] of proposalErrorCases) {
    it(`maps confirmResult.kind "${kind}" to IntentProposalConfirmationError(${code})`, async () => {
      const harness = makeHarness({ kind });
      const error = await harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID).catch((e) => e);

      expect(error).toBeInstanceOf(IntentProposalConfirmationError);
      expect(error.code).toBe(code);
    });
  }

  it('throws when the graph produces no confirmResult at all', async () => {
    const harness = makeHarness(undefined);
    await expect(harness.service.createFromProposal(USER_ID, DESCRIPTION, PROPOSAL_ID, NETWORK_ID))
      .rejects.toThrow('Intent graph confirm action produced no result');
  });
});
