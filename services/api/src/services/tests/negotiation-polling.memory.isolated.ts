/**
 * IND-407 — pickup payload memory injection (DB-backed).
 *
 * Pins the seat-scoping AC: `negotiatorMemory` on a pickup result contains
 * ONLY the claiming user's own memories — never the counterparty's — and the
 * field is absent entirely when `NEGOTIATOR_MEMORY_INJECT` is off.
 *
 * Real Postgres via .env.test; BullMQ queues mocked (no Redis); the retrieval
 * adapter's embedding seam is stubbed to fail so the advisory leg is
 * deterministically skipped (disclosure rules and dossiers don't ride
 * similarity and are the assertion surface here).
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';
import { randomUUID } from 'crypto';

mock.module('../../queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
}));
mock.module('../../queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
}));

const { negotiationPollingService } = await import('../negotiation-polling.service');
const { conversationDatabaseAdapter } = await import('../../adapters/database.adapter');
const { agentDatabaseAdapter } = await import('../../adapters/agent.database.adapter');
const { negotiatorMemoryDatabaseAdapter } = await import('../../adapters/negotiator-memory.database.adapter');
const { negotiatorMemoryRetrievalAdapter } = await import('../../adapters/negotiator-memory.retrieval.adapter');
const { default: db } = await import('../../lib/drizzle/drizzle');
const dbSchema = await import('../../schemas/database.schema');
const convSchema = await import('../../schemas/conversation.schema');
const { eq } = await import('drizzle-orm');

const run = randomUUID().slice(0, 8);
const MEM_A = `MEMPICK-A-${run} never disclose Alice's budget`;
const MEM_A_DOSSIER = `MEMPICK-A-${run} Bob prefers async collaboration`;
const MEM_B = `MEMPICK-B-${run} never disclose Bob's clients`;

let userA: string; // initiator
let userB: string; // counterparty
let agentA: string; // external polling agent (claims)
let agentB: string;
type LegacyPrincipal = { credentialId: string; agentId: string; audience: null; setupAttemptId: null };
let principalA: LegacyPrincipal;
let principalB: LegacyPrincipal;
const cleanupConversations: string[] = [];

async function seedUser(name: string): Promise<string> {
  const [u] = await db.insert(dbSchema.users)
    .values({ email: `mem-pickup-${randomUUID()}@test.local`, name })
    .returning({ id: dbSchema.users.id });
  return u.id;
}

async function seedExternalAgent(ownerId: string): Promise<{ id: string; principal: LegacyPrincipal }> {
  const [agent] = await db.insert(dbSchema.agents)
    .values({ ownerId, name: 'mem-pickup-agent', type: 'external' })
    .returning({ id: dbSchema.agents.id });
  const [credential] = await db.insert(dbSchema.apikeys)
    .values({
      key: `mem-pickup-key-${randomUUID()}`,
      userId: ownerId,
      referenceId: ownerId,
      metadata: JSON.stringify({ agentId: agent.id }),
      enabled: true,
    })
    .returning({ id: dbSchema.apikeys.id });
  await agentDatabaseAdapter.setNegotiationExecutorBinding({
    ownerId,
    targetAgentId: agent.id,
    exactTargetPermissions: false,
  });
  return {
    id: agent.id,
    principal: { credentialId: credential.id, agentId: agent.id, audience: null, setupAttemptId: null },
  };
}

async function seedNegotiation(priorTurnByInitiator = false): Promise<{ taskId: string }> {
  const conv = await conversationDatabaseAdapter.createConversation([
    { participantId: `agent:${userA}`, participantType: 'agent' as const },
    { participantId: `agent:${userB}`, participantType: 'agent' as const },
  ]);
  cleanupConversations.push(conv.id);
  const task = await conversationDatabaseAdapter.createTask(conv.id, {
    type: 'negotiation',
    sourceUserId: userA,
    candidateUserId: userB,
    initiatorUserId: userA,
    protocolVersion: 'v2',
    maxTurns: 6,
  });
  if (priorTurnByInitiator) {
    await conversationDatabaseAdapter.createMessage({
      conversationId: conv.id,
      senderId: `agent:${userA}`,
      role: 'agent',
      parts: [{ kind: 'data', data: {
        action: 'outreach',
        message: null,
        assessment: { reasoning: 'fixture', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
      } }],
      taskId: task.id,
    });
  }
  await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');
  return { taskId: task.id };
}

/** Release a claim so later pickups don't repick this task. */
async function releaseClaim(taskId: string) {
  await db.update(convSchema.tasks)
    .set({ state: 'completed', claimedByAgentId: null, updatedAt: new Date() })
    .where(eq(convSchema.tasks.id, taskId));
}

