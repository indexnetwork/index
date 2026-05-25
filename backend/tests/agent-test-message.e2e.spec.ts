import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { AgentController } from '../src/controllers/agent.controller';
import db from '../src/lib/drizzle/drizzle';
import { agentTestMessages, agents, users } from '../src/schemas/database.schema';
import type { PickupResult } from '../src/services/agent-test-message.service';
import { agentService } from '../src/services/agent.service';

// ---------------------------------------------------------------------------
// Helpers — mirror the pattern from agent-test-message.controller.spec.ts
// ---------------------------------------------------------------------------

function makeRequest(body?: unknown, method = 'POST') {
  if (body === undefined) {
    return new Request('http://localhost/', { method });
  }
  return new Request('http://localhost/', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
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
let agentId: string;

let origGetById: typeof agentService.getById;

beforeAll(async () => {
  // Seed a real user + agent in the DB (same pattern as the service test)
  await db.delete(agentTestMessages);

  const [user] = await db
    .insert(users)
    .values({ email: `e2e-${randomUUID()}@example.com`, name: 'E2E Test User' })
    .returning();
  userId = user.id;

  const [agent] = await db
    .insert(agents)
    .values({ ownerId: userId, name: 'e2e-test-agent', type: 'personal' })
    .returning();
  agentId = agent.id;

  // Monkey-patch agentService.getById so the controller's ownership check passes
  // without needing full transport/permission resolution against the DB.
  origGetById = agentService.getById;
  agentService.getById = async () => ({}) as never;
});

afterAll(async () => {
  // Restore the real implementation
  agentService.getById = origGetById;

  // Clean up test data
  await db.delete(agentTestMessages);
  if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
  if (userId) await db.delete(users).where(eq(users.id, userId));
});

// ---------------------------------------------------------------------------
// End-to-end flow
// ---------------------------------------------------------------------------

describe('Agent test-message delivery — end-to-end (controller + real DB)', () => {
  let controller: AgentController;

  // We capture these across steps
  let messageId: string;
  let reservationToken: string;

  beforeAll(() => {
    controller = new AgentController();
  });

  test('Step A — enqueue: returns 201 with a message id', async () => {
    const res = await controller.enqueueTestMessage(
      makeRequest({ content: 'ping' }),
      makeUser(userId),
      makeParams({ id: agentId }),
    );

    expect(res.status).toBe(201);
    const json = await res.json() as { id: string };
    expect(json.id).toBeTruthy();
    messageId = json.id;
  });

  test('Step B — pickup: returns 200 with content and reservationToken', async () => {
    const res = await controller.pickupTestMessage(
      makeRequest(undefined, 'POST'),
      makeUser(userId),
      makeParams({ id: agentId }),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as PickupResult;
    expect(json.content).toBe('ping');
    expect(json.reservationToken).toBeTruthy();
    reservationToken = json.reservationToken;
  });

  test('Step C — confirm delivered: returns 200 with { ok: true }', async () => {
    const res = await controller.confirmTestMessageDelivered(
      makeRequest({ reservationToken }),
      makeUser(userId),
      makeParams({ id: agentId, messageId }),
    );

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  test('Step D — re-pickup after delivery: returns 204 (empty queue)', async () => {
    const res = await controller.pickupTestMessage(
      makeRequest(undefined, 'POST'),
      makeUser(userId),
      makeParams({ id: agentId }),
    );

    expect(res.status).toBe(204);
  });

  test('Step E — deliveredAt column is populated in DB', async () => {
    const rows = await db
      .select()
      .from(agentTestMessages)
      .where(eq(agentTestMessages.id, messageId));

    expect(rows).toHaveLength(1);
    expect(rows[0].deliveredAt).not.toBeNull();
  });
});
