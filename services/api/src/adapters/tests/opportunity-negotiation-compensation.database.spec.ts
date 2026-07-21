import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq, inArray, sql } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { ConversationDatabaseAdapter, createNegotiationTaskForAttemptInTransaction, type CreateNegotiationTaskForAttemptInput } from '../conversation.database.adapter';
import { OpportunityDatabaseAdapter, compensateTasklessNegotiatingOpportunityInTransaction } from '../opportunity.database.adapter';
import { conversations, networkMembers, networks, opportunities, tasks, users } from '../../schemas/database.schema';

setDefaultTimeout(30_000);

const adapter = new OpportunityDatabaseAdapter();
const conversationAdapter = new ConversationDatabaseAdapter();
const createdOpportunityIds: string[] = [];
const createdConversationIds: string[] = [];
const createdNetworkIds: string[] = [];
const createdUserIds: string[] = [];

async function createNegotiatingOpportunity(
  actors?: Array<{ userId: string; networkId: string; role: 'patient' | 'agent' }>,
  status: 'latent' | 'draft' | 'pending' | 'negotiating' = 'negotiating',
) {
  const opportunity = await adapter.createOpportunity({
    detection: {
      source: 'opportunity_graph',
      timestamp: new Date().toISOString(),
    },
    actors: actors ?? [
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'patient' },
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Compensation integration fixture',
      confidence: 0.8,
      signals: [],
    },
    context: {},
    confidence: '0.8',
    status,
  });
  createdOpportunityIds.push(opportunity.id);
  return opportunity;
}

async function createAttemptInput(
  opportunity: Awaited<ReturnType<typeof createNegotiatingOpportunity>>,
): Promise<CreateNegotiationTaskForAttemptInput> {
  const [conversation] = await db.insert(conversations).values({}).returning();
  createdConversationIds.push(conversation.id);
  return {
    conversationId: conversation.id,
    opportunityId: opportunity.id,
    expectedStatus: opportunity.status,
    expectedUpdatedAt: opportunity.updatedAt,
    metadata: {
      type: 'negotiation',
      opportunityId: opportunity.id,
      sourceUserId: opportunity.actors[0]?.userId,
      candidateUserId: opportunity.actors[1]?.userId,
      networkId: opportunity.actors[0]?.networkId,
      intentSnapshots: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function currentBackendPid(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<number> {
  const rows = await tx.execute(sql`SELECT pg_backend_pid()::int AS pid`);
  return Number((rows as unknown as Array<{ pid: number }>)[0]?.pid);
}

async function waitForAdvisoryWaiter(holderPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM pg_locks holder
      JOIN pg_locks waiter
        ON waiter.locktype = holder.locktype
       AND waiter.database IS NOT DISTINCT FROM holder.database
       AND waiter.classid IS NOT DISTINCT FROM holder.classid
       AND waiter.objid IS NOT DISTINCT FROM holder.objid
       AND waiter.objsubid IS NOT DISTINCT FROM holder.objsubid
      WHERE holder.pid = ${holderPid}
        AND holder.locktype = 'advisory'
        AND holder.granted = true
        AND waiter.pid <> holder.pid
        AND waiter.granted = false
    `);
    const count = Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0);
    if (count > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for an advisory-lock waiter behind backend ${holderPid}`);
}

async function createNetworkEligibleNegotiatingOpportunity() {
  const ownerUserId = crypto.randomUUID();
  const candidateUserId = crypto.randomUUID();
  const networkId = crypto.randomUUID();
  createdUserIds.push(ownerUserId, candidateUserId);
  createdNetworkIds.push(networkId);
  await db.insert(users).values([
    { id: ownerUserId, email: `${ownerUserId}@test.local`, name: 'Compensation owner' },
    { id: candidateUserId, email: `${candidateUserId}@test.local`, name: 'Compensation candidate' },
  ]);
  await db.insert(networks).values({ id: networkId, title: 'Compensation network' });
  await db.insert(networkMembers).values([
    { networkId, userId: ownerUserId, permissions: ['owner'] },
    { networkId, userId: candidateUserId, permissions: ['member'] },
  ]);
  const opportunity = await adapter.createOpportunity({
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    actors: [
      { userId: ownerUserId, networkId, role: 'patient' },
      { userId: candidateUserId, networkId, role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'Network-eligible compensation fixture',
      confidence: 0.8,
      signals: [],
    },
    context: { networkId },
    confidence: '0.8',
    status: 'negotiating',
  });
  createdOpportunityIds.push(opportunity.id);
  return { opportunity, ownerUserId, networkId };
}

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await db.delete(conversations).where(inArray(conversations.id, createdConversationIds));
  }
  if (createdOpportunityIds.length > 0) {
    await db.delete(opportunities).where(inArray(opportunities.id, createdOpportunityIds));
  }
  if (createdNetworkIds.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.networkId, createdNetworkIds));
    await db.delete(networks).where(inArray(networks.id, createdNetworkIds));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
});

