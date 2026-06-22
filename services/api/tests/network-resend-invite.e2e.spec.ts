import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { agentPermissions, agents, apikeys, networkMembers, networks, users } from '../src/schemas/database.schema';

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

let authJwt = '';
let ownerUserId = '';
let networkId = '';
let memberUserId = '';

async function api(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
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

beforeAll(async () => {
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
  const cookie = signup.headers.getSetCookie().map(c => c.split(';')[0].trim()).join('; ');
  const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, { headers: { Cookie: cookie, Origin: BASE_URL } });
  const tokenJson = await tokenRes.json() as { token?: string };
  authJwt = tokenJson.token ?? '';

  const createRes = await api('/networks', { method: 'POST', body: { title: `Net ${randomUUID().slice(0, 6)}`, isExperiment: true } });
  if (!createRes.ok) throw new Error(`create network: ${createRes.status} ${await createRes.text()}`);
  const created = await createRes.json() as { network?: { id: string } };
  networkId = created.network?.id ?? '';

  const memberEmail = `member-${randomUUID()}@example.com`;
  const inviteRes = await api(`/networks/${networkId}/members/invite`, { method: 'POST', body: { email: memberEmail } });
  if (!inviteRes.ok) throw new Error(`invite: ${inviteRes.status} ${await inviteRes.text()}`);
  const inviteJson = await inviteRes.json() as { user?: { id: string } };
  memberUserId = inviteJson.user?.id ?? '';
});

afterAll(async () => {
  await db.delete(apikeys).where(eq(apikeys.userId, memberUserId));
  await db.delete(agentPermissions).where(eq(agentPermissions.userId, memberUserId));
  await db.delete(agents).where(eq(agents.ownerId, memberUserId));
  await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  await db.delete(networks).where(eq(networks.id, networkId));
  await db.delete(users).where(eq(users.id, memberUserId));
  await db.delete(users).where(eq(users.id, ownerUserId));
});

describe('POST /networks/:id/members/:memberId/resend-invite', () => {
  it('rotates the key for a member (200, rotated=true)', async () => {
    const before = await db.select({ id: apikeys.id }).from(apikeys).where(eq(apikeys.userId, memberUserId));
    const beforeId = before[0]?.id;
    expect(beforeId).toBeDefined();

    const res = await api(`/networks/${networkId}/members/${memberUserId}/resend-invite`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(json.rotated).toBe(true);
    expect(json.email).toBeTruthy();

    const after = await db.select({ id: apikeys.id }).from(apikeys).where(eq(apikeys.userId, memberUserId));
    expect(after.length).toBe(1);
    expect(after[0].id).not.toBe(beforeId);
  });

  it('rotates (or provisions) for the owner when memberId is the caller', async () => {
    const res = await api(`/networks/${networkId}/members/${ownerUserId}/resend-invite`, { method: 'POST' });
    expect(res.status).toBe(200);
    const json = await res.json() as { rotated: boolean; email: string };
    expect(typeof json.rotated).toBe('boolean');
    expect(json.email).toBeTruthy();
  });

  it('returns 404 when memberId is not a member of the network', async () => {
    const fakeId = randomUUID();
    const res = await api(`/networks/${networkId}/members/${fakeId}/resend-invite`, { method: 'POST' });
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
    const cookie = signup.headers.getSetCookie().map(c => c.split(';')[0].trim()).join('; ');
    const tokenRes = await fetch(`${BASE_URL}/api/auth/token`, { headers: { Cookie: cookie, Origin: BASE_URL } });
    const tokenJson = await tokenRes.json() as { token?: string };
    const intruderJwt = tokenJson.token ?? '';
    const data = await signup.json() as { user?: { id: string } };
    const intruderId = data.user?.id ?? '';

    const res = await fetch(`${BASE_URL}/networks/${networkId}/members/${memberUserId}/resend-invite`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${intruderJwt}`, 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(403);

    await db.delete(users).where(eq(users.id, intruderId));
  });
});
