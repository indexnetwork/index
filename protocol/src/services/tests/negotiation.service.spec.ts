import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { NegotiationService } from "../negotiation.service";
import db from "../../lib/drizzle/drizzle";
import * as schema from "../../schemas/database.schema";
import { eq, inArray } from "drizzle-orm";
import type { Id } from "../../types/common.types";
import type { NegotiationParticipant, NegotiationTrigger } from "../../types/negotiation.types";

describe('NegotiationService - Basic Operations', () => {
  const service = new NegotiationService();
  const timestamp = Date.now();
  
  let testUserAId: string;
  let testUserBId: string;
  let createdNegotiationIds: string[] = [];

  beforeAll(async () => {
    // Create test users
    const [userA] = await db.insert(schema.users)
      .values({
        id: `test-svc-a-${timestamp}`,
        email: `test-svc-a-${timestamp}@test.com`,
        name: 'Service Test User A',
      })
      .returning();
    
    const [userB] = await db.insert(schema.users)
      .values({
        id: `test-svc-b-${timestamp}`,
        email: `test-svc-b-${timestamp}@test.com`,
        name: 'Service Test User B',
      })
      .returning();

    testUserAId = userA.id;
    testUserBId = userB.id;

    // Create test negotiation records
    const participants: NegotiationParticipant[] = [
      { userId: testUserAId as Id<'users'>, role: 'initiator' },
      { userId: testUserBId as Id<'users'>, role: 'responder' },
    ];

    const trigger: NegotiationTrigger = {
      source: 'search',
      query: 'test query',
    };

    // Create a few test negotiations
    const [neg1] = await db.insert(schema.negotiations)
      .values({
        status: 'in_progress',
        participants,
        trigger,
        turns: [],
        currentTurn: 1,
        maxTurns: 3,
      })
      .returning();

    const [neg2] = await db.insert(schema.negotiations)
      .values({
        status: 'resolved',
        outcome: 'opportunity',
        participants,
        trigger,
        turns: [],
        currentTurn: 2,
        maxTurns: 3,
        resolution: {
          reasoning: 'Test resolution',
          outcome: 'opportunity',
        },
      })
      .returning();

    createdNegotiationIds = [neg1.id, neg2.id];
  });

  afterAll(async () => {
    // Clean up negotiations
    if (createdNegotiationIds.length > 0) {
      await db.delete(schema.negotiations)
        .where(inArray(schema.negotiations.id, createdNegotiationIds));
    }

    // Clean up users
    if (testUserAId && testUserBId) {
      await db.delete(schema.users)
        .where(inArray(schema.users.id, [testUserAId, testUserBId]));
    }
  });

  it('should list negotiations for a user', async () => {
    const negotiations = await service.listNegotiations({
      userId: testUserAId,
    });

    expect(negotiations.length).toBeGreaterThanOrEqual(2);
    
    // All should include the test user as a participant
    for (const neg of negotiations) {
      const userIds = neg.participants.map(p => p.userId);
      expect(userIds).toContain(testUserAId as Id<'users'>);
    }
  });

  it('should filter negotiations by status', async () => {
    const inProgressNegs = await service.listNegotiations({
      userId: testUserAId,
      status: 'in_progress',
    });

    for (const neg of inProgressNegs) {
      expect(neg.status).toBe('in_progress');
    }

    const resolvedNegs = await service.listNegotiations({
      userId: testUserAId,
      status: 'resolved',
    });

    for (const neg of resolvedNegs) {
      expect(neg.status).toBe('resolved');
    }
  });

  it('should get a negotiation by ID', async () => {
    const negotiationId = createdNegotiationIds[0];
    const negotiation = await service.getNegotiation(negotiationId);

    expect(negotiation).not.toBeNull();
    expect(negotiation?.id).toBe(negotiationId);
    expect(negotiation?.participants).toBeDefined();
    expect(negotiation?.trigger).toBeDefined();
  });

  it('should return null for non-existent negotiation', async () => {
    const negotiation = await service.getNegotiation('non-existent-id');
    expect(negotiation).toBeNull();
  });

  it('should get negotiations between two users', async () => {
    const negotiations = await service.getNegotiationsBetweenUsers(
      testUserAId,
      testUserBId
    );

    expect(negotiations.length).toBeGreaterThanOrEqual(2);
    
    for (const neg of negotiations) {
      const userIds = neg.participants.map(p => p.userId);
      expect(userIds).toContain(testUserAId as Id<'users'>);
      expect(userIds).toContain(testUserBId as Id<'users'>);
    }
  });

  it('should get user negotiation stats', async () => {
    const stats = await service.getUserNegotiationStats(testUserAId);

    expect(stats.total).toBeGreaterThanOrEqual(2);
    expect(stats.inProgress).toBeGreaterThanOrEqual(1);
    expect(stats.resolved).toBeGreaterThanOrEqual(1);
    expect(typeof stats.accepted).toBe('number');
    expect(typeof stats.declined).toBe('number');
    expect(typeof stats.deferred).toBe('number');
  });
});

describe('NegotiationService - Initiation', () => {
  const service = new NegotiationService();
  const timestamp = Date.now();
  
  let testUserAId: string;
  let testUserBId: string;
  let createdNegotiationIds: string[] = [];

  beforeAll(async () => {
    // Create test users with profiles
    const [userA] = await db.insert(schema.users)
      .values({
        id: `test-init-a-${timestamp}`,
        email: `test-init-a-${timestamp}@test.com`,
        name: 'Init Test User A',
      })
      .returning();
    
    const [userB] = await db.insert(schema.users)
      .values({
        id: `test-init-b-${timestamp}`,
        email: `test-init-b-${timestamp}@test.com`,
        name: 'Init Test User B',
      })
      .returning();

    testUserAId = userA.id;
    testUserBId = userB.id;

    // Create profiles
    await db.insert(schema.userProfiles)
      .values([
        {
          userId: userA.id,
          identity: { name: 'Init Test A', bio: 'Test bio A' },
        },
        {
          userId: userB.id,
          identity: { name: 'Init Test B', bio: 'Test bio B' },
        },
      ]);
  });

  afterAll(async () => {
    // Clean up negotiations
    if (createdNegotiationIds.length > 0) {
      await db.delete(schema.negotiations)
        .where(inArray(schema.negotiations.id, createdNegotiationIds));
    }

    // Clean up profiles and users
    if (testUserAId && testUserBId) {
      await db.delete(schema.userProfiles)
        .where(inArray(schema.userProfiles.userId, [testUserAId, testUserBId]));
      await db.delete(schema.users)
        .where(inArray(schema.users.id, [testUserAId, testUserBId]));
    }
  });

  it('should initiate negotiation async and return job ID', async () => {
    const result = await service.initiateNegotiationAsync({
      initiatorUserId: testUserAId,
      responderUserId: testUserBId,
      trigger: { source: 'search', query: 'test' },
    });

    expect(result.jobId).toBeDefined();
    expect(result.jobId.length).toBeGreaterThan(0);
  });
});
