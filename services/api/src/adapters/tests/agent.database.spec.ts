/**
 * Integration tests for AgentDatabaseAdapter.
 *
 * Tests the touchLastSeen method which updates the agent's lastSeenAt timestamp.
 * Requires a live database connection.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { AgentDatabaseAdapter } from '../agent.database.adapter';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { eq } from 'drizzle-orm/sql';

describe('AgentDatabaseAdapter.touchLastSeen', () => {
  const adapter = new AgentDatabaseAdapter();
  let testAgentId: string;
  let testUserId: string;

  beforeAll(async () => {
    const [user] = await db.insert(schema.users).values({
      email: `heartbeat-test-${Date.now()}@test.local`,
      name: 'Heartbeat Test',
    }).returning({ id: schema.users.id });
    testUserId = user.id;

    const agent = await adapter.createAgent({
      ownerId: testUserId,
      name: 'Heartbeat Test Agent',
      type: 'external',
    });
    testAgentId = agent.id;
  });

  afterAll(async () => {
    await db.delete(schema.agents).where(eq(schema.agents.id, testAgentId));
    await db.delete(schema.users).where(eq(schema.users.id, testUserId));
  });

  it('sets lastSeenAt to now() when called', async () => {
    const before = new Date();
    await adapter.touchLastSeen(testAgentId);
    const after = new Date();

    const agent = await adapter.getAgent(testAgentId);
    expect(agent).not.toBeNull();
    expect(agent!.lastSeenAt).not.toBeNull();
    // Symmetric 1s tolerance so the test doesn't flake when the Postgres
    // server clock drifts slightly ahead of the Bun/Node process clock.
    expect(agent!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(agent!.lastSeenAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
  });

  it('updates lastSeenAt on repeated calls', async () => {
    await adapter.touchLastSeen(testAgentId);
    const first = (await adapter.getAgent(testAgentId))!.lastSeenAt!;
    await new Promise((r) => setTimeout(r, 50));
    await adapter.touchLastSeen(testAgentId);
    const second = (await adapter.getAgent(testAgentId))!.lastSeenAt!;
    expect(second.getTime()).toBeGreaterThan(first.getTime());
  });

  it('is a no-op on unknown agent ids (does not throw)', async () => {
    await expect(adapter.touchLastSeen('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });
});

describe('AgentDatabaseAdapter.ensureNegotiatorAgent', () => {
  const adapter = new AgentDatabaseAdapter();
  const createdUserIds: string[] = [];

  const createUser = async (input: { name: string; isGhost?: boolean }) => {
    const [user] = await db.insert(schema.users).values({
      email: `negotiator-ensure-${crypto.randomUUID()}@test.local`,
      name: input.name,
      isGhost: input.isGhost ?? false,
    }).returning({ id: schema.users.id });
    createdUserIds.push(user.id);
    return user.id;
  };

  afterAll(async () => {
    for (const userId of createdUserIds) {
      await db.delete(schema.agents).where(eq(schema.agents.ownerId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  }, 30_000);

  it('creates a personal negotiator row named after the first name', async () => {
    const userId = await createUser({ name: 'Ada Lovelace' });
    const agentId = await adapter.ensureNegotiatorAgent(userId);
    expect(agentId).not.toBeNull();

    const agent = await adapter.getAgent(agentId!);
    expect(agent).not.toBeNull();
    expect(agent!.type).toBe('personal');
    expect(agent!.name).toBe("Ada's Negotiator");
    expect(agent!.handleNegotiations).toBe(false);
    expect(agent!.lastSeenAt).toBeNull();
  });

  it('falls back to a generic name when the user has no usable name', async () => {
    const userId = await createUser({ name: '  ' });
    const agentId = await adapter.ensureNegotiatorAgent(userId);
    expect(agentId).not.toBeNull();
    const agent = await adapter.getAgent(agentId!);
    expect(agent!.name).toBe('Your Negotiator');
  });

  it('is idempotent — repeat calls return the same row and never create a second', async () => {
    const userId = await createUser({ name: 'Grace Hopper' });
    const first = await adapter.ensureNegotiatorAgent(userId);
    const second = await adapter.ensureNegotiatorAgent(userId);
    expect(second).toBe(first);

    const rows = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.ownerId, userId));
    expect(rows.length).toBe(1);
  });

  it('skips ghost users', async () => {
    const userId = await createUser({ name: 'Ghost User', isGhost: true });
    const agentId = await adapter.ensureNegotiatorAgent(userId);
    expect(agentId).toBeNull();

    const rows = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(eq(schema.agents.ownerId, userId));
    expect(rows.length).toBe(0);
  });

  it('returns null for unknown users', async () => {
    const agentId = await adapter.ensureNegotiatorAgent('00000000-0000-0000-0000-00000000dead');
    expect(agentId).toBeNull();
  });

  it('excludes personal negotiator rows from listAgentsForUser (agents page)', async () => {
    const userId = await createUser({ name: 'Alan Turing' });
    await adapter.ensureNegotiatorAgent(userId);
    const poller = await adapter.createAgent({
      ownerId: userId,
      name: 'Poller Runtime',
      type: 'external',
    });

    const listed = await adapter.listAgentsForUser(userId);
    const listedIds = listed.map((a) => a.id);
    expect(listedIds).toContain(poller.id);
    expect(listed.every((a) => a.type !== 'personal')).toBe(true);
  }, 15_000);
});
