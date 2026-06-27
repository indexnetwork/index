import '../src/startup.env';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { ConnectLinkController } from '../src/controllers/connect-link.controller';
import type { AuthenticatedUser } from '../src/guards/auth.guard';
import db from '../src/lib/drizzle/drizzle';
import { connectLinks, networkMembers, networks, opportunities, personalNetworks, userSocials, users } from '../src/schemas/database.schema';
import { mintConnectLink } from '../src/services/connect-link.service';

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network')
  .replace(/\/+$/, '');

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const CALLER_ID = `cl-surface-caller-${Date.now()}`;
const COUNTERPART_ID = `cl-surface-counterpart-${Date.now()}`;
const OTHER_USER_ID = `cl-surface-other-${Date.now()}`;
const OPP_ID = `cl-surface-opp-${Date.now()}`;
const INTRO_OPP_ID = `cl-surface-intro-opp-${Date.now()}`;
const OPP_ACTORS = [
  { userId: CALLER_ID, networkId: 'n/a', role: 'seeker' },
  { userId: COUNTERPART_ID, networkId: 'n/a', role: 'responder' },
];
const INTRO_ACTORS = [
  { userId: CALLER_ID, networkId: 'n/a', role: 'introducer', approved: false },
  { userId: COUNTERPART_ID, networkId: 'n/a', role: 'party' },
];
const TEST_TIMEOUT_MS = 15_000;

function mockUser(id: string = CALLER_ID): AuthenticatedUser {
  return { id, email: `${id}@test`, name: 'CL Surface User' };
}

