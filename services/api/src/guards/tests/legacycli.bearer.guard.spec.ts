import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import { getRequestAuthContext } from '../../lib/request-auth-context';
import { apikeys, users } from '../../schemas/database.schema';
import { AuthGuard, isSessionAuthenticated, resolveApiKeyAgentId, SessionOnlyGuard } from '../auth.guard';

const rawKeys = {
  validV1: `cli-v1-${randomUUID()}`,
  v2: `cli-v2-${randomUUID()}`,
  defaultKey: `default-${randomUUID()}`,
  wrongClient: `wrong-client-${randomUUID()}`,
  forgedProtocol: `forged-protocol-${randomUUID()}`,
  malformed: `malformed-${randomUUID()}`,
  agent: `agent-${randomUUID()}`,
  disabled: `disabled-${randomUUID()}`,
  expired: `expired-${randomUUID()}`,
  mismatch: `mismatch-${randomUUID()}`,
};

function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('base64url');
}

function bearerRequest(rawKey: string): Request {
  return new Request('http://localhost/api/chat/stream', {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
}

describe('AuthGuard temporary legacy CLI bearer bridge', () => {
  let userId: string;

  beforeAll(async () => {
    const [user] = await db.insert(users).values({
      email: `legacy-cli-bearer-${Date.now()}@test.dev`,
      name: 'Legacy CLI Bearer',
      emailVerified: true,
    }).returning({ id: users.id });
    userId = user.id;

    const base = {
      userId,
      referenceId: userId,
      enabled: true,
    };
    await db.insert(apikeys).values([
      {
        ...base,
        key: hashKey(rawKeys.validV1),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 1 }),
      },
      {
        ...base,
        key: hashKey(rawKeys.v2),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 2 }),
      },
      { ...base, key: hashKey(rawKeys.defaultKey), metadata: null },
      {
        ...base,
        key: hashKey(rawKeys.wrongClient),
        metadata: JSON.stringify({ client: 'web', protocolVersion: 1 }),
      },
      {
        ...base,
        key: hashKey(rawKeys.forgedProtocol),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: '1' }),
      },
      { ...base, key: hashKey(rawKeys.malformed), metadata: '{not-json' },
      {
        ...base,
        key: hashKey(rawKeys.agent),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 1, agentId: randomUUID() }),
      },
      {
        ...base,
        key: hashKey(rawKeys.disabled),
        enabled: false,
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 1 }),
      },
      {
        ...base,
        key: hashKey(rawKeys.expired),
        expiresAt: new Date(Date.now() - 60_000),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 1 }),
      },
      {
        ...base,
        key: hashKey(rawKeys.mismatch),
        referenceId: randomUUID(),
        metadata: JSON.stringify({ client: 'cli', protocolVersion: 1 }),
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(apikeys).where(eq(apikeys.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  });

  test('accepts a valid v1 bearer as an unbound API-key principal', async () => {
    const request = bearerRequest(rawKeys.validV1);

    const user = await AuthGuard(request);

    expect(user.id).toBe(userId);
    expect(getRequestAuthContext(request)).toEqual({ kind: 'api_key', agentId: null });
    expect(isSessionAuthenticated(request)).toBe(false);
    expect(await resolveApiKeyAgentId(request)).toBeNull();
  });

  test('keeps v2 on x-api-key while rejecting it as Bearer', async () => {
    const xApiKeyRequest = new Request('http://localhost/api/chat/stream', {
      headers: { 'x-api-key': rawKeys.v2 },
    });

    await expect(AuthGuard(bearerRequest(rawKeys.v2)))
      .rejects.toThrow('Invalid or expired access token');
    await expect(AuthGuard(xApiKeyRequest)).resolves.toMatchObject({ id: userId });
    expect(getRequestAuthContext(xApiKeyRequest)).toEqual({ kind: 'api_key', agentId: null });
  });

  test.each([
    ['default key', rawKeys.defaultKey],
    ['wrong client', rawKeys.wrongClient],
    ['forged protocol metadata', rawKeys.forgedProtocol],
    ['malformed metadata', rawKeys.malformed],
    ['agent-bound key', rawKeys.agent],
    ['disabled key', rawKeys.disabled],
    ['expired key', rawKeys.expired],
    ['principal mismatch', rawKeys.mismatch],
  ])('rejects %s as a bearer fallback', async (_label, rawKey) => {
    await expect(AuthGuard(bearerRequest(rawKey)))
      .rejects.toThrow('Invalid or expired access token');
  });

  test('never falls back for a query token', async () => {
    const request = new Request(
      `http://localhost/api/chat/stream?token=${encodeURIComponent(rawKeys.validV1)}`,
    );

    await expect(AuthGuard(request)).rejects.toThrow('Invalid or expired access token');
    expect(getRequestAuthContext(request)).toBeUndefined();
  });

  test('SessionOnlyGuard still treats a v1 bearer only as an invalid JWT', async () => {
    const request = bearerRequest(rawKeys.validV1);

    await expect(SessionOnlyGuard(request)).rejects.toThrow('Invalid or expired access token');
    expect(getRequestAuthContext(request)).toBeUndefined();
  });
});
