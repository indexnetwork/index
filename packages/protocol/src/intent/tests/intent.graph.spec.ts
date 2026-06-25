/**
 * Tests for IntentGraph
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll, beforeEach } from "bun:test";
import { IntentGraphFactory } from "../intent.graph.js";
import { IntentGraphState } from "../intent.state.js";
import type { IntentGraphDatabase, ActiveIntent, CreatedIntent, ArchiveResult } from "../../shared/interfaces/database.interface.js";

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
      return { id: _userId, name: 'Test User', email: 'test@example.com' };
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
    async getProfile(_userId: string) {
      return {
        identity: { name: 'Test User', bio: 'Software engineer', location: 'San Francisco' },
        narrative: { context: 'Experienced developer' },
        attributes: { skills: ['TypeScript'], interests: ['Web Dev'] },
      } as any;
    },
    async assignIntentToNetwork(_intentId: string, _indexId: string): Promise<void> {
      // no-op for tests
    },
    async getPersonalIndexesForContact(_userId: string): Promise<{ networkId: string }[]> {
      return [];
    }
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
      inputContent: "I want to build a new React app for my portfolio.",
    };

    const result = await graphRunner.invoke(inputState);

    console.log("Graph Result:", JSON.stringify(result, null, 2));

    // Expectations
    expect(result.inferredIntents.length).toBeGreaterThan(0);
    expect(result.verifiedIntents.length).toBeGreaterThan(0);
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

describe('IntentGraph - Conditional Flow (Operation Modes)', () => {
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

  it('should execute full pipeline for CREATE mode', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to learn Rust programming language',
      operationMode: 'create'
    });

    expect(result.inferredIntents).toBeDefined();
    expect(result.verifiedIntents).toBeDefined();
    expect(result.actions).toBeDefined();
    expect(result.executionResults).toBeDefined();

    // CREATE should go through full pipeline
    expect(result.inferredIntents!.length).toBeGreaterThan(0);
  }, 60000);

  it('should skip verification for UPDATE mode', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'Update my TypeScript goal to include design patterns',
      operationMode: 'update',
      targetIntentIds: ['intent-1']
    });

    expect(result.inferredIntents).toBeDefined();
    expect(result.actions).toBeDefined();
    expect(result.executionResults).toBeDefined();

    // UPDATE may skip verification if no new intents are inferred
  }, 60000);

  it('should skip inference and verification for DELETE mode', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: undefined,
      operationMode: 'delete',
      targetIntentIds: ['intent-1']
    });

    // DELETE should skip inference and verification
    expect(!result.inferredIntents || result.inferredIntents.length === 0).toBe(true);
    expect(!result.verifiedIntents || result.verifiedIntents.length === 0).toBe(true);

    // But should have actions
    expect(result.actions).toBeDefined();
    expect(result.actions!.length).toBeGreaterThan(0);
    expect(result.actions!.some((a: any) => a.type === 'expire')).toBe(true);
  }, 60000);

  it('should default to CREATE mode when operationMode not specified', async () => {
    const result = await graphRunner.invoke({
      userId: 'test-user-1',
      userProfile: mockProfile,
      inputContent: 'I want to contribute to open source'
      // operationMode not specified
    });

    // Should execute full pipeline (defaults to create)
    expect(result.inferredIntents).toBeDefined();
    expect(result.verifiedIntents).toBeDefined();
    expect(result.actions).toBeDefined();
  }, 60000);
});

describe('IntentGraph - Prep always fetches from DB', () => {
  let graphRunner: ReturnType<IntentGraphFactory['createGraph']>;
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
      operationMode: 'create',
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
      inputContent: 'I want to contribute to open source',
      operationMode: 'create'
    });

    expect(getActiveIntentsCalls).toContain('test-user-1');
    expect(result.activeIntents).toBeDefined();
    expect(result.inferredIntents).toBeDefined();
  }, 60000);
});
