/**
 * IND-397 — polling respond/pickup seat rules (DB-backed).
 *
 * Covers:
 * - full v2 flow via respond: outreach → counter → counter → accept
 *   (counterparty) → task completed + opportunity `pending`,
 * - withdraw (initiator) → `rejected`; decline (counterparty) → `rejected`,
 * - wrong-seat action → SeatViolationError (HTTP 400 via agent.controller),
 *   with the claim left intact for a retry,
 * - seat/turn attribution from senderId + initiator stamp, not parity
 *   (continuation where the counterparty spoke first),
 * - pickup announces seat, protocolVersion, and allowedActions,
 * - v1 grandfathering: legacy propose/reject stay valid.
 *
 * Real Postgres via .env.test; BullMQ queues mocked (no Redis).
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

const { negotiationPollingService, SeatViolationError, ConflictError } = await import('../negotiation-polling.service');
const { conversationDatabaseAdapter } = await import('../../adapters/database.adapter');
const { default: db } = await import('../../lib/drizzle/drizzle');
const dbSchema = await import('../../schemas/database.schema');
const convSchema = await import('../../schemas/conversation.schema');
const { eq } = await import('drizzle-orm');

afterAll(() => {
  mock.restore();
});

let userA: string; // initiator
let userB: string; // counterparty
let agentA: string;
let agentB: string;
const cleanupConversations: string[] = [];
const cleanupOpportunities: string[] = [];

async function seedUser(name: string): Promise<string> {
  const [u] = await db.insert(dbSchema.users)
    .values({ email: `seat-spec-${randomUUID()}@test.local`, name })
    .returning({ id: dbSchema.users.id });
  return u.id;
}

async function seedAgent(ownerId: string): Promise<string> {
  const [a] = await db.insert(dbSchema.agents)
    .values({ ownerId, name: 'seat-spec-agent', type: 'external' })
    .returning({ id: dbSchema.agents.id });
  return a.id;
}

async function seedOpportunity(): Promise<string> {
  const [o] = await db.insert(dbSchema.opportunities)
    .values({
      detection: { kind: 'test', summary: 'seat spec' } as never,
      actors: [{ userId: userA, role: 'peer' }, { userId: userB, role: 'peer' }] as never,
      interpretation: { reasoning: 'seat spec', category: 'test' } as never,
      context: {} as never,
      confidence: '0.9',
      status: 'negotiating',
    })
    .returning({ id: dbSchema.opportunities.id });
  cleanupOpportunities.push(o.id);
  return o.id;
}

async function seedNegotiation(opts?: {
  protocolVersion?: 'v1' | 'v2';
  opportunityId?: string;
  priorTurns?: Array<{ from: 'A' | 'B'; action: string }>;
  maxTurns?: number;
}): Promise<{ taskId: string; conversationId: string }> {
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
    ...(opts?.protocolVersion && { protocolVersion: opts.protocolVersion }),
    ...(opts?.opportunityId && { opportunityId: opts.opportunityId }),
    maxTurns: opts?.maxTurns ?? 6,
  });

  for (const t of opts?.priorTurns ?? []) {
    await conversationDatabaseAdapter.createMessage({
      conversationId: conv.id,
      senderId: `agent:${t.from === 'A' ? userA : userB}`,
      role: 'agent',
      parts: [{ kind: 'data', data: { action: t.action, assessment: { reasoning: 'r', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } }, message: null } }],
      taskId: task.id,
    });
  }

  await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');
  return { taskId: task.id, conversationId: conv.id };
}

async function getTaskState(taskId: string) {
  const task = await conversationDatabaseAdapter.getTask(taskId);
  return task?.state;
}

async function getOpportunityStatus(id: string): Promise<string | undefined> {
  const [row] = await db.select({ status: dbSchema.opportunities.status })
    .from(dbSchema.opportunities)
    .where(eq(dbSchema.opportunities.id, id))
    .limit(1);
  return row?.status;
}

const respondInput = (action: string, message?: string) => ({
  action: action as never,
  message: message ?? null,
  assessment: { reasoning: 'because', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } },
});

/** Claim the parked turn for a specific user's agent (pickup is user-scoped). */
async function claimFor(taskId: string, who: 'A' | 'B') {
  // Force-claim the specific task to keep tests independent of other parked
  // tasks these users may have from parallel test data.
  const now = new Date();
  const agentId = who === 'A' ? agentA : agentB;
  const [claimed] = await db.update(convSchema.tasks)
    .set({ state: 'claimed', claimedByAgentId: agentId, claimedAt: now, updatedAt: now })
    .where(eq(convSchema.tasks.id, taskId))
    .returning();
  expect(claimed?.state).toBe('claimed');
}

