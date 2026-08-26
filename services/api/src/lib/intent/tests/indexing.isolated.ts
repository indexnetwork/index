/**
 * Unit tests for IntentIndexing. Use injected deps to avoid Redis/DB.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, mock, afterAll, afterEach } from 'bun:test';

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class ChatDatabaseAdapter {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
  embedderAdapter: {},
}));
mock.module('../../opportunity/discovery', () => ({
  intentDiscovery: { addJob: async () => ({ id: '1' }) },
}));
let mockBuildProfileFromUser = async (_userId: string) => null as null | { identity: { name: string; bio: string; location: string } };
mock.module('../../adapters/database.shared', () => ({
  buildProfileFromUser: (userId: string) => mockBuildProfileFromUser(userId),
}));
afterEach(() => {
  mockBuildProfileFromUser = async () => null;
});

afterAll(() => {
  mock.restore();
});

import type { IntentJobPayload, IntentIndexingDatabase } from '../indexing';
import { DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD } from '@indexnetwork/protocol';

/** Test database shape retaining the pre-atomic assignment spy for focused expectations. */
type IntentIndexingTestDatabase = Partial<IntentIndexingDatabase> & {
  getUserIndexIds?: (userId: string) => Promise<string[]>;
  assignIntentToNetwork?: (
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: Parameters<IntentIndexingDatabase['assignIntentToNetworkIfMember']>[4],
  ) => Promise<void>;
};
const { IntentIndexing } = await import('../indexing');

/** Cast a plain object to IntentIndexingDatabase for tests and provide assignment-policy defaults. */
const asIntentDb = (db: IntentIndexingTestDatabase): IntentIndexingDatabase => ({
  getIntentForIndexing: async () => null,
  getAssignmentNetworkMembershipsForUser: async (userId: string) => {
    if (db.getAssignmentNetworkIdsForUser) {
      const networkIds = await db.getAssignmentNetworkIdsForUser(userId);
      return networkIds.map((networkId) => ({ networkId, isPersonal: false }));
    }
    const networkIds = await db.getUserIndexIds?.(userId) ?? [];
    return networkIds.map((networkId) => ({ networkId, isPersonal: false }));
  },
  getAssignmentNetworkIdsForUser: async (userId: string) => db.getUserIndexIds?.(userId) ?? [],
  getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
  assignIntentToNetworkIfMember: async (_userId, intentId, networkId, relevancyScore, assignmentMetadata) => {
    await db.assignIntentToNetwork?.(intentId, networkId, relevancyScore, assignmentMetadata);
    return { kind: 'assigned' };
  },
  deleteHydeDocumentsForSource: async () => 0,
  getHydeDocumentsForSource: async () => [],
  getNetworkIdsForIntent: async () => [],
  getProfile: async () => null,
  getActiveIntents: async () => [],
  ...db,
} as IntentIndexingDatabase);

