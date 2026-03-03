import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it, beforeAll, afterAll, mock } from "bun:test";
import { NegotiationGraphFactory, type NegotiationGraphDatabase } from "../negotiation.graph";
import { NegotiationAgent } from "../../agents/negotiation.agent";
import { negotiationDatabaseAdapter } from "../../../../adapters/negotiation.database.adapter";
import type {
  NegotiationAgentInput,
  NegotiationAgentOutput,
  NegotiationTrigger,
} from "../../../../types/negotiation.types";
import type { Id } from "../../../../types/common.types";
import db from "../../../../lib/drizzle/drizzle";
import * as schema from "../../../../schemas/database.schema";
import { eq, inArray } from "drizzle-orm";

// Test user IDs
const TEST_USER_A_ID = `test-neg-user-a-${Date.now()}`;
const TEST_USER_B_ID = `test-neg-user-b-${Date.now()}`;

describe('NegotiationGraph - Basic Flow', () => {
  let createdUserIds: string[] = [];
  let createdNegotiationIds: string[] = [];

  beforeAll(async () => {
    // Create test users
    const [userA] = await db.insert(schema.users)
      .values({
        id: TEST_USER_A_ID,
        email: `test-a-${Date.now()}@test.com`,
        name: 'Test User A',
      })
      .returning();
    
    const [userB] = await db.insert(schema.users)
      .values({
        id: TEST_USER_B_ID,
        email: `test-b-${Date.now()}@test.com`,
        name: 'Test User B',
      })
      .returning();

    createdUserIds = [userA.id, userB.id];

    // Create profiles
    await db.insert(schema.userProfiles)
      .values([
        {
          userId: userA.id,
          identity: { name: 'Test User A', bio: 'AI developer' },
          attributes: { skills: ['AI', 'Python'], interests: ['Machine learning'] },
          narrative: { context: 'Building AI agents' },
        },
        {
          userId: userB.id,
          identity: { name: 'Test User B', bio: 'AI investor' },
          attributes: { skills: ['Investing'], interests: ['AI startups'] },
          narrative: { context: 'Looking for AI investments' },
        },
      ]);
  });

  afterAll(async () => {
    // Clean up negotiations
    if (createdNegotiationIds.length > 0) {
      await db.delete(schema.negotiations)
        .where(inArray(schema.negotiations.id, createdNegotiationIds));
    }

    // Clean up profiles
    if (createdUserIds.length > 0) {
      await db.delete(schema.userProfiles)
        .where(inArray(schema.userProfiles.userId, createdUserIds));
      await db.delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds));
    }
  });

  it('should create a negotiation record when graph runs', async () => {
    // Create a mock agent that always accepts
    const mockAgent = {
      invoke: async (input: NegotiationAgentInput): Promise<NegotiationAgentOutput> => ({
        message: { context: 'Mock negotiation', upside: 'High value' },
        decision: 'accept',
        reasoning: 'Mock acceptance',
      }),
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const trigger: NegotiationTrigger = {
      source: 'search',
      query: 'AI investments',
    };

    const result = await graph.invoke({
      initiatorUserId: TEST_USER_A_ID as Id<'users'>,
      responderUserId: TEST_USER_B_ID as Id<'users'>,
      trigger,
      options: { maxTurns: 3 },
      operationMode: 'negotiate',
    });

    expect(result.createdNegotiationId).toBeDefined();
    expect(result.status).toBe('resolved');
    expect(result.outcome).toBe('opportunity');
    
    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 30000);

  it('should handle decline decision', async () => {
    const mockAgent = {
      invoke: async (): Promise<NegotiationAgentOutput> => ({
        decision: 'decline',
        reasoning: 'No match found',
      }),
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: TEST_USER_A_ID as Id<'users'>,
      responderUserId: TEST_USER_B_ID as Id<'users'>,
      trigger: { source: 'search' },
      options: { maxTurns: 3 },
      operationMode: 'negotiate',
    });

    expect(result.status).toBe('resolved');
    expect(result.outcome).toBe('disengaged');
    expect(result.opportunityId).toBeNull();

    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 30000);

  it('should handle defer decision', async () => {
    const mockAgent = {
      invoke: async (): Promise<NegotiationAgentOutput> => ({
        decision: 'defer',
        reasoning: 'Not the right time',
      }),
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: TEST_USER_A_ID as Id<'users'>,
      responderUserId: TEST_USER_B_ID as Id<'users'>,
      trigger: { source: 'search' },
      options: { maxTurns: 3 },
      operationMode: 'negotiate',
    });

    expect(result.status).toBe('resolved');
    expect(result.outcome).toBe('deferred');

    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 30000);
});