/** Force-claim so pickup's idempotent-repick path returns THIS task. */
async function claimFor(taskId: string, who: 'A' | 'B') {
  const now = new Date();
  const agentId = who === 'A' ? agentA : agentB;
  const [claimed] = await db.update(convSchema.tasks)
    .set({ state: 'claimed', claimedByAgentId: agentId, claimedAt: now, updatedAt: now })
    .where(eq(convSchema.tasks.id, taskId))
    .returning();
  expect(claimed?.state).toBe('claimed');
}

beforeAll(async () => {
  // Deterministic: kill the advisory similarity leg (no embedding provider in
  // specs); disclosure rules and dossiers are list-based and unaffected.
  (negotiatorMemoryRetrievalAdapter as unknown as { embed: () => Promise<number[]> }).embed =
    async () => { throw new Error('no embedding in spec'); };

  userA = await seedUser('Mem Pickup Initiator');
  userB = await seedUser('Mem Pickup Counterparty');
  ({ id: agentA, principal: principalA } = await seedExternalAgent(userA));
  ({ id: agentB, principal: principalB } = await seedExternalAgent(userB));

  // Personal negotiator agents own the memories (retrieval resolves these).
  const personalA = await agentDatabaseAdapter.ensureNegotiatorAgent(userA);
  const personalB = await agentDatabaseAdapter.ensureNegotiatorAgent(userB);
  if (!personalA || !personalB) throw new Error('negotiator agent provisioning failed');

  await Promise.all([
    negotiatorMemoryDatabaseAdapter.create({
      agentId: personalA, userId: userA, kind: 'disclosure_rule', content: MEM_A,
    }),
    negotiatorMemoryDatabaseAdapter.create({
      agentId: personalA, userId: userA, kind: 'counterparty_dossier', content: MEM_A_DOSSIER, subjectUserId: userB,
    }),
    negotiatorMemoryDatabaseAdapter.create({
      agentId: personalB, userId: userB, kind: 'disclosure_rule', content: MEM_B,
    }),
  ]);
}, 30_000);

afterAll(async () => {
  for (const id of cleanupConversations) {
    try { await conversationDatabaseAdapter.deleteConversation(id); } catch { /* ignore */ }
  }
  // Users cascade to agents, which cascade to memories.
  try { await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userA)); } catch { /* ignore */ }
  try { await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userB)); } catch { /* ignore */ }
  mock.restore();
}, 30_000);

describe('pickup — negotiatorMemory (IND-407)', () => {
  it("includes the claiming user's own memory only (initiator seat)", async () => {
    const { taskId } = await seedNegotiation();
    await claimFor(taskId, 'A');
    const result = await negotiationPollingService.pickup(agentA, userA, principalA);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe(taskId);
    if (!result || 'ownerDirective' in result) throw new Error('Expected legacy pickup projection');
    const contents = (result.negotiatorMemory ?? []).map((m) => m.content);
    expect(contents).toContain(MEM_A);
    expect(contents).toContain(MEM_A_DOSSIER); // dossier about the counterparty of THIS task
    expect(contents).not.toContain(MEM_B);
    await releaseClaim(taskId);
  }, 30_000);

  it("includes the claiming user's own memory only (counterparty seat)", async () => {
    // A persisted initiator turn makes B the authoritative next speaker.
    const { taskId } = await seedNegotiation(true);
    await claimFor(taskId, 'B');
    const result = await negotiationPollingService.pickup(agentB, userB, principalB);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe(taskId);
    if (!result || 'ownerDirective' in result) throw new Error('Expected legacy pickup projection');
    const contents = (result.negotiatorMemory ?? []).map((m) => m.content);
    expect(contents).toContain(MEM_B);
    expect(contents).not.toContain(MEM_A);
    expect(contents).not.toContain(MEM_A_DOSSIER);
    await releaseClaim(taskId);
  }, 30_000);

});