describe('IntentIndexing', () => {
  describe('constructor', () => {
    it('uses provided database when deps given', async () => {
      const getIntentForIndexing = mock(async () => null as unknown as Awaited<ReturnType<IntentIndexingDatabase['getIntentForIndexing']>>);
      const db = {
        getIntentForIndexing,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db) });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(getIntentForIndexing).toHaveBeenCalledWith('i1');
    });
  });

  describe('addNetworkReconcileForUser', () => {
    it('reconciles each active intent for the joined network', async () => {
      const getActiveIntents = mock(async () => [
        { id: 'i1', payload: 'p1', summary: null, createdAt: new Date() },
        { id: 'i2', payload: 'p2', summary: null, createdAt: new Date() },
      ]);
      const queue = new IntentIndexing({ database: asIntentDb({ getActiveIntents } as Partial<IntentIndexingDatabase>) });
      const count = await queue.addNetworkReconcileForUser('u1', 'net-1');
      expect(count).toBe(2);
      expect(getActiveIntents).toHaveBeenCalledWith('u1');
    });
  });

  describe('processJob', () => {
    it('unknown job name logs warning and does not throw', async () => {
      const queue = new IntentIndexing();
      await expect(queue.processJob('unknown_job', { intentId: 'i1', userId: 'u1' })).resolves.toBeUndefined();
    });

    it('generate_hyde: intent not found skips and logs', async () => {
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<IntentIndexingDatabase['getIntentForIndexing']>>,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db) });
      await queue.processJob('generate_hyde', { intentId: 'missing', userId: 'u1' });
      // No throw, handler exits early
    });

    it('generate_hyde: paused intent skips before assignment, HyDE, and discovery', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => ({
          id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null,
          status: 'PAUSED' as const, archivedAt: null,
        }),
        getUserIndexIds: async () => ['idx1'],
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({
        database: asIntentDb(db),
        invokeHyde,
        addOpportunityJob,
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(assignIntentToNetwork).not.toHaveBeenCalled();
      expect(invokeHyde).not.toHaveBeenCalled();
      expect(addOpportunityJob).not.toHaveBeenCalled();
    });

    it('generate_hyde: assigns first, generates HyDE, then enqueues discovery exactly once', async () => {
      const sequence: string[] = [];
      const invokeHyde = mock(async () => { sequence.push('hyde'); });
      const addOpportunityJob = mock(async () => { sequence.push('discovery'); return {}; });
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build a SaaS', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['idx1'],
        assignIntentToNetwork: async () => { sequence.push('assignment'); },
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({
        database: asIntentDb(db),
        invokeHyde,
        addOpportunityJob,
        getUserContextText: async () => '',
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceText: 'Build a SaaS',
          sourceType: 'intent',
          sourceId: 'i1',
          forceRegenerate: true,
        })
      );
      expect(addOpportunityJob).toHaveBeenCalledTimes(1);
      expect(addOpportunityJob).toHaveBeenCalledWith({ intentId: 'i1', userId: 'u1' });
      expect(sequence).toEqual(['assignment', 'hyde', 'discovery']);
    });

    it('generate_hyde: builds profileContext from the users row (name/bio/location) + active intents', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      mockBuildProfileFromUser = async () => ({
        identity: { name: 'Dana', bio: 'Builds agent tooling in Berlin.', location: 'Berlin' },
      });
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Find collaborators', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['idx1'],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
        getActiveIntents: async () => [{ id: 'i9', payload: 'Looking for a cofounder' }],
      };
      const queue = new IntentIndexing({
        database: asIntentDb(db as Partial<IntentIndexingDatabase>),
        invokeHyde,
        addOpportunityJob,
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      const passed = invokeHyde.mock.calls[0][0] as { profileContext?: string };
      // Identity lines (name/bio/location) from the users row...
      expect(passed.profileContext).toContain('Dana');
      expect(passed.profileContext).toContain('Builds agent tooling in Berlin.');
      expect(passed.profileContext).toContain('Berlin');
      // ...alongside the active-intents block.
      expect(passed.profileContext).toContain('Active intents:');
      expect(passed.profileContext).toContain('Looking for a cofounder');
    });

    it('generate_hyde: getUserIndexIds throws is caught and logged', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => {
          throw new Error('DB error');
        },
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalled();
    });

    it('generate_hyde: assignIntentToNetwork throws for one index is caught', async () => {
      let callCount = 0;
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => ['idx1', 'idx2'],
        assignIntentToNetwork: async () => {
          callCount++;
          if (callCount === 1) throw new Error('assign failed');
        },
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalled();
    });

    it('generate_hyde: discovery failure rejects after HyDE', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => {
        throw new Error('discovery failed');
      });
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await expect(queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('discovery failed');
      expect(invokeHyde).toHaveBeenCalled();
    });

    it('generate_hyde: HyDE failure rejects before discovery', async () => {
      const addOpportunityJob = mock(async () => ({}));
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeHyde: async () => { throw new Error('hyde unavailable'); },
        addOpportunityJob,
      });
      await expect(queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' }))
        .rejects.toThrow('hyde unavailable');
      expect(addOpportunityJob).not.toHaveBeenCalled();
    });

    it('generate_hyde: network scope assigns focused plus personal but discovers focused only', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const getAssignmentNetworkMembershipsForUser = mock(async () => [
        { networkId: 'scope-net', isPersonal: false },
        { networkId: 'personal-net', isPersonal: true },
        { networkId: 'other-net', isPersonal: false },
      ]);
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getAssignmentNetworkMembershipsForUser,
        getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1', scopeType: 'network', scopeId: 'scope-net' });

      expect(getAssignmentNetworkMembershipsForUser).toHaveBeenCalledWith('u1');
      expect(assignIntentToNetwork.mock.calls.map((c) => c[1])).toEqual(['scope-net', 'personal-net']);
      expect(invokeHyde).toHaveBeenCalled();
      expect(addOpportunityJob).toHaveBeenCalledWith({ intentId: 'i1', userId: 'u1', networkIds: ['scope-net'] });
    });

    it('generate_hyde: global assignment uses all membership networks and persists metadata', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build AI tools', userId: 'u1', sourceType: 'discovery_form', sourceId: 'u1' }),
        getAssignmentNetworkIdsForUser: async () => ['n1', 'n2'],
        getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });

      expect(assignIntentToNetwork.mock.calls.map((c) => c[1]).sort()).toEqual(['n1', 'n2']);
      const metadata = assignIntentToNetwork.mock.calls[0][3];
      expect(metadata).toMatchObject({ resourceType: 'intent', mode: 'automatic', scope: 'global', assigned: true, finalScore: 1 });
    });

    it('generate_hyde: prompted networks use injected evaluator and unified threshold', async () => {
      const assignIntentToNetwork = mock(async () => {});
      const evaluateIntentAssignment = mock(async () => ({ indexScore: 0.8, memberScore: 0.6, reasoning: 'Weighted match' }));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build AI tools', userId: 'u1', sourceType: null, sourceId: null }),
        getAssignmentNetworkIdsForUser: async () => ['n1'],
        getNetworkAssignmentContext: async () => ({ networkId: 'n1', indexPrompt: 'AI founders', memberPrompt: 'developer tools' }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({
        database: asIntentDb(db),
        invokeHyde: mock(async () => {}),
        addOpportunityJob: mock(async () => ({})),
        evaluateIntentAssignment,
      });

      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });

      expect(evaluateIntentAssignment).toHaveBeenCalled();
      expect(assignIntentToNetwork).toHaveBeenCalledWith('i1', 'n1', 0.72, expect.objectContaining({ finalScore: 0.72, promptPresence: 'both' }));
    });

    it('generate_hyde: a prompted below-threshold evaluation remains an intentional zero assignment', async () => {
      const assignIntentToNetwork = mock(async () => {});
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getAssignmentNetworkIdsForUser: async () => ['n1'],
          getNetworkAssignmentContext: async () => ({ networkId: 'n1', indexPrompt: 'Climate', memberPrompt: 'Operators' }),
          assignIntentToNetwork,
        }),
        invokeHyde: async () => {},
        addOpportunityJob: async () => {},
        evaluateIntentAssignment: async () => ({ indexScore: 0.1, memberScore: 0.1, reasoning: 'Not relevant' }),
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(assignIntentToNetwork).not.toHaveBeenCalled();
    });

    describe('network assignment domain invariants', () => {
      it('evaluates all user memberships in global scope and stores assignment metadata', async () => {
        const assignIntentToNetwork = mock(async () => {});
        const evaluateIntentAssignment = mock(async () => ({
          indexScore: 0.86,
          memberScore: 0.82,
          reasoning: 'Intent matches network and member prompts.',
        }));
        const getAssignmentNetworkIdsForUser = mock(async () => ['net-a', 'net-b']);
        const getNetworkAssignmentContext = mock(async (networkId: string) => ({
          networkId,
          indexPrompt: `Network prompt for ${networkId}`,
          memberPrompt: `Member prompt for ${networkId}`,
        }));
        const db = {
          getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
          getAssignmentNetworkIdsForUser,
          getNetworkAssignmentContext,
          assignIntentToNetwork,
          deleteHydeDocumentsForSource: async () => 0,
        };
        const queue = new IntentIndexing({
          database: asIntentDb(db),
          invokeHyde: mock(async () => {}),
          addOpportunityJob: mock(async () => ({})),
          evaluateIntentAssignment,
        });

        await queue.processJob('generate_hyde', { intentId: 'intent-1', userId: 'user-1' });

        expect(getAssignmentNetworkIdsForUser).toHaveBeenCalledWith('user-1');
        expect(assignIntentToNetwork.mock.calls.map((call) => call[1]).sort()).toEqual(['net-a', 'net-b']);
        for (const call of assignIntentToNetwork.mock.calls) {
          expect(call[3]).toEqual(expect.objectContaining({
            resourceType: 'intent',
            mode: 'automatic',
            scope: 'global',
            policy: 'unified-threshold-v1',
            threshold: DEFAULT_NETWORK_ASSIGNMENT_THRESHOLD,
            assigned: true,
          }));
        }
      });

      it('limits network-scoped assignment to the focused network plus personal networks', async () => {
        const getNetworkAssignmentContext = mock(async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }));
        const assignIntentToNetwork = mock(async () => {});
        const db = {
          getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
          getAssignmentNetworkMembershipsForUser: mock(async () => [
            { networkId: 'net-a', isPersonal: false },
            { networkId: 'net-b', isPersonal: false },
            { networkId: 'personal-net', isPersonal: true },
          ]),
          getNetworkAssignmentContext,
          assignIntentToNetwork,
          deleteHydeDocumentsForSource: async () => 0,
        };
        const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde: mock(async () => {}), addOpportunityJob: mock(async () => ({})) });

        await queue.processJob('generate_hyde', { intentId: 'intent-1', userId: 'user-1', scopeType: 'network', scopeId: 'net-b' });

        expect(getNetworkAssignmentContext).toHaveBeenCalledTimes(2);
        expect(getNetworkAssignmentContext).toHaveBeenCalledWith('net-b', 'user-1');
        expect(getNetworkAssignmentContext).toHaveBeenCalledWith('personal-net', 'user-1');
        expect(assignIntentToNetwork.mock.calls.map((call) => call[1])).toEqual(['net-b', 'personal-net']);
      });

      it('skips assignment fail-closed when membership context disappears', async () => {
        const assignIntentToNetwork = mock(async () => {});
        const evaluateIntentAssignment = mock(async () => ({
          indexScore: 0.9,
          memberScore: 0.9,
          reasoning: 'Would match if context existed.',
        }));
        const db = {
          getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
          getAssignmentNetworkIdsForUser: mock(async () => ['net-a', 'net-b']),
          getNetworkAssignmentContext: mock(async (networkId: string) => (
            networkId === 'net-a'
              ? { networkId, indexPrompt: null, memberPrompt: null }
              : null
          )),
          assignIntentToNetwork,
          deleteHydeDocumentsForSource: async () => 0,
        };
        const queue = new IntentIndexing({
          database: asIntentDb(db),
          invokeHyde: mock(async () => {}),
          addOpportunityJob: mock(async () => ({})),
          evaluateIntentAssignment,
        });

        await queue.processJob('generate_hyde', { intentId: 'intent-1', userId: 'user-1' });

        expect(assignIntentToNetwork.mock.calls.map((call) => call[1])).toEqual(['net-a']);
        expect(evaluateIntentAssignment).not.toHaveBeenCalled();
      });

      it('fails closed when final assignment authority reports membership_required', async () => {
        const assignIntentToNetwork = mock(async () => {});
        const assignIntentToNetworkIfMember = mock(async () => ({ kind: 'membership_required' as const }));
        const addOpportunityJob = mock(async () => ({}));
        const getAssignmentNetworkMembershipsForUser = mock()
          .mockResolvedValueOnce([{ networkId: 'scope-net', isPersonal: false }])
          .mockResolvedValueOnce([]);
        const db = {
          getIntentForIndexing: async () => ({ id: 'intent-1', payload: 'Build protocol tools', userId: 'user-1', sourceType: null, sourceId: null }),
          getAssignmentNetworkMembershipsForUser,
          getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
          assignIntentToNetwork,
          assignIntentToNetworkIfMember,
          deleteHydeDocumentsForSource: async () => 0,
        };
        const queue = new IntentIndexing({
          database: asIntentDb(db),
          invokeHyde: mock(async () => {}),
          addOpportunityJob,
        });

        await queue.processJob('generate_hyde', {
          intentId: 'intent-1',
          userId: 'user-1',
          scopeType: 'network',
          scopeId: 'scope-net',
        });

        expect(assignIntentToNetworkIfMember).toHaveBeenCalledTimes(1);
        expect(assignIntentToNetwork).not.toHaveBeenCalled();
        expect(addOpportunityJob).toHaveBeenCalledWith({
          intentId: 'intent-1',
          userId: 'user-1',
          networkIds: [],
        });
      });
    });

    it('reconcile_intent_networks: assigns networks with no HyDE or opportunity side effects', async () => {
      const invokeHyde = mock(async () => {});
      const addOpportunityJob = mock(async () => ({}));
      const assignIntentToNetwork = mock(async () => {});
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'Build AI tools', userId: 'u1', sourceType: null, sourceId: null }),
        getAssignmentNetworkIdsForUser: async () => ['n1', 'n2'],
        getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db), invokeHyde, addOpportunityJob });
      await queue.processJob('reconcile_intent_networks', { intentId: 'i1', userId: 'u1' });

      expect(assignIntentToNetwork.mock.calls.map((c) => c[1]).sort()).toEqual(['n1', 'n2']);
      // Pure assignment: reconcile must never regenerate HyDE or trigger discovery.
      expect(invokeHyde).not.toHaveBeenCalled();
      expect(addOpportunityJob).not.toHaveBeenCalled();
      expect(assignIntentToNetwork.mock.calls[0][3]).toMatchObject({ source: 'intent-reconcile-queue', assigned: true });
    });

    it('reconcile_orphaned_intent: re-admits missing artifacts in normal assignment → HyDE → discovery order', async () => {
      const sequence: string[] = [];
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getAssignmentNetworkIdsForUser: async () => ['n1'],
          getNetworkIdsForIntent: async () => [],
          getHydeDocumentsForSource: async () => [],
          assignIntentToNetwork: async () => { sequence.push('assignment'); },
        }),
        invokeHyde: async () => { sequence.push('hyde'); },
        addOpportunityJob: async () => { sequence.push('discovery'); },
      });
      await queue.processJob('reconcile_orphaned_intent', { intentId: 'i1', userId: 'u1' });
      expect(sequence).toEqual(['assignment', 'hyde', 'discovery']);
    });

    it('reconcile_orphaned_intent: skips paused intents before assignment or regeneration', async () => {
      const invokeHyde = mock(async () => {});
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null, status: 'PAUSED', archivedAt: null }),
        }),
        invokeHyde,
      });
      await queue.processJob('reconcile_orphaned_intent', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).not.toHaveBeenCalled();
    });

    it('reconcile_orphaned_intent: re-admits when an old assignment is no longer an active membership', async () => {
      const invokeHyde = mock(async () => {});
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
          getNetworkIdsForIntent: async () => ['former-network'],
          getHydeDocumentsForSource: async () => [{ id: 'hyde-1' }] as never,
          getAssignmentNetworkMembershipsForUser: async () => [],
        }),
        invokeHyde,
        addOpportunityJob: async () => {},
      });
      await queue.processJob('reconcile_orphaned_intent', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenCalledTimes(1);
    });

    it('generate_hyde: material re-admission forces HyDE regeneration after a payload update', async () => {
      let payload = 'First material payload';
      const invokeHyde = mock(async () => {});
      const queue = new IntentIndexing({
        database: asIntentDb({
          getIntentForIndexing: async () => ({ id: 'i1', payload, userId: 'u1', sourceType: null, sourceId: null }),
        }),
        invokeHyde,
        addOpportunityJob: async () => {},
      });
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      payload = 'Updated material payload';
      await queue.processJob('generate_hyde', { intentId: 'i1', userId: 'u1' });
      expect(invokeHyde).toHaveBeenNthCalledWith(1, expect.objectContaining({ sourceText: 'First material payload', forceRegenerate: true }));
      expect(invokeHyde).toHaveBeenNthCalledWith(2, expect.objectContaining({ sourceText: 'Updated material payload', forceRegenerate: true }));
    });

    it('reconcile_intent_networks: networkScopeId restricts evaluation to that network', async () => {
      const assignIntentToNetwork = mock(async () => {});
      const getNetworkAssignmentContext = mock(async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }));
      const db = {
        getIntentForIndexing: async () => ({ id: 'i1', payload: 'P', userId: 'u1', sourceType: null, sourceId: null }),
        getAssignmentNetworkIdsForUser: async () => ['net-a', 'net-b'],
        getNetworkAssignmentContext,
        assignIntentToNetwork,
        deleteHydeDocumentsForSource: async () => 0,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db) });
      await queue.processJob('reconcile_intent_networks', { intentId: 'i1', userId: 'u1', networkScopeId: 'net-b' });

      expect(getNetworkAssignmentContext).toHaveBeenCalledTimes(1);
      expect(assignIntentToNetwork.mock.calls.map((c) => c[1])).toEqual(['net-b']);
    });

    it('delete_hyde: calls deleteHydeDocumentsForSource', async () => {
      const deleteHydeDocumentsForSource = mock(async () => 0);
      const db = {
        getIntentForIndexing: async () => null as unknown as Awaited<ReturnType<IntentIndexingDatabase['getIntentForIndexing']>>,
        getUserIndexIds: async () => [] as string[],
        assignIntentToNetwork: async () => {},
        deleteHydeDocumentsForSource,
      };
      const queue = new IntentIndexing({ database: asIntentDb(db) });
      await queue.processJob('delete_hyde', { intentId: 'i1' });
      expect(deleteHydeDocumentsForSource).toHaveBeenCalledWith('intent', 'i1');
    });
  });
});
