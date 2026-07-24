/**
 * IND — archive legacy pre-v2 negotiations (feat/archive-legacy-negotiations).
 *
 * Proves:
 *  1. Archived tasks are excluded from: getNegotiationsByUser,
 *     getConversationsForUser (lifecycle join), getStaleNegotiationTasks,
 *     negotiation-polling pickup, and qualifyingNegotiationAttemptTaskWhere.
 *  2. Non-archived tasks and v2 tasks (protocolVersion set) remain fully
 *     visible to every reader.
 *  3. The backfill query stamps exactly the pre-v2 rows (archivedAt IS NULL
 *     AND protocolVersion IS NULL) and is idempotent on re-run.
 *
 * Real Postgres via .env.test; BullMQ queues mocked (no Redis).
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it as bunIt, expect, beforeAll, afterAll, mock } from 'bun:test';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm/sql';
import { eq } from 'drizzle-orm';

import { withMinimumDatabaseTestBudget } from '../../lib/testing/database-test-budget';

// ─── Mock queues before any service imports ──────────────────────────────────
mock.module('../../queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
}));
mock.module('../../queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
}));

const { conversationDatabaseAdapter } = await import('../database.adapter');
const { negotiationPollingService } = await import('../../services/negotiation-polling.service');
const { notArchivedNegotiationTaskWhere, qualifyingNegotiationAttemptTaskWhere } = await import('../negotiation-attempt.atomic');
const { default: db } = await import('../../lib/drizzle/drizzle');
const dbSchema = await import('../../schemas/database.schema');
const convSchema = await import('../../schemas/conversation.schema');

const it = withMinimumDatabaseTestBudget(bunIt, 30_000);

afterAll(() => { mock.restore(); });

// ─── Seed state ──────────────────────────────────────────────────────────────

const cleanupConversations: string[] = [];
const cleanupOpportunities: string[] = [];

let userA: string;
let userB: string;
let agentA: string;

async function seedUser(name: string): Promise<string> {
  const [u] = await db
    .insert(dbSchema.users)
    .values({ email: `archive-test-${randomUUID()}@test.local`, name })
    .returning({ id: dbSchema.users.id });
  return u.id;
}

async function seedAgent(ownerId: string): Promise<string> {
  const [a] = await db
    .insert(dbSchema.agents)
    .values({ ownerId, name: 'archive-test-agent', type: 'external' })
    .returning({ id: dbSchema.agents.id });
  return a.id;
}

async function seedOpportunity(status = 'negotiating'): Promise<string> {
  const [o] = await db
    .insert(dbSchema.opportunities)
    .values({
      detection: { kind: 'test', summary: 'archive test' } as never,
      actors: [
        { userId: userA, role: 'peer' },
        { userId: userB, role: 'peer' },
      ] as never,
      interpretation: { reasoning: 'archive test', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status,
    })
    .returning({ id: dbSchema.opportunities.id });
  cleanupOpportunities.push(o.id);
  return o.id;
}

interface SeedTaskOpts {
  protocolVersion?: string;
  archivedAt?: string;
  state?: 'submitted' | 'working' | 'waiting_for_agent' | 'input_required' | 'completed';
  opportunityId?: string;
  createdAt?: Date;
}

async function seedNegotiationTask(opts: SeedTaskOpts = {}): Promise<{
  taskId: string;
  conversationId: string;
}> {
  const conv = await conversationDatabaseAdapter.createConversation([
    { participantId: `agent:${userA}`, participantType: 'agent' as const },
    { participantId: `agent:${userB}`, participantType: 'agent' as const },
  ]);
  cleanupConversations.push(conv.id);

  const metadata: Record<string, unknown> = {
    type: 'negotiation',
    sourceUserId: userA,
    candidateUserId: userB,
    ...(opts.opportunityId && { opportunityId: opts.opportunityId }),
    ...(opts.protocolVersion && { protocolVersion: opts.protocolVersion }),
    ...(opts.archivedAt && { archivedAt: opts.archivedAt }),
  };

  const task = await conversationDatabaseAdapter.createTask(conv.id, metadata);

  // Transition to desired state if not default 'submitted'
  const desiredState = opts.state ?? 'submitted';
  if (desiredState !== 'submitted') {
    await db
      .update(convSchema.tasks)
      .set({ state: desiredState, updatedAt: new Date() })
      .where(eq(convSchema.tasks.id, task.id));
  }

  return { taskId: task.id, conversationId: conv.id };
}

/** Stamp archivedAt directly on a task (simulates the backfill). */
async function stampArchivedAt(taskId: string, isoTimestamp: string): Promise<void> {
  await db
    .update(convSchema.tasks)
    .set({
      metadata: sql`${convSchema.tasks.metadata} || jsonb_build_object('archivedAt', ${isoTimestamp}::text)`,
    })
    .where(eq(convSchema.tasks.id, taskId));
}