beforeAll(async () => {
  userA = await seedUser('Seat Spec Initiator');
  userB = await seedUser('Seat Spec Counterparty');
  agentA = await seedAgent(userA);
  agentB = await seedAgent(userB);
});

afterAll(async () => {
  for (const id of cleanupConversations) {
    try { await conversationDatabaseAdapter.deleteConversation(id); } catch { /* ignore */ }
  }
  for (const id of cleanupOpportunities) {
    try { await db.delete(dbSchema.opportunities).where(eq(dbSchema.opportunities.id, id)); } catch { /* ignore */ }
  }
  try { await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userA)); } catch { /* ignore */ }
  try { await db.delete(dbSchema.users).where(eq(dbSchema.users.id, userB)); } catch { /* ignore */ }
});

describe('pickup — seat announcement', () => {
  it('announces seat, protocolVersion, and allowedActions for the claiming user', async () => {
    const { taskId } = await seedNegotiation({ protocolVersion: 'v2' });
    const result = await negotiationPollingService.pickup(agentA, userA);

    expect(result).not.toBeNull();
    expect(result!.taskId).toBe(taskId);
    expect(result!.seat).toBe('initiator');
    expect(result!.protocolVersion).toBe('v2');
    expect(result!.allowedActions).toEqual(['outreach', 'counter', 'question', 'withdraw']);
    expect(result!.allowedActions).not.toContain('accept');

    // Idempotent repick returns the same announcement
    const again = await negotiationPollingService.pickup(agentA, userA);
    expect(again!.seat).toBe('initiator');

    // Finish the flow so this task doesn't linger claimed
    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('withdraw'));
    expect(await getTaskState(taskId)).toBe('completed');
  }, 30_000);
});

describe('respond — v2 seat validation', () => {
  it('initiator accept → SeatViolationError; claim stays intact and a valid retry succeeds', async () => {
    const { taskId } = await seedNegotiation({ protocolVersion: 'v2' });
    await claimFor(taskId, 'A');

    expect(
      negotiationPollingService.respond(agentA, userA, taskId, respondInput('accept')),
    ).rejects.toThrow(SeatViolationError);

    // The claim survives the violation — the agent can retry with a valid action
    expect(await getTaskState(taskId)).toBe('claimed');
    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('outreach'));
    expect(await getTaskState(taskId)).toBe('waiting_for_agent');
  }, 30_000);

  it('v2 vocabulary on a v1 task is rejected; legacy vocabulary passes (grandfather)', async () => {
    const { taskId } = await seedNegotiation({}); // no protocolVersion → v1
    await claimFor(taskId, 'A');

    expect(
      negotiationPollingService.respond(agentA, userA, taskId, respondInput('outreach')),
    ).rejects.toThrow(SeatViolationError);

    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('propose'));
    expect(await getTaskState(taskId)).toBe('waiting_for_agent');

    // Legacy reject from the other side still finalizes
    await claimFor(taskId, 'B');
    await negotiationPollingService.respond(agentB, userB, taskId, respondInput('reject'));
    expect(await getTaskState(taskId)).toBe('completed');
  }, 30_000);
});

