/** Tests for IntentGraph. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { IntentGraphDatabase, ActiveIntent, CreatedIntent, ArchiveResult } from "../../../platform/database.js";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: (agent: string) => ({
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const prompt = String(messages.at(-1)?.content ?? "");
      if (agent === "intentInferrer") {
        if (prompt.includes("I feel like doing something maybe.")) return { intents: [] };
        if (prompt.includes("accessible React portfolio app")) {
          return {
            intents: [{
              type: "goal",
              description: "Build an accessible React portfolio app for frontend job applications in Berlin this quarter",
              reasoning: "The user states a bounded future commitment.",
              confidence: "high",
            }],
          };
        }
        if (prompt.includes("Update my TypeScript goal")) {
          return { intents: [{ type: "goal", description: "Learn TypeScript, including design patterns", reasoning: "Explicit update.", confidence: "high" }] };
        }
        if (prompt.includes("Rust")) {
          return { intents: [{ type: "goal", description: "Learn Rust programming language", reasoning: "Explicit goal.", confidence: "high" }] };
        }
        if (prompt.includes("open source")) {
          return { intents: [{ type: "goal", description: "Contribute to open source projects", reasoning: "Explicit goal.", confidence: "high" }] };
        }
        return { intents: [] };
      }
      if (agent === "intentVerifier") {
        return {
          reasoning: "A bounded future commitment with concrete outcome, domain, location, and timeframe.",
          classification: "COMMISSIVE",
          felicity_scores: { clarity: 90, authority: 85, sincerity: 90 },
          semantic_entropy: 0.1,
          referential_anchor: null,
          referential_breadth: "narrow",
          missing_selectional_constraints: [],
          specificity_warning: null,
          flags: [],
        };
      }
      if (agent === "intentReconciler") {
        const candidate = prompt.match(/- \[[A-Z]+\] "([^"]+)"/)?.[1];
        return {
          actions: candidate ? [{
            type: "create",
            payload: candidate,
            score: 85,
            reasoning: "Create a new bounded intent.",
            intentMode: "ATTRIBUTIVE",
            referentialAnchor: null,
            semanticEntropy: 0.1,
          }] : [],
        };
      }
      throw new Error(`Unexpected structured model agent: ${agent}`);
    },
  }),
}));

const { IntentGraphFactory } = await import("../../intents/graph/intent.graph.js");

afterAll(() => mock.restore());

/**
 * Mock database for testing the Intent Graph.
 * Stores intents in memory and provides basic CRUD operations.
 */