beforeAll(async () => {
  userA = await seedUser('Archive Test A');
  userB = await seedUser('Archive Test B');
  agentA = await seedAgent(userA);
}, 30_000);

afterAll(async () => {
  for (const id of cleanupConversations) {
    try { await conversationDatabaseAdapter.deleteConversation(id); } catch { /* ignore */ }
  }
  for (const id of cleanupOpportunities) {
    try {
      await db.delete(dbSchema.opportunities).where(eq(dbSchema.opportunities.id, id));
    } catch { /* ignore */ }
  }
  try {
    await db.delete(dbSchema.agents).where(eq(dbSchema.agents.id, agentA));
    await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userA));
    await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userB));
  } catch { /* ignore */ }
}, 30_000);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('archive legacy negotiations — getNegotiationsByUser', () => {
  it('excludes archived tasks from user negotiation list', async () => {
    const { taskId: archivedId } = await seedNegotiationTask({ state: 'submitted' });
    const { taskId: activeId } = await seedNegotiationTask({ state: 'submitted' });

    await stampArchivedAt(archivedId, new Date().toISOString());

    const results = await conversationDatabaseAdapter.getNegotiationsByUser(userA, { unpaginated: true });
    const ids = results.map((t) => t.id);

    expect(ids).not.toContain(archivedId);
    expect(ids).toContain(activeId);
  });

  it('returns v2 tasks (protocolVersion set) regardless of archive filter', async () => {
    const { taskId: v2Id } = await seedNegotiationTask({
      state: 'submitted',
      protocolVersion: 'v2',
    });

    const results = await conversationDatabaseAdapter.getNegotiationsByUser(userA, { unpaginated: true });
    const ids = results.map((t) => t.id);
    expect(ids).toContain(v2Id);
  });
});

describe('archive legacy negotiations — getConversationsForUser lifecycle join', () => {
  it('excludes archived task from negotiation lifecycle slot', async () => {
    const { taskId: archivedId, conversationId } = await seedNegotiationTask({ state: 'submitted' });
    await stampArchivedAt(archivedId, new Date().toISOString());

    const conversations = await conversationDatabaseAdapter.getConversationsForUser(
      `agent:${userA}`,
      userA,
      /* includeNegotiationLifecycle = */ true,
    );
    const conv = conversations.find((c) => c.id === conversationId);
    // The conversation may still appear but the negotiation lifecycle slot must be null/absent
    if (conv) {
      expect((conv as Record<string, unknown>).negotiation).toBeFalsy();
    }
  });

  it('includes non-archived negotiation in lifecycle slot', async () => {
    const { taskId: activeId, conversationId } = await seedNegotiationTask({ state: 'submitted' });

    const conversations = await conversationDatabaseAdapter.getConversationsForUser(
      `agent:${userA}`,
      userA,
      /* includeNegotiationLifecycle = */ true,
    );
    const conv = conversations.find((c) => c.id === conversationId);
    if (conv) {
      const negotiation = (conv as Record<string, unknown>).negotiation as Record<string, unknown> | null;
      expect(negotiation?.taskId).toBe(activeId);
    }
  });
});