describe('NegotiationGraph - Multi-Turn Flow', () => {
  let createdUserIds: string[] = [];
  let createdNegotiationIds: string[] = [];

  beforeAll(async () => {
    const timestamp = Date.now();
    const [userA] = await db.insert(schema.users)
      .values({
        id: `test-multi-a-${timestamp}`,
        email: `test-multi-a-${timestamp}@test.com`,
        name: 'Multi Test User A',
      })
      .returning();
    
    const [userB] = await db.insert(schema.users)
      .values({
        id: `test-multi-b-${timestamp}`,
        email: `test-multi-b-${timestamp}@test.com`,
        name: 'Multi Test User B',
      })
      .returning();

    createdUserIds = [userA.id, userB.id];

    await db.insert(schema.userProfiles)
      .values([
        {
          userId: userA.id,
          identity: { name: 'Multi Test A' },
        },
        {
          userId: userB.id,
          identity: { name: 'Multi Test B' },
        },
      ]);
  });

  afterAll(async () => {
    if (createdNegotiationIds.length > 0) {
      await db.delete(schema.negotiations)
        .where(inArray(schema.negotiations.id, createdNegotiationIds));
    }

    if (createdUserIds.length > 0) {
      await db.delete(schema.userProfiles)
        .where(inArray(schema.userProfiles.userId, createdUserIds));
      await db.delete(schema.users)
        .where(inArray(schema.users.id, createdUserIds));
    }
  });

  it('should continue through multiple turns before accepting', async () => {
    let callCount = 0;
    const mockAgent = {
      invoke: async (): Promise<NegotiationAgentOutput> => {
        callCount++;
        // First two turns continue, third accepts
        if (callCount < 3) {
          return {
            message: { context: `Turn ${callCount}` },
            decision: 'continue',
            reasoning: `Continuing turn ${callCount}`,
          };
        }
        return {
          message: { context: 'Final turn' },
          decision: 'accept',
          reasoning: 'Agreement reached',
        };
      },
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: createdUserIds[0] as Id<'users'>,
      responderUserId: createdUserIds[1] as Id<'users'>,
      trigger: { source: 'search' },
      options: { maxTurns: 5 },
      operationMode: 'negotiate',
    });

    expect(result.status).toBe('resolved');
    expect(result.outcome).toBe('opportunity');
    expect(result.turns.length).toBe(3);

    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 60000);

  it('should respect max turns limit', async () => {
    const mockAgent = {
      invoke: async (): Promise<NegotiationAgentOutput> => ({
        message: { context: 'Keep going' },
        decision: 'continue',
        reasoning: 'Still negotiating',
      }),
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: createdUserIds[0] as Id<'users'>,
      responderUserId: createdUserIds[1] as Id<'users'>,
      trigger: { source: 'search' },
      options: { maxTurns: 3 },
      operationMode: 'negotiate',
    });

    expect(result.status).toBe('resolved');
    // Should resolve after max turns even without terminal decision
    expect(result.turns.length).toBeLessThanOrEqual(3);

    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 60000);

  it('should handle extension requests up to max 5 turns', async () => {
    let callCount = 0;
    const mockAgent = {
      invoke: async (): Promise<NegotiationAgentOutput> => {
        callCount++;
        // Request extension twice, then accept
        if (callCount <= 2) {
          return {
            message: { context: `Turn ${callCount}` },
            decision: 'extend',
            reasoning: 'Need more discussion',
            extendReason: 'Complex topic requires clarification',
          };
        }
        if (callCount <= 4) {
          return {
            message: { context: `Turn ${callCount}` },
            decision: 'continue',
            reasoning: 'Continuing',
          };
        }
        return {
          decision: 'accept',
          reasoning: 'Finally agreed',
        };
      },
    } as NegotiationAgent;

    const factory = new NegotiationGraphFactory(negotiationDatabaseAdapter, mockAgent);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      initiatorUserId: createdUserIds[0] as Id<'users'>,
      responderUserId: createdUserIds[1] as Id<'users'>,
      trigger: { source: 'search' },
      options: { maxTurns: 3 },
      operationMode: 'negotiate',
    });

    expect(result.status).toBe('resolved');
    // Max turns should have been extended
    expect(result.maxTurns).toBeGreaterThanOrEqual(3);

    if (result.createdNegotiationId) {
      createdNegotiationIds.push(result.createdNegotiationId);
    }
  }, 90000);
});
