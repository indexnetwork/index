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
let oppId: string;
let negConvId: string;

beforeAll(async () => {
  // 1. Seed a real user
  const [user] = await db
    .insert(users)
    .values({ email: `debug-legacy-test-${randomUUID()}@example.com`, name: 'Debug Legacy Test User' })
    .returning();
  userId = user.id;

  // 2. Seed a chat conversation for the session user
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

  // 3. Add an assistant turn message with legacy debugMeta — NO orchestratorNegotiations pointer
  const [assistantMsg] = await db.insert(messages).values({
    conversationId: chatConvId,
    senderId: 'system-agent',
    role: 'agent',
    parts: [{ kind: 'text', text: 'Here are your matches.' }],
    metadata: {
      debugMeta: {
        graph: 'agent_loop',
        iterations: 1,
        tools: [],
        // intentionally omit orchestratorNegotiations
      },
    },
  }).returning();

  const msgCreatedAt = assistantMsg.createdAt;

  // 4. Seed one opportunity where the session user appears in actors,
  //    detection.source = 'chat' (orchestrator-triggered), and
  //    createdAt = 2 seconds after the assistant message's createdAt
  const oppCreatedAt = new Date(msgCreatedAt.getTime() + 2000);
  const [opp] = await db
    .insert(opportunities)
    .values({
      detection: { source: 'chat', timestamp: new Date().toISOString() },
      actors: [{ networkId: 'net-1', userId, role: 'source' }],
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: 'net-1' },
      confidence: '0.9',
      status: 'draft',
      createdAt: oppCreatedAt,
    })
    .returning();
  oppId = opp.id;

  // 5. Seed a negotiation conversation + task + 1 turn message for the opportunity
  const [negConv] = await db
    .insert(conversations)
    .values({})
    .returning();
  negConvId = negConv.id;

  const candidateUserId = 'u-cand-legacy';

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

  // Seed 1 turn message in the negotiation conversation
  await db.insert(messages).values({
    conversationId: negConvId,
    taskId: task.id,
    senderId: `agent:${userId}`,
    role: 'user',
    parts: [
      {
        kind: 'data',
        data: {
          action: 'propose',
          assessment: {
            reasoning: 'Legacy path test',
          },
        },
      },
    ],
  });
});

afterAll(async () => {
  // Clean up in reverse dependency order
  if (chatConvId) {
    await db.delete(messages).where(eq(messages.conversationId, chatConvId));
    await db.delete(conversationParticipants).where(eq(conversationParticipants.conversationId, chatConvId));
    await db.delete(conversations).where(eq(conversations.id, chatConvId));
  }
  if (negConvId) {
    await db.delete(messages).where(eq(messages.conversationId, negConvId));
    await db.delete(tasks).where(eq(tasks.conversationId, negConvId));
    await db.delete(conversations).where(eq(conversations.id, negConvId));
  }
  if (oppId) await db.delete(opportunities).where(eq(opportunities.id, oppId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /debug/chat/:id — legacy negotiation hydration (time-window fallback)', () => {
  it('returns 200 with negotiations hydrated via time-window fallback for legacy messages', async () => {
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

    // Find the assistant turn — it should have negotiations hydrated via fallback
    const assistantTurn = body.turns.find((t) => t.negotiations !== undefined);
    expect(assistantTurn).toBeDefined();

    const negotiations = assistantTurn!.negotiations!;
    expect(Array.isArray(negotiations)).toBe(true);
    expect(negotiations).toHaveLength(1);

    // Verify the correct opportunity ID is present
    expect(negotiations[0].opportunityId).toBe(oppId);

    // Verify turns were fetched
    expect(Array.isArray(negotiations[0].turns)).toBe(true);
    expect(negotiations[0].turns.length).toBeGreaterThanOrEqual(1);

    // Verify outcome
    expect(negotiations[0].outcome).not.toBeNull();
    expect(negotiations[0].outcome?.status).toBe('draft');
  });
});
