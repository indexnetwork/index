import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, or } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { apikeys, networkMembers, networks, personalNetworks, users } from '../src/schemas/database.schema';

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;
const RUN_LOCAL_API_E2E = process.env.RUN_LOCAL_API_E2E === '1';

let authJwt = '';
let ownerUserId = '';
let networkId = '';
let memberUserId = '';

async function api(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const { method = 'GET', body, headers = {} } = opts;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(authJwt ? { Authorization: `Bearer ${authJwt}` } : {}),
      ...headers,
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`${BASE_URL}${path}`, init);
}

async function cleanupProvisionedUsers(userIds: string[], extraNetworkIds: string[] = []): Promise<void> {
  const ids = userIds.filter(Boolean);
  if (ids.length === 0) return;

  const mappings = await db
    .select({ networkId: personalNetworks.networkId })
    .from(personalNetworks)
    .where(inArray(personalNetworks.userId, ids));
  const networkIds = [...new Set([...extraNetworkIds.filter(Boolean), ...mappings.map((row) => row.networkId)])];

  await db.delete(networkMembers).where(
    networkIds.length > 0
      ? or(inArray(networkMembers.userId, ids), inArray(networkMembers.networkId, networkIds))
      : inArray(networkMembers.userId, ids),
  );
  await db.delete(personalNetworks).where(inArray(personalNetworks.userId, ids));
  if (networkIds.length > 0) await db.delete(networks).where(inArray(networks.id, networkIds));
  await db.delete(users).where(inArray(users.id, ids));
}

describe.skipIf(!RUN_LOCAL_API_E2E)('POST /networks/:id/members/:memberId/resend-invite', () => {
  beforeAll(async () => {
    const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (!health) {
      throw new Error(
        `RUN_LOCAL_API_E2E=1 requires a local API server at ${BASE_URL} using the same disposable test database.`,
      );
    }

    const email = `owner-${randomUUID()}@example.com`;
    const password = `Test${randomUUID().replace(/-/g, '')}!`;
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email, password, name: 'Owner' }),
    });
    if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
    const data = await signup.json() as { user?: { id: string } };
    ownerUserId = data.user?.id ?? '';
    const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0].trim()).join('; ');
    const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
      headers: { Cookie: cookie, Origin: BASE_URL },
    });
    const tokenJson = await tokenRes.json() as { token?: string };
    authJwt = tokenJson.token ?? '';

    const createRes = await api('/api/networks', {
      method: 'POST',
      body: { title: `Net ${randomUUID().slice(0, 6)}` },
    });
    if (!createRes.ok) throw new Error(`create network: ${createRes.status} ${await createRes.text()}`);
    const created = await createRes.json() as { network?: { id: string } };
    networkId = created.network?.id ?? '';

    const memberEmail = `member-${randomUUID()}@example.com`;
    const inviteRes = await api(`/api/networks/${networkId}/members/invite`, {
      method: 'POST',
      body: { email: memberEmail },
    });
    if (!inviteRes.ok) throw new Error(`invite: ${inviteRes.status} ${await inviteRes.text()}`);
    const inviteJson = await inviteRes.json() as { user?: { id: string } };
    memberUserId = inviteJson.user?.id ?? '';
  }, 30_000);

  afterAll(async () => {
    await cleanupProvisionedUsers([memberUserId, ownerUserId], [networkId]);
  }, 30_000);

  it('rotates the key for a member', async () => {
    const before = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(eq(apikeys.userId, memberUserId));
    const beforeId = before[0]?.id;
    expect(beforeId).toBeDefined();

    const res = await api(`/api/networks/${networkId}/members/${memberUserId}/resend-invite`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(json.rotated).toBe(true);
    expect(json.email).toBeTruthy();

    const after = await db
      .select({ id: apikeys.id })
      .from(apikeys)
      .where(eq(apikeys.userId, memberUserId));
    expect(after).toHaveLength(1);
    expect(after[0].id).not.toBe(beforeId);
  });

  it('rotates or provisions for the owner when memberId is the caller', async () => {
    const res = await api(`/api/networks/${networkId}/members/${ownerUserId}/resend-invite`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(typeof json.rotated).toBe('boolean');
    expect(json.email).toBeTruthy();
  });

  it('returns 404 when memberId is not a member of the network', async () => {
    const res = await api(`/api/networks/${networkId}/members/${randomUUID()}/resend-invite`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the network owner', async () => {
    const email = `intruder-${randomUUID()}@example.com`;
    const password = `Test${randomUUID().replace(/-/g, '')}!`;
    const signup = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ email, password, name: 'Intruder' }),
    });
    const data = await signup.json() as { user?: { id: string } };
    const intruderId = data.user?.id ?? '';

    try {
      const cookie = signup.headers.getSetCookie().map((value) => value.split(';')[0].trim()).join('; ');
      const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, {
        headers: { Cookie: cookie, Origin: BASE_URL },
      });
      const tokenJson = await tokenRes.json() as { token?: string };

      const res = await fetch(
        `${BASE_URL}/api/networks/${networkId}/members/${memberUserId}/resend-invite`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenJson.token ?? ''}`,
            'Content-Type': 'application/json',
          },
        },
      );
      expect(res.status).toBe(403);
    } finally {
      await cleanupProvisionedUsers([intruderId]);
    }
  }, 30_000);
});
