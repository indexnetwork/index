import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { agentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../../adapters/agent-token.adapter';
import { resolveAgentNetworkScope, resolveAgentNetworkScopeById, assertAgentNetworkScope } from '../agent-scope.guard';

describe('agent-scope.guard', () => {
  let userId: string;
  let networkId: string;
  let unrelatedNetworkId: string;
  let scopedKey: string;
  let globalKey: string;
  let scopedAgentId: string;
  let globalAgentId: string;

  beforeAll(async () => {
    const [u] = await db.insert(schema.users)
      .values({ email: `scope-${Date.now()}@test.dev`, name: 'Scope Test', emailVerified: true })
      .returning({ id: schema.users.id });
    userId = u.id;

    const [n1] = await db.insert(schema.networks)
      .values({ title: 'Scoped Net', isPersonal: false })
      .returning({ id: schema.networks.id });
    networkId = n1.id;

    const [n2] = await db.insert(schema.networks)
      .values({ title: 'Unrelated Net', isPersonal: false })
      .returning({ id: schema.networks.id });
    unrelatedNetworkId = n2.id;

    const scopedAgent = await agentDatabaseAdapter.createAgent({
      ownerId: userId, name: 'Scoped Agent', type: 'personal',
    });
    scopedAgentId = scopedAgent.id;
    await agentDatabaseAdapter.grantPermission({
      agentId: scopedAgent.id, userId, scope: 'network', scopeId: networkId,
      actions: ['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:opportunities'],
    });
    scopedKey = (await agentTokenAdapter.create(userId, { name: 'scoped', agentId: scopedAgent.id })).key;

    const globalAgent = await agentDatabaseAdapter.createAgent({
      ownerId: userId, name: 'Global Agent', type: 'personal',
    });
    globalAgentId = globalAgent.id;
    await agentDatabaseAdapter.grantPermission({
      agentId: globalAgent.id, userId, scope: 'global',
      actions: ['manage:profile', 'manage:intents', 'manage:networks', 'manage:contacts', 'manage:opportunities'],
    });
    globalKey = (await agentTokenAdapter.create(userId, { name: 'global', agentId: globalAgent.id })).key;
  });

  afterAll(async () => {
    await db.delete(schema.networks).where(inArray(schema.networks.id, [networkId, unrelatedNetworkId]));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  const reqWithKey = (k: string) => new Request('http://localhost/test', { headers: { 'x-api-key': k } });

  test('returns null for global agent', async () => {
    expect(await resolveAgentNetworkScope(reqWithKey(globalKey))).toBeNull();
  });

  test('returns scopeId for network-scoped agent', async () => {
    expect(await resolveAgentNetworkScope(reqWithKey(scopedKey))).toBe(networkId);
  });

  test('returns null when no x-api-key is present', async () => {
    expect(await resolveAgentNetworkScope(new Request('http://localhost/test'))).toBeNull();
  });

  test('assert passes when scope matches', async () => {
    await expect(assertAgentNetworkScope(reqWithKey(scopedKey), networkId)).resolves.toBeUndefined();
  });

  test('assert throws when scope differs', async () => {
    await expect(assertAgentNetworkScope(reqWithKey(scopedKey), unrelatedNetworkId)).rejects.toThrow(/network scope/i);
  });

  test('assert is no-op for global agent', async () => {
    await expect(assertAgentNetworkScope(reqWithKey(globalKey), unrelatedNetworkId)).resolves.toBeUndefined();
  });

  test('resolveAgentNetworkScopeById returns null for global agent', async () => {
    expect(await resolveAgentNetworkScopeById(globalAgentId)).toBeNull();
  });

  test('resolveAgentNetworkScopeById returns scopeId for network-scoped agent', async () => {
    expect(await resolveAgentNetworkScopeById(scopedAgentId)).toBe(networkId);
  });

  test('resolveAgentNetworkScopeById returns null for unknown agent id', async () => {
    expect(await resolveAgentNetworkScopeById('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  test('returns null when JWT bearer header is present, even with x-api-key', async () => {
    const req = new Request('http://localhost/test', {
      headers: { Authorization: 'Bearer some.jwt.token', 'x-api-key': scopedKey },
    });
    expect(await resolveAgentNetworkScope(req)).toBeNull();
  });

  test('returns null when ?token= query param is present, even with x-api-key', async () => {
    const req = new Request('http://localhost/test?token=foo', {
      headers: { 'x-api-key': scopedKey },
    });
    expect(await resolveAgentNetworkScope(req)).toBeNull();
  });
});
