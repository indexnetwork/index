import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agentTestMessages, agents, users } from '../src/schemas/database.schema';
import { AgentTestMessageService } from '../src/services/agent-test-message.service';

describe('AgentTestMessageService', () => {
  const service = new AgentTestMessageService();
  let userId: string;
  let agentId: string;

  beforeEach(async () => {
    await db.delete(agentTestMessages);
    const [user] = await db.insert(users).values({ email: `test-${randomUUID()}@example.com`, name: 'Test User' }).returning();
    userId = user.id;
    const [agent] = await db.insert(agents).values({ ownerId: userId, name: 'test-agent', type: 'personal' }).returning();
    agentId = agent.id;
  });

  afterAll(async () => { await db.delete(agentTestMessages); });

  test('enqueue stores content for the agent', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    expect(id).toBeTruthy();
  });

  test('pickup returns nothing when none queued', async () => {
    const result = await service.pickup(agentId);
    expect(result).toBeNull();
  });

  test('pickup returns enqueued message + reservation token', async () => {
    await service.enqueue(agentId, userId, 'hello');
    const result = await service.pickup(agentId);
    expect(result?.content).toBe('hello');
    expect(result?.reservationToken).toBeTruthy();
  });

  test('pickup after confirm excludes already-delivered message', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    const picked = await service.pickup(agentId);
    await service.confirmDelivered(id, picked!.reservationToken);
    const next = await service.pickup(agentId);
    expect(next).toBeNull();
  });

  test('reservation expires after TTL', async () => {
    await service.enqueue(agentId, userId, 'hello');
    await service.pickup(agentId);
    await db.execute(sql`UPDATE agent_test_messages SET reserved_at = now() - interval '2 minutes'`);
    const next = await service.pickup(agentId);
    expect(next?.content).toBe('hello');
  });

  test('confirmDelivered with wrong token throws', async () => {
    const { id } = await service.enqueue(agentId, userId, 'hello');
    await service.pickup(agentId);
    await expect(service.confirmDelivered(id, randomUUID())).rejects.toThrow();
  });
});