describe('OpportunityDatabaseAdapter.compensateTasklessNegotiatingOpportunity', () => {
  test('restores the exact taskless negotiating version to draft', async () => {
    const opportunity = await createNegotiatingOpportunity();

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );

    const [raw] = await db
      .select({ acceptedBy: opportunities.acceptedBy })
      .from(opportunities)
      .where(eq(opportunities.id, opportunity.id));

    expect(compensated).not.toBeNull();
    expect(compensated?.status).toBe('draft');
    expect(raw.acceptedBy).toBeNull();
  });

  test('returns null and preserves a newer status/version', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const newerUpdatedAt = new Date(opportunity.updatedAt.getTime() + 1_000);
    await db
      .update(opportunities)
      .set({ status: 'pending', updatedAt: newerUpdatedAt })
      .where(eq(opportunities.id, opportunity.id));

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('pending');
    expect(preserved?.updatedAt.getTime()).toBe(newerUpdatedAt.getTime());
  });

  test('network-eligible reactivation does not overwrite concurrent status drift', async () => {
    const { opportunity, ownerUserId, networkId } = await createNetworkEligibleNegotiatingOpportunity();
    await adapter.updateOpportunityStatus(opportunity.id, 'rejected');

    const reactivated = await adapter.updateOpportunityStatusIfNetworkEligible(
      opportunity.id,
      'negotiating',
      opportunity.actors,
      { ownerUserId, allowedNetworkIds: [networkId] },
      'negotiating',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(reactivated).toBeNull();
    expect(preserved?.status).toBe('rejected');
  });

  test('returns null when an active negotiation task predates the attempt boundary', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      state: 'input_required',
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: new Date(opportunity.updatedAt.getTime() - 1_000),
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('negotiating');
  });

  test('allows compensation when the only working task is stale', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    const staleAt = new Date(opportunity.updatedAt.getTime() - 10 * 60 * 1000);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      state: 'working',
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: staleAt,
      updatedAt: staleAt,
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );

    expect(compensated?.status).toBe('draft');
  });

  test('returns null when a negotiation task was created after the attempt boundary', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const [conversation] = await db.insert(conversations).values({}).returning();
    createdConversationIds.push(conversation.id);
    await db.insert(tasks).values({
      conversationId: conversation.id,
      metadata: { type: 'negotiation', opportunityId: opportunity.id },
      createdAt: new Date(opportunity.updatedAt.getTime() + 1_000),
    });

    const compensated = await adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('negotiating');
  });

  test('atomically promotes an exact latent attempt and creates one task', async () => {
    const opportunity = await createNegotiatingOpportunity(undefined, 'latent');
    const input = await createAttemptInput(opportunity);

    const task = await conversationAdapter.createNegotiationTaskForAttempt(input);
    const promoted = await adapter.getOpportunity(opportunity.id);
    const persistedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);

    expect(task).not.toBeNull();
    expect(promoted?.status).toBe('negotiating');
    expect(persistedTasks).toHaveLength(1);
  });

  test('rolls back the latent promotion when task insertion fails', async () => {
    const opportunity = await createNegotiatingOpportunity(undefined, 'latent');
    const input = await createAttemptInput(opportunity);
    input.conversationId = crypto.randomUUID();

    await expect(conversationAdapter.createNegotiationTaskForAttempt(input)).rejects.toThrow();

    const preserved = await adapter.getOpportunity(opportunity.id);
    const persistedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);

    expect(preserved?.status).toBe('latent');
    expect(preserved?.updatedAt.getTime()).toBe(opportunity.updatedAt.getTime());
    expect(persistedTasks).toHaveLength(0);
  });

  test('waits behind task creation, then preserves negotiating with the committed task', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const input = await createAttemptInput(opportunity);
    const releaseWinner = deferred<void>();
    const winnerReady = deferred<number>();

    const taskWinner = db.transaction(async (tx) => {
      const task = await createNegotiationTaskForAttemptInTransaction(tx, input);
      winnerReady.resolve(await currentBackendPid(tx));
      await releaseWinner.promise;
      return task;
    });

    const holderPid = await winnerReady.promise;
    const compensation = adapter.compensateTasklessNegotiatingOpportunity(
      opportunity.id,
      opportunity.updatedAt,
      'draft',
    );

    try {
      await waitForAdvisoryWaiter(holderPid);
    } finally {
      releaseWinner.resolve();
    }

    const [createdTask, compensated] = await Promise.all([taskWinner, compensation]);
    const preserved = await adapter.getOpportunity(opportunity.id);
    const persistedTasks = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, createdTask?.id ?? ''));

    expect(createdTask).not.toBeNull();
    expect(compensated).toBeNull();
    expect(preserved?.status).toBe('negotiating');
    expect(persistedTasks).toHaveLength(1);
  });

  test('compensation wins the shared lock and late task creation fails closed', async () => {
    const opportunity = await createNegotiatingOpportunity();
    const input = await createAttemptInput(opportunity);
    const releaseWinner = deferred<void>();
    const winnerReady = deferred<number>();

    const compensationWinner = db.transaction(async (tx) => {
      const compensated = await compensateTasklessNegotiatingOpportunityInTransaction(
        tx,
        opportunity.id,
        opportunity.updatedAt,
        'draft',
      );
      winnerReady.resolve(await currentBackendPid(tx));
      await releaseWinner.promise;
      return compensated;
    });

    const holderPid = await winnerReady.promise;
    const lateTask = conversationAdapter.createNegotiationTaskForAttempt(input);

    try {
      await waitForAdvisoryWaiter(holderPid);
    } finally {
      releaseWinner.resolve();
    }

    const [compensated, createdTask] = await Promise.all([compensationWinner, lateTask]);
    const preserved = await adapter.getOpportunity(opportunity.id);
    const persistedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);

    expect(compensated?.status).toBe('draft');
    expect(createdTask).toBeNull();
    expect(preserved?.status).toBe('draft');
    expect(persistedTasks).toHaveLength(0);
  });

  test('pair-global claim allows at most one active task across trigger-specific opportunities', async () => {
    const actors = [
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'patient' as const },
      { userId: crypto.randomUUID(), networkId: crypto.randomUUID(), role: 'agent' as const },
    ];
    const firstOpportunity = await createNegotiatingOpportunity(actors, 'latent');
    const secondOpportunity = await createNegotiatingOpportunity(actors, 'latent');
    const firstInput = await createAttemptInput(firstOpportunity);
    const secondInput = await createAttemptInput(secondOpportunity);

    const [firstTask, secondTask] = await Promise.all([
      conversationAdapter.createNegotiationTaskForAttempt(firstInput),
      conversationAdapter.createNegotiationTaskForAttempt(secondInput),
    ]);

    expect([firstTask, secondTask].filter(Boolean)).toHaveLength(1);
    const persisted = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' IN (${firstOpportunity.id}, ${secondOpportunity.id})`);
    const opportunityStates = await db
      .select({ id: opportunities.id, status: opportunities.status })
      .from(opportunities)
      .where(inArray(opportunities.id, [firstOpportunity.id, secondOpportunity.id]));
    expect(persisted).toHaveLength(1);
    expect(opportunityStates.filter(({ status }) => status === 'negotiating')).toHaveLength(1);
    expect(opportunityStates.filter(({ status }) => status === 'latent')).toHaveLength(1);
  });

  test('status-drifted task creation fails closed at the same version', async () => {
    const opportunity = await createNegotiatingOpportunity(undefined, 'latent');
    const input = await createAttemptInput(opportunity);
    await db
      .update(opportunities)
      .set({ status: 'draft', updatedAt: opportunity.updatedAt })
      .where(eq(opportunities.id, opportunity.id));

    const createdTask = await conversationAdapter.createNegotiationTaskForAttempt(input);
    const preserved = await adapter.getOpportunity(opportunity.id);
    const persistedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);

    expect(createdTask).toBeNull();
    expect(preserved?.status).toBe('draft');
    expect(preserved?.updatedAt.getTime()).toBe(opportunity.updatedAt.getTime());
    expect(persistedTasks).toHaveLength(0);
  });

  test('stale task creation fails closed after a newer opportunity version', async () => {
    const opportunity = await createNegotiatingOpportunity(undefined, 'latent');
    const input = await createAttemptInput(opportunity);
    const newerUpdatedAt = new Date(opportunity.updatedAt.getTime() + 1_000);
    await db
      .update(opportunities)
      .set({ updatedAt: newerUpdatedAt })
      .where(eq(opportunities.id, opportunity.id));

    const createdTask = await conversationAdapter.createNegotiationTaskForAttempt(input);
    const persistedTasks = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(sql`${tasks.metadata}->>'opportunityId' = ${opportunity.id}`);
    const preserved = await adapter.getOpportunity(opportunity.id);

    expect(createdTask).toBeNull();
    expect(preserved?.status).toBe('latent');
    expect(preserved?.updatedAt.getTime()).toBe(newerUpdatedAt.getTime());
    expect(persistedTasks).toHaveLength(0);
  });
});