const createMockDatabase = (): IntentGraphDatabase => {
  const intents: CreatedIntent[] = [];
  let idCounter = 1;

  return {
    async getActiveIntents(userId: string): Promise<ActiveIntent[]> {
      return intents
        .filter(i => i.userId === userId)
        .map(i => ({
          id: i.id,
          payload: i.payload,
          summary: i.summary,
          createdAt: i.createdAt
        }));
    },
    async getIntentsInIndexForMember(userId: string, _indexNameOrId: string): Promise<ActiveIntent[]> {
      return intents
        .filter(i => i.userId === userId)
        .map(i => ({
          id: i.id,
          payload: i.payload,
          summary: i.summary,
          createdAt: i.createdAt
        }));
    },
    async getUser(_userId: string) {
      return { id: _userId, name: 'Test User', email: 'test@example.com', socials: [] };
    },
    async isNetworkMember(_indexId: string, _userId: string): Promise<boolean> {
      return true;
    },
    async getNetworkIntentsForMember(_indexId: string, _requestingUserId: string, _options?: { limit?: number; offset?: number }) {
      return intents.map(i => ({
        id: i.id,
        payload: i.payload,
        summary: i.summary,
        userId: i.userId,
        userName: 'Test User',
        createdAt: i.createdAt,
      }));
    },
    async getActiveIntentsAcrossIndexes(userId: string, _indexIds: string[]): Promise<ActiveIntent[]> {
      return intents
        .filter(i => i.userId === userId)
        .map(i => ({
          id: i.id,
          payload: i.payload,
          summary: i.summary,
          createdAt: i.createdAt,
        }));
    },
    async getUserContext(_userId: string) {
      return null;
    },
    async createIntent(data: { userId: string; payload: string; confidence: number; inferenceType: 'explicit' | 'implicit'; sourceType?: string }): Promise<CreatedIntent> {
      const newIntent: CreatedIntent = {
        id: `intent-${idCounter++}`,
        userId: data.userId,
        payload: data.payload,
        summary: null,
        isIncognito: false,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      intents.push(newIntent);
      return newIntent;
    },
    async updateIntent(intentId: string, data: { payload?: string }): Promise<CreatedIntent | null> {
      const intent = intents.find(i => i.id === intentId);
      if (!intent) return null;
      if (data.payload) intent.payload = data.payload;
      intent.updatedAt = new Date();
      return intent;
    },
    async archiveIntent(intentId: string): Promise<ArchiveResult> {
      const index = intents.findIndex(i => i.id === intentId);
      if (index === -1) {
        return { success: false, error: 'Intent not found' };
      }
      intents.splice(index, 1);
      return { success: true };
    },
    async assignIntentToNetwork(_intentId: string, _indexId: string): Promise<void> {
      // no-op for tests
    },
    async getPersonalIndexesForContact(_userId: string): Promise<{ networkId: string }[]> {
      return [];
    },
    async deleteIntentIndexAssociations(_intentId: string): Promise<void> {
      // no-op for tests
    },
    async expireOpportunitiesByIntentActor(_intentId: string): Promise<number> {
      return 0;
    },
  };
};

describe('IntentGraph - Basic Operations', () => {
  let graphRunner: any;
  let mockDatabase: IntentGraphDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    const factory = new IntentGraphFactory(mockDatabase);
    graphRunner = factory.createGraph();
  });

  it('should process a clear goal correctly', async () => {
    const inputState = {
      userId: "test-user-1",
      userProfile: "User is a Senior Developer named Alice. She likes generic coding.",
      inputContent: "I will build an accessible React portfolio app for frontend job applications in Berlin this quarter.",
    };

    const result = await graphRunner.invoke(inputState);

    console.log("Graph Result:", JSON.stringify(result, null, 2));

    // Expectations
    expect(result.inferredIntents.length).toBeGreaterThan(0);
    expect(result.verifiedIntents.length).toBeGreaterThan(0);
    expect(result.verifiedIntents[0]?.verification?.referential_breadth).toBe("narrow");
    expect(result.actions.length).toBeGreaterThan(0);

    const action = result.actions[0];
    expect(action.type).toBe("create");
    expect(action.payload).toContain("React");

    // Verify execution results
    expect(result.executionResults.length).toBeGreaterThan(0);
    expect(result.executionResults[0].success).toBe(true);
    expect(result.executionResults[0].actionType).toBe("create");
    expect(result.executionResults[0].intentId).toBeDefined();
  }, 60000);

  it('should ignore vague nonsense', async () => {
    const inputState = {
      userId: "test-user-2",
      userProfile: "User is a Senior Developer named Alice.",
      inputContent: "I feel like doing something maybe.",
    };

    const result = await graphRunner.invoke(inputState);
    console.log("Graph Result (Vague):", JSON.stringify(result, null, 2));

    // It might infer an intent, but the Verifier should drop it, or Reconciler ignore it.
    // If Verifier drops it, verifiedIntents should be empty.
    // OR Reconciler returns 0 actions.
    expect(result.actions.length).toBe(0);
    expect(result.executionResults.length).toBe(0);
  }, 60000);
});

