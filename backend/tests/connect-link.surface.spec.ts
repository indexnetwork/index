import '../src/startup.env';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { ConnectLinkController } from '../src/controllers/connect-link.controller';
import db from '../src/lib/drizzle/drizzle';
import {
  connectLinks,
  networkMembers,
  networks,
  opportunities,
  personalNetworks,
  userSocials,
  users,
} from '../src/schemas/database.schema';
import { mintConnectLink } from '../src/services/connect-link.service';

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network')
  .replace(/\/+$/, '');

function makeRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const CALLER_ID = `cl-surface-caller-${Date.now()}`;
const COUNTERPART_ID = `cl-surface-counterpart-${Date.now()}`;
const OPP_ID = `cl-surface-opp-${Date.now()}`;

describe('GET /c/:code/go — surface-aware redirect', () => {
  let controller: ConnectLinkController;

  beforeAll(async () => {
    controller = new ConnectLinkController();

    await db.insert(users).values([
      { id: CALLER_ID, email: `${CALLER_ID}@test`, name: 'CL Surface Caller' },
      { id: COUNTERPART_ID, email: `${COUNTERPART_ID}@test`, name: 'CL Surface Counterpart' },
    ]);

    await db.insert(opportunities).values({
      id: OPP_ID,
      // Two actors so startChat can resolve a counterpart.
      actors: [
        { userId: CALLER_ID, networkId: 'n/a', role: 'seeker' },
        { userId: COUNTERPART_ID, networkId: 'n/a', role: 'responder' },
      ],
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: CALLER_ID },
      interpretation: { category: 'test', reasoning: 'surface-test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'pending',
    });
  });

  afterAll(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, CALLER_ID));
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(userSocials).where(eq(userSocials.userId, COUNTERPART_ID));

    // startChat → upsertContactMembership → ensurePersonalNetwork creates
    // personal_networks + networks + network_members for each actor. Delete
    // these child rows before the users rows to satisfy FK constraints.
    // Collect the personal network IDs so we can drop the networks row too.
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

    // Also drop the personal network rows themselves and any network_members
    // that reference them (e.g. the counterpart added as a contact).
    for (const { networkId } of [...personalNetworkRows, ...counterpartPersonalNetworkRows]) {
      await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
      await db.delete(networks).where(eq(networks.id, networkId));
    }

    await db.delete(users).where(eq(users.id, CALLER_ID));
    await db.delete(users).where(eq(users.id, COUNTERPART_ID));
  });

  // `mintConnectLink` has a unique index on (opportunityId, userId, kind), so
  // each test reuses or rotates the same row. Wipe the row before each test
  // so the surface stamp is exactly what the test sets — first-mint-wins
  // would otherwise let an earlier test's surface leak.
  beforeEach(async () => {
    await db.delete(connectLinks).where(
      and(
        eq(connectLinks.opportunityId, OPP_ID),
        eq(connectLinks.userId, CALLER_ID),
      ),
    );
    await db.delete(userSocials).where(eq(userSocials.userId, COUNTERPART_ID));
  });

  test('preferredSurface=telegram + counterpart has TG handle → t.me URL', async () => {
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
      preferredSurface: 'telegram',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), undefined, { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\/t\.me\/counterpart_handle/);
    expect(body.url).toContain('text=hello%20there');
  });

  test('preferredSurface=telegram + counterpart has no TG handle → web fallback', async () => {
    // No userSocials row — the beforeEach wiped it.

    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
      preferredSurface: 'telegram',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), undefined, { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
    expect(body.url).toContain('msg=hello%20there');
  });

  test('preferredSurface unset + counterpart has TG handle → web URL (behavior change)', async () => {
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
      // preferredSurface omitted — persists as NULL, treated as web.
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), undefined, { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
  });
});
