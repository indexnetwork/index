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
import { eq } from 'drizzle-orm';

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
      type: 'personal',
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