describe('IntentGraph - Conditional Flow (Input Shape Routing)', () => {
  let graphRunner: any;
  let mockDatabase: IntentGraphDatabase;

  const mockProfile = JSON.stringify({
    identity: {
      name: "Test User",
      bio: "Software engineer passionate about web development",
      location: "San Francisco, CA"
    },
    narrative: {
      context: "Experienced developer looking to expand skills"
    },
    attributes: {
      skills: ["JavaScript", "TypeScript", "React"],
      interests: ["Web Development", "System Design", "AI"]
    }
  });

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    const factory = new IntentGraphFactory(mockDatabase);
    graphRunner = factory.createGraph();
  });

  it('should execute full pipeline for a bare create (inputContent only)', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to learn Rust programming language',
    });

    expect(result.inferredIntents).toBeDefined();
    expect(result.verifiedIntents).toBeDefined();
    expect(result.actions).toBeDefined();
    expect(result.executionResults).toBeDefined();
    expect(result.inferredIntents!.length).toBeGreaterThan(0);
  }, 60000);

  it('should run verification for an explicit update (inputContent + targetIntentIds)', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'Update my TypeScript goal to include design patterns',
      targetIntentIds: ['intent-1']
    });

    expect(result.inferredIntents).toBeDefined();
    expect(result.actions).toBeDefined();
    expect(result.executionResults).toBeDefined();
  }, 60000);

  it('should skip inference and verification for archive: true', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      archive: true,
      targetIntentIds: ['intent-1']
    });

    // Archive should skip inference and verification
    expect(!result.inferredIntents || result.inferredIntents.length === 0).toBe(true);
    expect(!result.verifiedIntents || result.verifiedIntents.length === 0).toBe(true);

    // But should have actions
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);
    expect(result.actions!.some((a: any) => a.type === 'expire')).toBe(true);
  }, 60000);

  it('rejects targetIntentIds with no content, archive, or status', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      targetIntentIds: ['intent-1'],
    });

    expect(result.error).toBeDefined();
    expect(result.actions ?? []).toHaveLength(0);
    expect(result.executionResults ?? []).toHaveLength(0);
  }, 60000);

  it('rejects more than one route selected at once', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to contribute to open source',
      archive: true,
      targetIntentIds: ['intent-1'],
    });

    expect(result.error).toBeDefined();
  }, 60000);

  it('dryRun stops after verification and writes nothing', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to contribute to open source',
      dryRun: true,
    });

    expect(result.verifiedIntents!.length).toBeGreaterThan(0);
    expect(result.actions ?? []).toHaveLength(0);
    expect(result.executionResults ?? []).toHaveLength(0);
  }, 60000);

  it('should execute full pipeline when only inputContent is given (no other fields)', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to contribute to open source'
    });

    expect(result.inferredIntents).toBeDefined();
    expect(result.verifiedIntents).toBeDefined();
    expect(result.actions).toBeDefined();
  }, 60000);
});

describe('IntentGraph - Prep always fetches from DB', () => {
  let graphRunner: ReturnType<InstanceType<typeof IntentGraphFactory>["createGraph"]>;
  let mockDatabase: IntentGraphDatabase;
  let getActiveIntentsCalls: string[];

  beforeEach(() => {
    getActiveIntentsCalls = [];
  });

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    const dbWithSpy = {
      ...mockDatabase,
      getActiveIntents: async (userId: string) => {
        getActiveIntentsCalls.push(userId);
        return mockDatabase.getActiveIntents(userId);
      }
    };
    const factory = new IntentGraphFactory(dbWithSpy);
    graphRunner = factory.createGraph();
  });

  it('should always call getActiveIntents even when networkId is set', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: JSON.stringify({ identity: { name: 'Test' } }),
      inputContent: 'I want to learn Rust',
      networkId: 'idx-yc-founders'
    });

    // Prep should always fetch from DB, regardless of network scope
    expect(getActiveIntentsCalls).toContain('test-user-1');
    expect(result.activeIntents).toBeDefined();
    expect(result.inferredIntents).toBeDefined();
  }, 60000);

  it('should call getActiveIntents when no networkId is set', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: JSON.stringify({ identity: { name: 'Test' } }),
      inputContent: 'I want to contribute to open source'
    });

    expect(getActiveIntentsCalls).toContain('test-user-1');
    expect(result.activeIntents).toBeDefined();
    expect(result.inferredIntents).toBeDefined();
  }, 60000);
});

