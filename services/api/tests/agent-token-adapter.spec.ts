import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

import { agentTokenAdapter } from '../src/adapters/agent-token.adapter';
import db from '../src/lib/drizzle/drizzle';
import { agents, apikeys, users } from '../src/schemas/database.schema';

describe('agentTokenAdapter.revokeAllForAgent', () => {
  let userId = '';
  let agentId = '';
  let otherAgentId = '';

  beforeAll(async () => {
    const email = `test-revoke-${randomUUID()}@example.com`;
    const [u] = await db.insert(users).values({ email, name: 'Revoke Test', emailVerified: true, isGhost: false }).returning({ id: users.id });
    userId = u.id;
    const [a] = await db.insert(agents).values({ ownerId: userId, name: 'Agent A', type: 'personal' }).returning({ id: agents.id });
    agentId = a.id;
    const [b] = await db.insert(agents).values({ ownerId: userId, name: 'Agent B', type: 'personal' }).returning({ id: agents.id });
    otherAgentId = b.id;
  });

  afterAll(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, userId));
    await db.delete(agents).where(eq(agents.ownerId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  it('deletes only api keys whose metadata.agentId matches', async () => {
    await agentTokenAdapter.create(userId, { name: 'k1', agentId });
    await agentTokenAdapter.create(userId, { name: 'k2', agentId });
    await agentTokenAdapter.create(userId, { name: 'other', agentId: otherAgentId });

    const removed = await agentTokenAdapter.revokeAllForAgent(agentId);
    expect(removed).toBe(2);

    const remaining = await db
      .select({ id: apikeys.id, metadata: apikeys.metadata })
      .from(apikeys)
      .where(eq(apikeys.userId, userId));
    expect(remaining.length).toBe(1);
    const meta = JSON.parse(remaining[0].metadata as unknown as string) as { agentId: string };
    expect(meta.agentId).toBe(otherAgentId);
  });

  it('returns 0 when no tokens exist for the agent', async () => {
    const removed = await agentTokenAdapter.revokeAllForAgent(agentId);
    expect(removed).toBe(0);
  });

  it('uses jsonb cast and is not vulnerable to SQL injection through agentId', async () => {
    await agentTokenAdapter.create(userId, { name: 'k', agentId });
    const malicious = `${agentId}' OR '1'='1`;
    const removed = await agentTokenAdapter.revokeAllForAgent(malicious);
    expect(removed).toBe(0);
    const stillThere = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(sql`(${apikeys.metadata})::jsonb->>'agentId' = ${agentId}`);
    expect(stillThere.length).toBe(1);
    await agentTokenAdapter.revokeAllForAgent(agentId);
  });
});