describe('respond — full v2 flows', () => {
  it('outreach → counter → counter → accept (counterparty) → completed + opportunity pending', async () => {
    const opportunityId = await seedOpportunity();
    const { taskId, conversationId } = await seedNegotiation({ protocolVersion: 'v2', opportunityId });

    await claimFor(taskId, 'A');
    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('outreach', 'let us connect'));

    await claimFor(taskId, 'B');
    await negotiationPollingService.respond(agentB, userB, taskId, respondInput('counter', 'tell me more'));

    await claimFor(taskId, 'A');
    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('counter', 'here is more'));

    await claimFor(taskId, 'B');
    await negotiationPollingService.respond(agentB, userB, taskId, respondInput('accept'));

    expect(await getTaskState(taskId)).toBe('completed');
    expect(await getOpportunityStatus(opportunityId)).toBe('pending');

    // Message attribution follows the actual speakers
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(conversationId);
    expect(messages.map((m) => m.senderId)).toEqual([
      `agent:${userA}`, `agent:${userB}`, `agent:${userA}`, `agent:${userB}`,
    ]);

    // Outcome artifact records the opportunity
    const artifacts = await conversationDatabaseAdapter.getArtifactsForTask(taskId);
    const outcome = (artifacts.find((a) => a.name === 'negotiation-outcome')?.parts as Array<{ data?: { hasOpportunity?: boolean } }>)?.find((p) => p.data)?.data;
    expect(outcome?.hasOpportunity).toBe(true);
  }, 60_000);

  it('initiator withdraw → completed + opportunity rejected', async () => {
    const opportunityId = await seedOpportunity();
    const { taskId } = await seedNegotiation({
      protocolVersion: 'v2',
      opportunityId,
      priorTurns: [{ from: 'A', action: 'outreach' }, { from: 'B', action: 'counter' }],
    });

    await claimFor(taskId, 'A');
    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('withdraw'));

    expect(await getTaskState(taskId)).toBe('completed');
    expect(await getOpportunityStatus(opportunityId)).toBe('rejected');
  }, 30_000);

  it('counterparty decline → completed + opportunity rejected', async () => {
    const opportunityId = await seedOpportunity();
    const { taskId } = await seedNegotiation({
      protocolVersion: 'v2',
      opportunityId,
      priorTurns: [{ from: 'A', action: 'outreach' }],
    });

    await claimFor(taskId, 'B');
    await negotiationPollingService.respond(agentB, userB, taskId, respondInput('decline'));

    expect(await getTaskState(taskId)).toBe('completed');
    expect(await getOpportunityStatus(opportunityId)).toBe('rejected');
  }, 30_000);
});

describe('respond — seat attribution is parity-proof', () => {
  it('continuation where the counterparty spoke first: initiator still cannot accept, and the turn is attributed to the actual caller', async () => {
    // One prior message from B → odd count. Parity-based attribution would
    // treat the next speaker as "candidate" (B) and stamp B's senderId on
    // A's turn. senderId+stamp-based logic must reject accept (initiator
    // seat) and attribute the turn to A.
    const { taskId, conversationId } = await seedNegotiation({
      protocolVersion: 'v2',
      priorTurns: [{ from: 'B', action: 'question' }],
    });

    await claimFor(taskId, 'A');
    expect(
      negotiationPollingService.respond(agentA, userA, taskId, respondInput('accept')),
    ).rejects.toThrow(SeatViolationError);

    await negotiationPollingService.respond(agentA, userA, taskId, respondInput('counter', 'answering your question'));

    const messages = await conversationDatabaseAdapter.getMessagesForConversation(conversationId);
    expect(messages[messages.length - 1].senderId).toBe(`agent:${userA}`);
  }, 30_000);
});

describe('respond — guards unchanged', () => {
  it('responding without a claim still conflicts (seat preflight does not bypass the CAS)', async () => {
    const { taskId } = await seedNegotiation({ protocolVersion: 'v2' });
    // waiting_for_agent, never claimed
    expect(
      negotiationPollingService.respond(agentA, userA, taskId, respondInput('outreach')),
    ).rejects.toThrow(ConflictError);
  }, 30_000);
});