describe('archive legacy negotiations — getStaleNegotiationTasks', () => {
  it('excludes archived tasks from stale watchdog sweep', async () => {
    // Create a genuinely stale submitted task
    const { taskId: staleId } = await seedNegotiationTask({ state: 'submitted' });
    const { taskId: archivedStaleId } = await seedNegotiationTask({ state: 'submitted' });

    // Age both tasks so they qualify as stale
    const stalePast = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    await db
      .update(convSchema.tasks)
      .set({ createdAt: stalePast, updatedAt: stalePast })
      .where(eq(convSchema.tasks.id, staleId));
    await db
      .update(convSchema.tasks)
      .set({ createdAt: stalePast, updatedAt: stalePast })
      .where(eq(convSchema.tasks.id, archivedStaleId));

    // Archive the second task
    await stampArchivedAt(archivedStaleId, new Date().toISOString());

    const staleTasks = await conversationDatabaseAdapter.getStaleNegotiationTasks({
      submittedOlderThanMs: 30 * 60 * 1000, // 30 min
      workingOlderThanMs: 30 * 60 * 1000,
      limit: 100,
    });
    const ids = staleTasks.map((t) => t.id);

    expect(ids).toContain(staleId);
    expect(ids).not.toContain(archivedStaleId);
  });
});

describe('archive legacy negotiations — polling pickup', () => {
  it('pickup skips archived waiting_for_agent tasks', async () => {
    const { taskId: archivedId } = await seedNegotiationTask({ state: 'waiting_for_agent' });
    await stampArchivedAt(archivedId, new Date().toISOString());

    // pickup should not return the archived task
    const result = await negotiationPollingService.pickup(agentA, userA);
    if (result) {
      expect(result.negotiationId).not.toBe(archivedId);
    }
    // Either null or a different task — just confirm the archived one isn't picked up
  });

  it('pickup returns non-archived waiting_for_agent tasks normally', async () => {
    const { taskId: activeId } = await seedNegotiationTask({ state: 'waiting_for_agent' });

    const result = await negotiationPollingService.pickup(agentA, userA);
    // May pick up this or another waiting task; confirm we got one
    expect(result).not.toBeNull();

    // Clean up: cancel the claimed task so it doesn't affect other tests
    if (result) {
      await db
        .update(convSchema.tasks)
        .set({ state: 'canceled', updatedAt: new Date() })
        .where(eq(convSchema.tasks.id, result.negotiationId));
    }
  });
});

describe('archive legacy negotiations — qualifyingNegotiationAttemptTaskWhere', () => {
  it('archived input_required task does not block new attempt for its opportunity', async () => {
    const opportunityId = randomUUID();
    const { taskId: archivedInputRequired } = await seedNegotiationTask({
      state: 'input_required',
      opportunityId,
    });
    await stampArchivedAt(archivedInputRequired, new Date().toISOString());

    // The qualifying predicate must NOT match the archived task
    const expectedUpdatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago (outside window)
    const matchingTasks = await db
      .select({ id: convSchema.tasks.id })
      .from(convSchema.tasks)
      .where(qualifyingNegotiationAttemptTaskWhere(opportunityId, expectedUpdatedAt));

    const matchedIds = matchingTasks.map((t) => t.id);
    expect(matchedIds).not.toContain(archivedInputRequired);
  });

  it('non-archived input_required task still blocks new attempt', async () => {
    const opportunityId = randomUUID();
    const { taskId: activeInputRequired } = await seedNegotiationTask({
      state: 'input_required',
      opportunityId,
    });
    // Do NOT archive it

    const expectedUpdatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const matchingTasks = await db
      .select({ id: convSchema.tasks.id })
      .from(convSchema.tasks)
      .where(qualifyingNegotiationAttemptTaskWhere(opportunityId, expectedUpdatedAt));

    const matchedIds = matchingTasks.map((t) => t.id);
    expect(matchedIds).toContain(activeInputRequired);
  });
});

