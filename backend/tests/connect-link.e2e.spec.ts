import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { ConnectLinkController } from '../src/controllers/connect-link.controller';
import type { AuthenticatedUser } from '../src/guards/auth.guard';
import db from '../src/lib/drizzle/drizzle';
import { connectLinks, opportunities, users } from '../src/schemas/database.schema';
import { mintConnectLink } from '../src/services/connect-link.service';

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const FRONTEND_URL = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network')
  .replace(/\/+$/, '');

const USER_ID = `cl-e2e-user-${Date.now()}`;
const OTHER_USER_ID = `cl-e2e-other-${Date.now()}`;
const OPP_ID = `cl-e2e-opp-${Date.now()}`;

function mockUser(id: string = USER_ID): AuthenticatedUser {
  return { id, email: `${id}@test`, name: 'CL E2E User' };
}

describe('GET /c/:code — connect-link controller', () => {
  let controller: ConnectLinkController;

  beforeAll(async () => {
    controller = new ConnectLinkController();

    await db.insert(users).values([
      { id: USER_ID, email: `${USER_ID}@test`, name: 'CL E2E User' },
      { id: OTHER_USER_ID, email: `${OTHER_USER_ID}@test`, name: 'CL E2E Other User' },
    ]);

    await db.insert(opportunities).values({
      id: OPP_ID,
      actors: [{ userId: USER_ID, networkId: 'n/a', role: 'seeker' }],
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: USER_ID },
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'pending',
    });
  });

  afterAll(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, USER_ID));
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
    await db.delete(users).where(eq(users.id, OTHER_USER_ID));
  });

  test('unknown but well-formed public code redirects to frontend continuation without DB lookup', async () => {
    const code = 'Aa0Bb1Cc2D';
    const res = await controller.resolve(makeRequest(`/c/${code}`), undefined, { code });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${FRONTEND_URL}/c/${code}`);
  });

  test('malformed public code (wrong length or non-base62) is rejected with 404 HTML', async () => {
    let res = await controller.resolve(makeRequest('/c/TOOSHORT'), undefined, { code: 'TOOSHORT' });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);

    res = await controller.resolve(makeRequest('/c/AAAA-BBBBB'), undefined, { code: 'AAAA-BBBBB' });
    expect(res.status).toBe(404);
  });

  test('valid public connect code redirects to frontend continuation instead of resolving side effects', async () => {
    const { code } = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'Hi from e2e test.',
    });

    const res = await controller.resolve(makeRequest(`/c/${code}`), undefined, { code });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${FRONTEND_URL}/c/${code}`);
  });

  test('valid public approve-introduction code redirects to frontend continuation without approving inline', async () => {
    const { code } = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'approve_introduction',
      greeting: 'Approve from e2e test.',
    });

    const res = await controller.resolve(makeRequest(`/c/${code}`), undefined, { code });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${FRONTEND_URL}/c/${code}`);
  });

  test('authenticated go masks unknown and malformed codes as 404', async () => {
    let res = await controller.go(makeRequest('/c/Aa0Bb1Cc2D/go'), mockUser(), { code: 'Aa0Bb1Cc2D' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Link not found' });

    res = await controller.go(makeRequest('/c/AAAA-BBBBB/go'), mockUser(), { code: 'AAAA-BBBBB' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Link not found' });
  });

  test('authenticated go masks wrong-account recipient mismatch as 404', async () => {
    const { code } = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'Hi from e2e test.',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(OTHER_USER_ID), { code });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Link not found' });
  });
});
