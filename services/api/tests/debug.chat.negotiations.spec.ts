import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { DebugController } from '../src/controllers/debug.controller';
import db from '../src/lib/drizzle/drizzle';
import { opportunities, users } from '../src/schemas/database.schema';
import { conversationParticipants, conversations, messages, tasks } from '../src/schemas/conversation.schema';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(method = 'GET') {
  return new Request('http://localhost/', { method });
}

function makeUser(id: string) {
  return { id } as never;
}

function makeParams(overrides: Record<string, string> = {}) {
  return overrides;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let userId: string;
let chatConvId: string;
let oppId1: string;
let oppId2: string;
let negConvId1: string;
let negConvId2: string;

beforeAll(async () => {
  // 1. Seed a real user
  const [user] = await db
    .insert(users)
    .values({ email: `debug-neg-test-${randomUUID()}@example.com`, name: 'Debug Neg Test User' })
    .returning();
  userId = user.id;

  // 2. Seed two opportunities linked to the user
  const [opp1] = await db
    .insert(opportunities)
    .values({
      detection: { source: 'chat', timestamp: new Date().toISOString() },
      actors: [{ networkId: 'net-1', userId, role: 'source' }],
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: 'net-1' },
      confidence: '0.9',
      status: 'draft',
    })
    .returning();
  oppId1 = opp1.id;

  const [opp2] = await db
    .insert(opportunities)
    .values({
      detection: { source: 'chat', timestamp: new Date().toISOString() },
      actors: [{ networkId: 'net-1', userId, role: 'source' }],
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.8 },
      context: { networkId: 'net-1' },
      confidence: '0.8',
      status: 'rejected',
    })
    .returning();
  oppId2 = opp2.id;

  const candidateUserId = 'u-cand';

  // 3. Seed negotiation conversations + tasks + messages for each opportunity
  for (const [oppId, idx] of [[oppId1, 0], [oppId2, 1]] as [string, number][]) {
    const [negConv] = await db
      .insert(conversations)
      .values({})
      .returning();
    const negConvId = negConv.id;

    if (idx === 0) negConvId1 = negConvId;
    else negConvId2 = negConvId;

    const [task] = await db
      .insert(tasks)
      .values({
        conversationId: negConvId,
        state: 'completed',
        metadata: {
          type: 'negotiation',
          opportunityId: oppId,
          sourceUserId: userId,
          candidateUserId,
        },
      })
      .returning();

    // Seed 2 turn messages in the negotiation conversation
    await db.insert(messages).values([
      {
        conversationId: negConvId,
        taskId: task.id,
        senderId: `agent:${userId}`, // source actor
        role: 'user',
        parts: [
          {
            kind: 'data',
            data: {
              action: 'propose',
              assessment: {
                reasoning: 'This looks promising',
                suggestedRoles: { ownUser: 'agent', otherUser: 'patient' },
              },
            },
          },
        ],
      },
      {
        conversationId: negConvId,
        taskId: task.id,
        senderId: `agent:${candidateUserId}`, // candidate actor
        role: 'agent',
        parts: [
          {
            kind: 'data',
            data: {
              action: 'accept',
              assessment: {
                reasoning: 'Agreed',
                suggestedRoles: { ownUser: 'patient', otherUser: 'agent' },
              },
            },
          },
        ],
      },
    ]);
  }

  // 4. Seed a chat conversation for the session user with one assistant message
  //    whose debugMeta.orchestratorNegotiations.opportunityIds contains both opp IDs
  const [chatConv] = await db
    .insert(conversations)
    .values({})
    .returning();
  chatConvId = chatConv.id;

  // Add user participant
  await db.insert(conversationParticipants).values({
    conversationId: chatConvId,
    participantId: userId,
    participantType: 'user',
  });

  // Add a user turn message
  await db.insert(messages).values({
    conversationId: chatConvId,
    senderId: userId,
    role: 'user',
    parts: [{ kind: 'text', text: 'Find me connections' }],
  });

  // Add an assistant turn message with debugMeta containing opportunityIds
  await db.insert(messages).values({
    conversationId: chatConvId,
    senderId: 'system-agent',
    role: 'agent',
    parts: [{ kind: 'text', text: 'Here are your matches.' }],
    metadata: {
      debugMeta: {
        graph: 'chat',
        iterations: 1,
        tools: [],
        orchestratorNegotiations: {
          opportunityIds: [oppId1, oppId2],
        },
      },
    },
  });
});

afterAll(async () => {
  // Clean up in reverse dependency order
  if (chatConvId) {
    await db.delete(messages).where(eq(messages.conversationId, chatConvId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, chatConvId));
    await db.delete(conversations).where(eq(conversations.id, chatConvId));
  }
  for (const negConvId of [negConvId1, negConvId2].filter(Boolean)) {
    await db.delete(messages).where(eq(messages.conversationId, negConvId));
    await db.delete(tasks).where(eq(tasks.conversationId, negConvId));
    await db.delete(conversations).where(eq(conversations.id, negConvId));
  }
  if (oppId1) await db.delete(opportunities).where(eq(opportunities.id, oppId1));
  if (oppId2) await db.delete(opportunities).where(eq(opportunities.id, oppId2));
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /debug/chat/:id — negotiation hydration', () => {
  it('returns 200 with negotiations hydrated on the assistant turn', async () => {
    const controller = new DebugController();

    const res = await controller.getChatDebug(
      makeRequest(),
      makeUser(userId),
      makeParams({ id: chatConvId }),
    );

    expect(res.status).toBe(200);

    const body = await res.json() as {
      turns: Array<{
        messageIndex: number;
        negotiations?: Array<{
          opportunityId: string;
          turns: Array<unknown>;
          outcome: { status: string; turnCount: number } | null;
        }>;
      }>;
    };

    // Find the assistant turn (messageIndex 1, since user msg is 0)
    const assistantTurn = body.turns.find((t) => t.negotiations !== undefined);
    expect(assistantTurn).toBeDefined();

    const negotiations = assistantTurn!.negotiations!;
    expect(Array.isArray(negotiations)).toBe(true);
    expect(negotiations).toHaveLength(2);

    // Each entry must have the required fields
    for (const neg of negotiations) {
      expect(typeof neg.opportunityId).toBe('string');
      expect(Array.isArray(neg.turns)).toBe(true);
      expect(neg.turns.length).toBeGreaterThanOrEqual(1);
      expect(neg.outcome).not.toBeUndefined();
    }

    // Verify the two opportunity IDs are present
    const returnedOppIds = negotiations.map((n) => n.opportunityId);
    expect(returnedOppIds).toContain(oppId1);
    expect(returnedOppIds).toContain(oppId2);

    // Verify statuses are carried through
    const neg1 = negotiations.find((n) => n.opportunityId === oppId1);
    const neg2 = negotiations.find((n) => n.opportunityId === oppId2);
    expect(neg1?.outcome?.status).toBe('draft');
    expect(neg2?.outcome?.status).toBe('rejected');

    // Verify actor labelling: first turn is source, second is candidate
    const firstNeg = negotiations[0];
    expect((firstNeg.turns[0] as { actor: string }).actor).toBe('source');
    expect((firstNeg.turns[1] as { actor: string }).actor).toBe('candidate');
  });

  it('returns 404 when session does not belong to the user', async () => {
    const controller = new DebugController();

    const res = await controller.getChatDebug(
      makeRequest(),
      makeUser('unknown-user-id'),
      makeParams({ id: chatConvId }),
    );

    expect(res.status).toBe(404);
  });
});