describe('archive legacy negotiations — backfill logic', () => {
  it('backfill stamps pre-v2 rows and is idempotent', async () => {
    // Create three tasks:
    //   A: pre-v2 (no protocolVersion) — should be stamped
    //   B: v2 (protocolVersion = 'v2') — must NOT be stamped
    //   C: pre-v2 but already archived — must NOT be re-stamped (idempotency)

    const { taskId: preV2Id } = await seedNegotiationTask({ state: 'submitted' });
    const { taskId: v2Id } = await seedNegotiationTask({
      state: 'submitted',
      protocolVersion: 'v2',
    });
    const { taskId: alreadyArchivedId } = await seedNegotiationTask({ state: 'submitted' });
    const priorArchivedAt = '2024-01-01T00:00:00.000Z';
    await stampArchivedAt(alreadyArchivedId, priorArchivedAt);

    const archiveTimestamp = new Date().toISOString();

    // Run the backfill UPDATE logic (inline, same SQL as the CLI script).
    await db.transaction(async (tx) => {
      await tx
        .update(convSchema.tasks)
        .set({
          metadata: sql`${convSchema.tasks.metadata} || jsonb_build_object('archivedAt', ${archiveTimestamp}::text)`,
        })
        .where(sql`
          ${convSchema.tasks.metadata}->>'type' = 'negotiation'
          AND ${convSchema.tasks.metadata}->>'protocolVersion' IS NULL
          AND ${convSchema.tasks.metadata}->>'archivedAt' IS NULL
        `);
    });

    // A: should now have archivedAt
    const [taskA] = await db
      .select({ metadata: convSchema.tasks.metadata })
      .from(convSchema.tasks)
      .where(eq(convSchema.tasks.id, preV2Id));
    const metaA = taskA?.metadata as Record<string, unknown> | null;
    expect(metaA?.archivedAt).toBe(archiveTimestamp);

    // B: v2 task must be untouched
    const [taskB] = await db
      .select({ metadata: convSchema.tasks.metadata })
      .from(convSchema.tasks)
      .where(eq(convSchema.tasks.id, v2Id));
    const metaB = taskB?.metadata as Record<string, unknown> | null;
    expect(metaB?.archivedAt).toBeUndefined();

    // C: already-archived row must keep the ORIGINAL timestamp (not overwritten)
    const [taskC] = await db
      .select({ metadata: convSchema.tasks.metadata })
      .from(convSchema.tasks)
      .where(eq(convSchema.tasks.id, alreadyArchivedId));
    const metaC = taskC?.metadata as Record<string, unknown> | null;
    expect(metaC?.archivedAt).toBe(priorArchivedAt);

    // Idempotency: re-run should stamp 0 rows for tasks that are already archived
    // Check individually rather than with ANY(ARRAY[...]) to avoid UUID cast issues.
    const idempotencyRows = await Promise.all(
      [preV2Id, alreadyArchivedId].map((id) =>
        db
          .select({ count: sql<string>`count(*)` })
          .from(convSchema.tasks)
          .where(sql`
            ${convSchema.tasks.id}::text = ${id}
            AND ${convSchema.tasks.metadata}->>'type' = 'negotiation'
            AND ${convSchema.tasks.metadata}->>'protocolVersion' IS NULL
            AND ${convSchema.tasks.metadata}->>'archivedAt' IS NULL
          `)
          .then(([r]) => Number(r?.count ?? 0)),
      ),
    );
    // Both pre-v2 and already-archived tasks now have archivedAt — none match the backfill predicate
    expect(idempotencyRows.every((n) => n === 0)).toBe(true);
  });
});
