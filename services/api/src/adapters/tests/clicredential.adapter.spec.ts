import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import { CliCredentialAdapter, type CreateCliCredentialResult } from '../clicredential.adapter';
import { AuthController } from '../../controllers/auth.controller';
import { AuthGuard, SessionOnlyGuard, SessionRequiredError } from '../../guards/auth.guard';
import db from '../../lib/drizzle/drizzle';
import { hashApiKey } from '../../lib/apikey/credential';
import { auth } from '../../lib/betterauth/auth.instance';
import { API_URL } from '../../lib/betterauth/betterauth';
import { getRequestAuthContext } from '../../lib/request-auth-context';
import { apikeys, users } from '../../schemas/database.schema';
import { CliCredentialService } from '../../services/clicredential.service';

setDefaultTimeout(30_000);

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

describe('CLI credential adapter, service, and auth compatibility', () => {
  const adapter = new CliCredentialAdapter();
  const service = new CliCredentialService(adapter);
  let userId = '';
  let v1: CreateCliCredentialResult;
  let v2: CreateCliCredentialResult;
  let createdAfter = 0;
  let createdBefore = 0;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      email: `cli-credential-${Date.now()}@test.dev`,
      name: 'CLI Credential Test',
      emailVerified: true,
    }).returning({ id: users.id });
    userId = user.id;

    createdBefore = Date.now();
    v1 = await adapter.create(userId, 1);
    v2 = await service.create(userId, 2);
    createdAfter = Date.now();
  });

  afterAll(async () => {
    if (!userId) return;
    await db.delete(apikeys).where(eq(apikeys.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test('creates v1 and v2 Better Auth rows with only fixed CLI fields', async () => {
    const rows = await db.select().from(apikeys).where(inArray(apikeys.id, [v1.id, v2.id]));
    expect(rows).toHaveLength(2);

    for (const credential of [v1, v2]) {
      const row = rows.find((candidate) => candidate.id === credential.id);
      expect(row).toBeDefined();
      expect(credential.key).toHaveLength(64);
      expect(credential.key).toMatch(/^[A-Za-z]+$/);
      expect(row!.key).toBe(await hashApiKey(credential.key));
      expect(row!.key).not.toBe(credential.key);
      expect(row!.userId).toBe(userId);
      expect(row!.referenceId).toBe(userId);
      expect(row!.configId).toBe('default');
      expect(row!.permissions).toBe(JSON.stringify({ credential: ['cli'] }));
      expect(row!.enabled).toBe(true);
      expect(row!.name).toBe('Index CLI');
      expect(row!.start).toBe(credential.key.slice(0, 6));
      expect(row!.expiresAt?.toISOString()).toBe(credential.expiresAt.toISOString());
      expect(row!.expiresAt!.getTime()).toBeGreaterThanOrEqual(createdBefore + NINETY_DAYS_MS);
      expect(row!.expiresAt!.getTime()).toBeLessThanOrEqual(createdAfter + NINETY_DAYS_MS);
      expect(Math.abs(row!.updatedAt.getTime() - row!.createdAt.getTime())).toBeLessThan(10);
    }

    expect(JSON.parse(rows.find((row) => row.id === v1.id)!.metadata!)).toEqual({
      client: 'cli',
      protocolVersion: 1,
    });
    expect(JSON.parse(rows.find((row) => row.id === v2.id)!.metadata!)).toEqual({
      client: 'cli',
      protocolVersion: 2,
    });
  });

  test('authenticates returned keys through x-api-key with API-key provenance', async () => {
    for (const credential of [v1, v2]) {
      const request = new Request('http://localhost/api/auth/me', {
        headers: { 'x-api-key': credential.key },
      });
      await expect(AuthGuard(request)).resolves.toMatchObject({ id: userId });
      expect(getRequestAuthContext(request)).toEqual({ kind: 'api_key', agentId: null });
    }
  });

  test('accepts only v1 as the temporary Bearer fallback', async () => {
    const v1Request = new Request('http://localhost/api/chat/stream', {
      headers: { Authorization: `Bearer ${v1.key}` },
    });
    await expect(AuthGuard(v1Request)).resolves.toMatchObject({ id: userId });
    expect(getRequestAuthContext(v1Request)).toEqual({ kind: 'api_key', agentId: null });

    const v2Request = new Request('http://localhost/api/chat/stream', {
      headers: { Authorization: `Bearer ${v2.key}` },
    });
    await expect(AuthGuard(v2Request)).rejects.toThrow('Invalid or expired access token');
    expect(getRequestAuthContext(v2Request)).toBeUndefined();
  });

  test('generic Better Auth API-key management rejects x-api-key session escalation', async () => {
    const requests = [
      new Request(`${API_URL}/api/auth/api-key/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': v2.key },
        body: JSON.stringify({ name: 'successor' }),
      }),
      new Request(`${API_URL}/api/auth/api-key/list`, {
        headers: { 'x-api-key': v2.key },
      }),
      new Request(`${API_URL}/api/auth/api-key/get?id=${encodeURIComponent(v2.id)}`, {
        headers: { 'x-api-key': v2.key },
      }),
      new Request(`${API_URL}/api/auth/api-key/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': v2.key },
        body: JSON.stringify({ keyId: v2.id, name: 'retagged' }),
      }),
      new Request(`${API_URL}/api/auth/api-key/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': v2.key },
        body: JSON.stringify({ keyId: v2.id }),
      }),
    ];

    for (const request of requests) {
      const response = await auth.handler(request);
      expect(response.status).toBe(401);
    }
    await expect(AuthGuard(new Request('http://localhost/api/auth/me', {
      headers: { 'x-api-key': v2.key },
    }))).resolves.toMatchObject({ id: userId });
  });

  test('SessionOnlyGuard rejects both API-key transports', async () => {
    const xApiKeyRequest = new Request('http://localhost/api/auth/cli-credential', {
      headers: { 'x-api-key': v1.key },
    });
    await expect(SessionOnlyGuard(xApiKeyRequest)).rejects.toBeInstanceOf(SessionRequiredError);

    const v1BearerRequest = new Request('http://localhost/api/auth/cli-credential', {
      headers: { Authorization: `Bearer ${v1.key}` },
    });
    await expect(SessionOnlyGuard(v1BearerRequest))
      .rejects.toThrow('Invalid or expired access token');
    expect(getRequestAuthContext(v1BearerRequest)).toBeUndefined();
  });

  test('custom endpoint revokes a real v1 credential using self proof', async () => {
    const credential = await service.create(userId, 1);
    const request = new Request('http://localhost/api/auth/cli-credential/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': credential.key },
      body: JSON.stringify({ keyId: credential.id, targetKey: credential.key }),
    });
    const authenticated = await AuthGuard(request);
    const response = await new AuthController().revokeCliCredential(request, authenticated);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    await expect(AuthGuard(new Request('http://localhost/api/auth/me', {
      headers: { 'x-api-key': credential.key },
    }))).rejects.toThrow('Invalid API key');
  });

  test('replacement credential revokes a proven prior v1 target and remains valid', async () => {
    const previous = await service.create(userId, 1);
    const replacement = await service.create(userId, 2);
    const request = new Request('http://localhost/api/auth/cli-credential/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': replacement.key },
      body: JSON.stringify({ keyId: previous.id, targetKey: previous.key }),
    });
    const authenticated = await AuthGuard(request);
    const response = await new AuthController().revokeCliCredential(request, authenticated);

    expect(response.status).toBe(200);
    await expect(AuthGuard(new Request('http://localhost/api/auth/me', {
      headers: { 'x-api-key': previous.key },
    }))).rejects.toThrow('Invalid API key');
    await expect(AuthGuard(new Request('http://localhost/api/auth/me', {
      headers: { 'x-api-key': replacement.key },
    }))).resolves.toMatchObject({ id: userId });
  });

  test('rejects agent callers and same-user metadata forgery', async () => {
    const target = await service.create(userId, 2);
    const agentKey = `AgentCaller${'A'.repeat(53)}`;
    const forgedKey = `ForgedTarget${'B'.repeat(52)}`;
    const [agentRow, forgedRow] = await db.insert(apikeys).values([
      {
        key: await hashApiKey(agentKey),
        userId,
        referenceId: userId,
        start: agentKey.slice(0, 6),
        enabled: true,
        metadata: JSON.stringify({ agentId: crypto.randomUUID() }),
      },
      {
        key: await hashApiKey(forgedKey),
        userId,
        referenceId: userId,
        name: 'Index CLI',
        start: forgedKey.slice(0, 6),
        enabled: true,
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 2 }),
      },
    ]).returning({ id: apikeys.id });

    const agentRequest = new Request('http://localhost/api/auth/cli-credential/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': agentKey },
      body: JSON.stringify({ keyId: target.id, targetKey: target.key }),
    });
    const agentUser = await AuthGuard(agentRequest);
    const agentResponse = await new AuthController().revokeCliCredential(agentRequest, agentUser);
    expect(agentResponse.status).toBe(403);
    expect(await agentResponse.json()).toEqual({ error: 'CLI credential revocation denied' });

    await expect(service.revoke({
      userId,
      callerKey: target.key,
      keyId: forgedRow.id,
      targetKey: forgedKey,
    })).resolves.toBe(false);
    expect(agentRow.id).toBeTruthy();
  });

  test('rejects wrong target proof, cross-user targets, and disabled or expired callers', async () => {
    const caller = await service.create(userId, 2);
    const target = await service.create(userId, 1);
    await expect(service.revoke({
      userId,
      callerKey: caller.key,
      keyId: target.id,
      targetKey: `${target.key}wrong`,
    })).resolves.toBe(false);
    await expect(service.revoke({
      userId,
      callerKey: caller.key,
      keyId: crypto.randomUUID(),
      targetKey: target.key,
    })).resolves.toBe(false);

    const [otherUser] = await db.insert(users).values({
      email: `cli-credential-other-${Date.now()}@test.dev`,
      name: 'Other CLI Credential Test',
      emailVerified: true,
    }).returning({ id: users.id });
    const crossUserTarget = await service.create(otherUser.id, 2);
    await expect(service.revoke({
      userId,
      callerKey: caller.key,
      keyId: crossUserTarget.id,
      targetKey: crossUserTarget.key,
    })).resolves.toBe(false);

    const disabledCaller = await service.create(userId, 2);
    await db.update(apikeys).set({ enabled: false }).where(eq(apikeys.id, disabledCaller.id));
    await expect(service.revoke({
      userId,
      callerKey: disabledCaller.key,
      keyId: target.id,
      targetKey: target.key,
    })).resolves.toBe(false);

    const expiredCaller = await service.create(userId, 2);
    await db.update(apikeys).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(apikeys.id, expiredCaller.id));
    await expect(service.revoke({
      userId,
      callerKey: expiredCaller.key,
      keyId: target.id,
      targetKey: target.key,
    })).resolves.toBe(false);

    await db.delete(apikeys).where(eq(apikeys.userId, otherUser.id));
    await db.delete(users).where(eq(users.id, otherUser.id));
  });
});
