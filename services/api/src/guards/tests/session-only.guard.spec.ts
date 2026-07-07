import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { agentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../../adapters/agent-token.adapter';
import { SessionOnlyGuard, SessionRequiredError } from '../auth.guard';

describe('session-only.guard', () => {
  let userId: string;
  let validKey: string;

  beforeAll(async () => {
    const [u] = await db.insert(schema.users)
      .values({ email: `session-only-${Date.now()}@test.dev`, name: 'Session Only Test', emailVerified: true })
      .returning({ id: schema.users.id });
    userId = u.id;

    const agent = await agentDatabaseAdapter.createAgent({
      ownerId: userId, name: 'Session Only Agent', type: 'personal',
    });
    await agentDatabaseAdapter.grantPermission({
      agentId: agent.id, userId, scope: 'global',
      actions: ['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:opportunities'],
    });
    validKey = (await agentTokenAdapter.create(userId, { name: 'session-only', agentId: agent.id })).key;
  });

  afterAll(async () => {
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  test('rejects a VALID agent-bound API key with SessionRequiredError', async () => {
    const req = new Request('http://localhost/agents', { headers: { 'x-api-key': validKey } });
    await expect(SessionOnlyGuard(req)).rejects.toBeInstanceOf(SessionRequiredError);
  });

  test('rejects an arbitrary API key with SessionRequiredError (no key lookup)', async () => {
    const req = new Request('http://localhost/agents', { headers: { 'x-api-key': 'not-a-real-key' } });
    await expect(SessionOnlyGuard(req)).rejects.toBeInstanceOf(SessionRequiredError);
  });

  test('rejects a request with no credentials at all', async () => {
    await expect(SessionOnlyGuard(new Request('http://localhost/agents')))
      .rejects.toThrow('Access token required');
  });

  test('attempts JWT resolution for a Bearer header (invalid token rejected as JWT, not as API key)', async () => {
    const req = new Request('http://localhost/agents', { headers: { Authorization: 'Bearer bogus.jwt.token' } });
    await expect(SessionOnlyGuard(req)).rejects.toThrow('Invalid or expired access token');
  });

  test('attempts JWT resolution for a ?token= query param', async () => {
    const req = new Request('http://localhost/agents?token=bogus.jwt.token');
    await expect(SessionOnlyGuard(req)).rejects.toThrow('Invalid or expired access token');
  });

  test('JWT path wins when both Bearer and x-api-key are present (mixed credentials)', async () => {
    const req = new Request('http://localhost/agents', {
      headers: { Authorization: 'Bearer bogus.jwt.token', 'x-api-key': validKey },
    });
    // The bogus JWT is rejected as a JWT; the valid API key must NOT rescue the request.
    await expect(SessionOnlyGuard(req)).rejects.toThrow('Invalid or expired access token');
  });
});
