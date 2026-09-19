import { describe, test, expect, mock, spyOn } from 'bun:test';
import { CandidateDiscovery, INTENT_MATCH_REASONING } from '@indexnetwork/discovery';
import type { CandidateDiscoveryData, IntentPairEvaluator } from '@indexnetwork/discovery';

import { resolveDiscoveryNetworkScope } from '../../../index.js';

const owner = 'a0000000-0000-4000-8000-000000000001';
const bob = 'b0000000-0000-4000-8000-000000000002';
const sourcePayload = 'Looking for a technical co-founder';
const bobPayload = 'I want to build a startup as a technical co-founder';

function createMockDiscovery(deps: {
  getUserNetworkIds?: () => Promise<string[]>;
  getActiveIntents?: CandidateDiscoveryData['getActiveIntents'];
  getNetworkIdsForIntent?: CandidateDiscoveryData['getNetworkIdsForIntent'];
  getActiveNetworkMembershipPairs?: CandidateDiscoveryData['getActiveNetworkMembershipPairs'];
} = {}) {
  const mockDb: CandidateDiscoveryData = {
    getNetworkMemberships: async () => (await (deps.getUserNetworkIds?.() ?? Promise.resolve(['idx-1']))).map((networkId) => ({ networkId })),
    getActiveIntents: deps.getActiveIntents ?? (async (id: string) => id === owner
      ? [{ id: 'intent-1', payload: sourcePayload }]
      : id === bob ? [{ id: 'intent-bob', payload: bobPayload }] : []),
    getProfile: async () => null,
    getNetworkIdsForIntent: deps.getNetworkIdsForIntent ?? (async () => deps.getUserNetworkIds?.() ?? ['idx-1']),
    getActiveNetworkMembershipPairs: deps.getActiveNetworkMembershipPairs ?? (async (pairs) => pairs),
    listIntentCandidates: async () => [{ id: 'intent-bob', userId: bob, networkId: 'idx-1', payload: bobPayload }],
    getDiscoveryScope: async (input) => resolveDiscoveryNetworkScope({
      userNetworkIds: input.userNetworks,
      networkScope: input.networkScope,
      ownsRequestedNetwork: false,
      triggerIntentNetworkIds: await mockDb.getNetworkIdsForIntent(input.triggerIntentId!),
    }),
    getNetworkContexts: async (ids) => Object.fromEntries(ids.map((id) => [id, `## ${id}`])),
  };

  const mockEvaluator: IntentPairEvaluator = {
    evaluate: async () => 0.9,
  };
  const discovery = new CandidateDiscovery({
    database: mockDb,
    evaluator: mockEvaluator,
  });

  return { discovery, mockDb, mockEvaluator };
}

describe('CandidateDiscovery', () => {
  test('when user has no network memberships, discovery fails closed', async () => {
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery({
      getUserNetworkIds: () => Promise.resolve([]),
    });
    const listSpy = spyOn(mockDb, 'listIntentCandidates');
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('outside authorized scope');

    expect(listSpy).not.toHaveBeenCalled();
    expect(evaluatorSpy).not.toHaveBeenCalled();
  });

  test('when user has no active intents, discovery fails closed', async () => {
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery({
      getActiveIntents: () => Promise.resolve([]),
    });
    const listSpy = spyOn(mockDb, 'listIntentCandidates');
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('Trigger intent is not available for discovery.');

    expect(listSpy).not.toHaveBeenCalled();
    expect(evaluatorSpy).not.toHaveBeenCalled();
  });

  test('when trigger intent is not an active intent owned by user, fails closed', async () => {
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery();
    const listSpy = spyOn(mockDb, 'listIntentCandidates');
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'foreign-intent',
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('Trigger intent is not available for discovery.');

    expect(listSpy).not.toHaveBeenCalled();
    expect(evaluatorSpy).not.toHaveBeenCalled();
  });

  test('when requested network is outside authorized scope, fails closed', async () => {
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery({
      getUserNetworkIds: () => Promise.resolve(['idx-1']),
    });
    const listSpy = spyOn(mockDb, 'listIntentCandidates');
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        networkIds: ['idx-unauthorized'],
      }),
    ).rejects.toThrow('outside authorized scope');

    expect(listSpy).not.toHaveBeenCalled();
    expect(evaluatorSpy).not.toHaveBeenCalled();
  });

  test('removes inactive candidate pairs before returning candidates', async () => {
    const getActiveNetworkMembershipPairs = mock(async (
      pairs: Array<{ userId: string; networkId: string }>,
    ) => pairs.filter((pair) => pair.userId === owner)).mockImplementationOnce(async (pairs) => pairs);
    const { discovery, mockEvaluator } = createMockDiscovery({ getActiveNetworkMembershipPairs });
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate');

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      networkIds: ['idx-1'],
    });

    expect(getActiveNetworkMembershipPairs).toHaveBeenCalledTimes(2);
    expect(evaluatorSpy).toHaveBeenCalledTimes(1);
    expect(result.candidates).toEqual([]);
  });

  test('returns candidate evidence with hydrated context and payload', async () => {
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery();
    const listSpy = spyOn(mockDb, 'listIntentCandidates');
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate').mockResolvedValue(0.88);
    spyOn(mockDb, 'getProfile').mockResolvedValue({ identity: { name: 'Bob' } });

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      networkIds: ['idx-1'],
    });

    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith(
      { excludeUserId: owner, networkIds: ['idx-1'] },
      { signal: expect.any(AbortSignal) },
    );
    expect(evaluatorSpy).toHaveBeenCalledTimes(1);
    expect(evaluatorSpy).toHaveBeenCalledWith(
      { intentA: sourcePayload, intentB: bobPayload, networkContext: '## idx-1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toMatchObject({ networkIds: ['idx-1'], sourcePayload });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateIntentId: 'intent-bob',
      candidateUserId: bob,
      networkId: 'idx-1',
      matchProbability: 0.88,
      reasoning: INTENT_MATCH_REASONING,
      candidatePayload: bobPayload,
      profile: { identity: { name: 'Bob' } },
      networkContext: '## idx-1',
    });
  });

  test('deduplicates per intent and network and ranks all scores without a cutoff', async () => {
    const charlie = 'c0000000-0000-4000-8000-000000000003';
    const { discovery, mockDb, mockEvaluator } = createMockDiscovery({
      getActiveIntents: async (id: string) => {
        if (id === owner) return [{ id: 'intent-1', payload: sourcePayload }];
        if (id === bob) return [{ id: 'intent-bob', payload: 'Building AI startup' }];
        if (id === charlie) return [{ id: 'intent-charlie', payload: 'Senior AI researcher' }];
        return [];
      },
    });

    spyOn(mockDb, 'listIntentCandidates').mockResolvedValue([
      { id: 'intent-bob', userId: bob, payload: 'Building AI startup', networkId: 'idx-1' },
      { id: 'intent-charlie', userId: charlie, payload: 'Senior AI researcher', networkId: 'idx-1' },
      { id: 'intent-bob', userId: bob, payload: 'Building AI startup', networkId: 'idx-1' },
    ]);
    const evaluatorSpy = spyOn(mockEvaluator, 'evaluate').mockImplementation(async ({ intentB }) =>
      intentB === 'Building AI startup' ? 0 : 0.75,
    );

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      networkIds: ['idx-1'],
    });

    expect(evaluatorSpy).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.candidateUserId).toBe(charlie);
    expect(result.candidates[0]!.matchProbability).toBe(0.75);
    expect(result.candidates[1]!.candidateUserId).toBe(bob);
    expect(result.candidates[1]!.matchProbability).toBe(0);
  });
});
