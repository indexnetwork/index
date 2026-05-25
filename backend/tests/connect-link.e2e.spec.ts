import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { ConnectLinkController } from '../src/controllers/connect-link.controller';
import db from '../src/lib/drizzle/drizzle';
import { connectLinks, opportunities, users } from '../src/schemas/database.schema';
import { mintConnectLink } from '../src/services/connect-link.service';

// ---------------------------------------------------------------------------
// Helpers — in-process controller invocation, mirrors the pattern used in
// agent-test-message.e2e.spec.ts (no running dev server required).
// ---------------------------------------------------------------------------

function makeRequest(path: string) {
  return new Request(`http://localhost${path}`, { method: 'GET' });
}

const USER_ID = `cl-e2e-user-${Date.now()}`;
const OPP_ID = `cl-e2e-opp-${Date.now()}`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe('GET /c/:code — connect-link controller', () => {
  let controller: ConnectLinkController;

  beforeAll(async () => {
    controller = new ConnectLinkController();

    await db.insert(users).values({
      id: USER_ID,
      email: `${USER_ID}@test`,
      name: 'CL E2E User',
    });

    // Minimal opportunity row matching the shape used in
    // backend/src/services/tests/connect-link.service.spec.ts
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
  });

  test('unknown but well-formed code returns 404 with HTML body', async () => {
    const res = await controller.resolve(
      makeRequest('/c/Aa0Bb1Cc2D'),
      undefined,
      { code: 'Aa0Bb1Cc2D' },
    );

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });

  test('malformed code (wrong length or non-base62) is rejected with 404', async () => {
    // Wrong length
    let res = await controller.resolve(
      makeRequest('/c/TOOSHORT'),
      undefined,
      { code: 'TOOSHORT' },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);

    // Non-base62 characters
    res = await controller.resolve(
      makeRequest('/c/AAAA-BBBBB'),
      undefined,
      { code: 'AAAA-BBBBB' },
    );
    expect(res.status).toBe(404);
  });

  test('valid connect code is reachable (controller resolves the link)', async () => {
    const { code } = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'Hi from e2e test.',
    });

    const res = await controller.resolve(
      makeRequest(`/c/${code}`),
      undefined,
      { code },
    );

    // The synthetic opportunity may or may not satisfy `startChat`'s actor
    // resolution; we only need to confirm the route is wired and the link
    // resolved (i.e. NOT a 404 expired-page and NOT a 5xx). 302 on success,
    // 4xx if startChat rejects.
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
    expect(res.status).not.toBe(404);
  });
});