describe('GET /c/:code/go — surface-aware redirect', () => {
  let controller: ConnectLinkController;

  beforeAll(async () => {
    controller = new ConnectLinkController();

    await db.insert(users).values([
      { id: CALLER_ID, email: `${CALLER_ID}@test`, name: 'CL Surface Caller' },
      { id: COUNTERPART_ID, email: `${COUNTERPART_ID}@test`, name: 'CL Surface Counterpart' },
      { id: OTHER_USER_ID, email: `${OTHER_USER_ID}@test`, name: 'CL Surface Other' },
    ]);

    await db.insert(opportunities).values({
      id: OPP_ID,
      actors: OPP_ACTORS,
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: CALLER_ID },
      interpretation: { category: 'test', reasoning: 'surface-test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'pending',
    });
    await db.insert(opportunities).values({
      id: INTRO_OPP_ID,
      actors: INTRO_ACTORS,
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: CALLER_ID },
      interpretation: { category: 'test', reasoning: 'intro-test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'latent',
    });
  });

  afterAll(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, CALLER_ID));
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(opportunities).where(eq(opportunities.id, INTRO_OPP_ID));
    await db.delete(userSocials).where(eq(userSocials.userId, COUNTERPART_ID));

    const personalNetworkRows = await db
      .select({ networkId: personalNetworks.networkId })
      .from(personalNetworks)
      .where(eq(personalNetworks.userId, CALLER_ID));
    const counterpartPersonalNetworkRows = await db
      .select({ networkId: personalNetworks.networkId })
      .from(personalNetworks)
      .where(eq(personalNetworks.userId, COUNTERPART_ID));

    await db.delete(networkMembers).where(eq(networkMembers.userId, CALLER_ID));
    await db.delete(networkMembers).where(eq(networkMembers.userId, COUNTERPART_ID));
    await db.delete(personalNetworks).where(eq(personalNetworks.userId, CALLER_ID));
    await db.delete(personalNetworks).where(eq(personalNetworks.userId, COUNTERPART_ID));

    for (const { networkId } of [...personalNetworkRows, ...counterpartPersonalNetworkRows]) {
      await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
      await db.delete(networks).where(eq(networks.id, networkId));
    }

    await db.delete(users).where(eq(users.id, CALLER_ID));
    await db.delete(users).where(eq(users.id, COUNTERPART_ID));
    await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  });

  beforeEach(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, CALLER_ID));
    await db.delete(userSocials).where(eq(userSocials.userId, COUNTERPART_ID));
    await db
      .update(opportunities)
      .set({ status: 'pending', actors: OPP_ACTORS })
      .where(eq(opportunities.id, OPP_ID));
    await db
      .update(opportunities)
      .set({ status: 'latent', actors: INTRO_ACTORS })
      .where(eq(opportunities.id, INTRO_OPP_ID));
  }, TEST_TIMEOUT_MS);

  test('counterpart has TG handle → t.me URL', async () => {
    await db.insert(userSocials).values({
      userId: COUNTERPART_ID,
      label: 'telegram',
      value: 'counterpart_handle',
    });

    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\/t\.me\/counterpart_handle/);
    expect(body.url).toContain('text=hello%20there');
  }, TEST_TIMEOUT_MS);

  test('counterpart has no TG handle → web fallback', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
    expect(body.url).toContain('msg=hello%20there');
  }, TEST_TIMEOUT_MS);

  test('preferredSurface unset + counterpart has TG handle → t.me URL (routes by counterpart reachability)', async () => {
    await db.insert(userSocials).values({
      userId: COUNTERPART_ID,
      label: 'telegram',
      value: 'counterpart_handle',
    });

    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\/t\.me\/counterpart_handle/);
    expect(body.url).toContain('text=hello%20there');
  }, TEST_TIMEOUT_MS);

  test('send_direct uses authenticated recipient and opens the same web chat destination as connect', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'send_direct',
      greeting: 'hello direct',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
    expect(body.url).toContain('msg=hello%20direct');
  }, TEST_TIMEOUT_MS);

  test('outreach uses authenticated recipient and returns conversation destination', async () => {
    await db
      .update(opportunities)
      .set({ status: 'accepted', actors: OPP_ACTORS })
      .where(eq(opportunities.id, OPP_ID));

    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'outreach',
      greeting: 'hello outreach',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toContain(`${FRONTEND_URL}/conversations/`);
    expect(body.url).toContain('msg=hello%20outreach');
  }, TEST_TIMEOUT_MS);

  test('approve_introduction uses authenticated introducer and returns approval confirmation kind', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: INTRO_OPP_ID,
      kind: 'approve_introduction',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: 'approve_introduction' });

    const [after] = await db
      .select({ status: opportunities.status, actors: opportunities.actors })
      .from(opportunities)
      .where(eq(opportunities.id, INTRO_OPP_ID))
      .limit(1);
    expect(after.status).toBe('pending');
    expect(after.actors.some((actor) => actor.userId === CALLER_ID && actor.role === 'introducer' && actor.approved === true)).toBe(true);
  }, TEST_TIMEOUT_MS);

  test('wrong authenticated recipient is masked as 404 before destination side effects', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
    });

    const [before] = await db
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(eq(opportunities.id, OPP_ID))
      .limit(1);

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(OTHER_USER_ID), { code });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Link not found' });

    const [after] = await db
      .select({ status: opportunities.status })
      .from(opportunities)
      .where(eq(opportunities.id, OPP_ID))
      .limit(1);
    expect(after.status).toBe(before.status);
  }, TEST_TIMEOUT_MS);

  test('wrong authenticated recipient is masked as 404 for every connect-link kind', async () => {
    const cases = [
      { kind: 'connect' as const, opportunityId: OPP_ID, status: 'pending' as const, actors: OPP_ACTORS },
      { kind: 'send_direct' as const, opportunityId: OPP_ID, status: 'pending' as const, actors: OPP_ACTORS },
      { kind: 'outreach' as const, opportunityId: OPP_ID, status: 'accepted' as const, actors: OPP_ACTORS },
      { kind: 'approve_introduction' as const, opportunityId: INTRO_OPP_ID, status: 'latent' as const, actors: INTRO_ACTORS },
    ];

    for (const item of cases) {
      await db.delete(connectLinks).where(eq(connectLinks.userId, CALLER_ID));
      await db
        .update(opportunities)
        .set({ status: item.status, actors: item.actors })
        .where(eq(opportunities.id, item.opportunityId));

      const { code } = await mintConnectLink({
        userId: CALLER_ID,
        opportunityId: item.opportunityId,
        kind: item.kind,
        greeting: 'wrong account should not use this',
      });

      const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(OTHER_USER_ID), { code });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Link not found' });

      const [after] = await db
        .select({ status: opportunities.status, actors: opportunities.actors })
        .from(opportunities)
        .where(eq(opportunities.id, item.opportunityId))
        .limit(1);
      expect(after.status).toBe(item.status);
      if (item.kind === 'approve_introduction') {
        expect(after.actors.some((actor) => actor.userId === CALLER_ID && actor.role === 'introducer' && actor.approved === true)).toBe(false);
      }
    }
  }, TEST_TIMEOUT_MS);
});