describe('IntentGraph - transition and confirm actions', () => {
  function makeTransitionDatabase(overrides: {
    transitionIntentLifecycle?: IntentGraphDatabase['transitionIntentLifecycle'];
    compensateFailedResume?: IntentGraphDatabase['compensateFailedResume'];
  }): IntentGraphDatabase {
    return {
      getActiveIntents: async () => [],
      transitionIntentLifecycle: overrides.transitionIntentLifecycle,
      compensateFailedResume: overrides.compensateFailedResume,
    } as unknown as IntentGraphDatabase;
  }

  it('enqueues resume discovery on a successful ACTIVE transition', async () => {
    const resumeJobs: Array<{ intentId: string; userId: string; lifecycleVersionMs: number }> = [];
    const database = makeTransitionDatabase({
      transitionIntentLifecycle: async () => ({
        kind: 'success', id: 'intent-1', status: 'ACTIVE', changed: true, lifecycleVersionMs: 100,
      }),
    });
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async (data) => { resumeJobs.push(data); },
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', targetIntentIds: ['intent-1'], status: 'ACTIVE',
    });

    expect(result.transitionResult).toEqual({ kind: 'success', id: 'intent-1', status: 'ACTIVE', changed: true, lifecycleVersionMs: 100 });
    expect(resumeJobs).toEqual([{ intentId: 'intent-1', userId: 'user-1', lifecycleVersionMs: 100 }]);
  });

  it('compensates back to PAUSED when the resume enqueue fails', async () => {
    const compensateCalls: unknown[] = [];
    const database = makeTransitionDatabase({
      transitionIntentLifecycle: async () => ({
        kind: 'success', id: 'intent-1', status: 'ACTIVE', changed: true, lifecycleVersionMs: 200,
      }),
      compensateFailedResume: async (input) => {
        compensateCalls.push(input);
        return { status: 'PAUSED', lifecycleVersionMs: 201 };
      },
    });
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => { throw new Error('queue unavailable'); },
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', targetIntentIds: ['intent-1'], status: 'ACTIVE',
    });

    expect(result.transitionResult).toEqual({ kind: 'enqueue_failed', id: 'intent-1', status: 'PAUSED', lifecycleVersionMs: 201 });
    expect(compensateCalls).toEqual([{ intentId: 'intent-1', userId: 'user-1', lifecycleVersionMs: 200, networkScopeId: undefined }]);
  });

  it('reports enqueue_failed without compensating when the intent was already ACTIVE', async () => {
    const compensateCalls: unknown[] = [];
    const database = makeTransitionDatabase({
      transitionIntentLifecycle: async () => ({
        kind: 'success', id: 'intent-1', status: 'ACTIVE', changed: false, lifecycleVersionMs: 200,
      }),
      compensateFailedResume: async (input) => {
        compensateCalls.push(input);
        return { status: 'PAUSED', lifecycleVersionMs: 201 };
      },
    });
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => { throw new Error('queue unavailable'); },
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', targetIntentIds: ['intent-1'], status: 'ACTIVE',
    });

    expect(result.transitionResult).toEqual({ kind: 'enqueue_failed', id: 'intent-1', status: 'ACTIVE', lifecycleVersionMs: 200 });
    expect(compensateCalls).toEqual([]);
  });

  it('does not enqueue or compensate for a PAUSED transition', async () => {
    const database = makeTransitionDatabase({
      transitionIntentLifecycle: async () => ({
        kind: 'success', id: 'intent-1', status: 'PAUSED', changed: true, lifecycleVersionMs: 50,
      }),
    });
    let resumeCalled = false;
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => { resumeCalled = true; },
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', targetIntentIds: ['intent-1'], status: 'PAUSED',
    });

    expect(result.transitionResult).toEqual({ kind: 'success', id: 'intent-1', status: 'PAUSED', changed: true, lifecycleVersionMs: 50 });
    expect(resumeCalled).toBe(false);
  });

  function makeConfirmDatabase(proposal: {
    id: string; userId: string; description: string; networkId: string | null;
    status: 'pending' | 'consumed' | 'rejected'; expiresAt: Date; consumedIntentId: string | null;
  }): { database: IntentGraphDatabase; revised: unknown[]; confirmedWith: unknown[] } {
    const revised: unknown[] = [];
    const confirmedWith: unknown[] = [];
    const database = {
      getActiveIntents: async () => [],
      getUserContext: async () => ({ text: '' }),
      getProposalForOwner: async () => proposal,
      revisePendingProposal: async (input: unknown) => {
        revised.push(input);
        return { ...proposal, description: (input as { description: string }).description };
      },
      confirmProposalIntent: async (input: unknown) => {
        confirmedWith.push(input);
        return {
          kind: 'created',
          intent: {
            id: 'intent-1', payload: (input as { description: string }).description, summary: null,
            isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: proposal.userId,
          },
        };
      },
    } as unknown as IntentGraphDatabase;
    return { database, revised, confirmedWith };
  }

  it('confirms an unchanged proposal without invoking the verifier', async () => {
    const proposal = {
      id: 'proposal-1', userId: 'user-1', description: 'Find a design partner',
      networkId: null, status: 'pending' as const, expiresAt: new Date(Date.now() + 60_000), consumedIntentId: null,
    };
    const { database, revised, confirmedWith } = makeConfirmDatabase(proposal);
    const hydeJobs: unknown[] = [];
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async (data) => { hydeJobs.push(data); },
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => {},
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', proposalId: 'proposal-1', description: 'Find a design partner',
    });

    expect(result.confirmResult).toEqual({ kind: 'created', intentId: 'intent-1' });
    expect(revised).toHaveLength(0);
    expect(confirmedWith).toEqual([{ proposalId: 'proposal-1', userId: 'user-1', description: 'Find a design partner', embedding: expect.any(Array) }]);
    expect(hydeJobs).toHaveLength(1);
  });

  it('re-verifies an owner-edited description before confirming', async () => {
    const proposal = {
      id: 'proposal-1', userId: 'user-1', description: 'Find a design partner',
      networkId: null, status: 'pending' as const, expiresAt: new Date(Date.now() + 60_000), consumedIntentId: null,
    };
    const { database, revised, confirmedWith } = makeConfirmDatabase(proposal);
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => {},
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', proposalId: 'proposal-1',
      description: 'Find a design partner with production LLM experience in Berlin this quarter',
    });

    expect(result.confirmResult).toEqual({ kind: 'created', intentId: 'intent-1' });
    expect(revised).toHaveLength(1);
    expect(confirmedWith).toEqual([{
      proposalId: 'proposal-1', userId: 'user-1',
      description: 'Find a design partner with production LLM experience in Berlin this quarter',
      embedding: expect.any(Array),
    }]);
  }, 60000);

  it('rejects a network mismatch before touching description or verification', async () => {
    const proposal = {
      id: 'proposal-1', userId: 'user-1', description: 'Find a design partner',
      networkId: null, status: 'pending' as const, expiresAt: new Date(Date.now() + 60_000), consumedIntentId: null,
    };
    const { database, revised, confirmedWith } = makeConfirmDatabase(proposal);
    const factory = new IntentGraphFactory(database, undefined, {
      addGenerateHydeJob: async () => {},
      addDeleteHydeJob: async () => {},
      addResumeDiscoveryJob: async () => {},
    });
    const result = await factory.createGraph().invoke({
      userId: 'user-1', userProfile: '', proposalId: 'proposal-1',
      // Both description and networkId differ from the stored proposal.
      description: 'Something else entirely', networkId: 'network-1',
    });

    expect(result.confirmResult).toEqual({ kind: 'payload_mismatch' });
    // Must not have revised the stored description on the way to rejection.
    expect(revised).toHaveLength(0);
    expect(confirmedWith).toHaveLength(0);
  });
});
