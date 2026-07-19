/**
 * Black-box E2E for the CONTACTS_ENABLED gate on the HTTP surface.
 *
 * Boots a minimal Bun.serve that dispatches POST /users/contacts through the
 * REAL decorator-registered guard chain for UserController.addContact
 * (RateLimit('write') -> ContactsEnabledGuard -> AuthGuard) and reproduces
 * main.ts's guard loop + error->status mapping. We then fire real fetch()
 * requests.
 *
 * Because ContactsEnabledGuard is ordered BEFORE AuthGuard, a request with no
 * auth token returns 404 when disabled (gate wins) but 401 when enabled (gate
 * passes, auth rejects) — proving the gate both blocks when off and is ordered
 * ahead of auth.
 *
 * Run: bun test tests/contacts-disabled.e2e.spec.ts
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { RouteRegistry } from '../src/lib/router/router.decorators';
import { UserController } from '../src/controllers/user.controller';

const originalFlag = process.env.CONTACTS_ENABLED;

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

// Reproduces the subset of main.ts's request dispatch we need: run the route's
// real guards in order, map thrown errors to status codes the same way main.ts
// does, otherwise return 200.
async function dispatchAddContact(req: Request): Promise<Response> {
  const guards = RouteRegistry.getGuards(UserController, 'addContact');
  try {
    let guardResult: unknown = null;
    for (const guard of guards) {
      guardResult = await guard(req);
    }
    // Handler would run here; we don't exercise it (auth never passes in this
    // test). Return 200 to represent "passed all guards".
    return Response.json({ ok: true, user: guardResult ?? null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Not found') {
      return Response.json({ error: message }, { status: 404 });
    }
    if (
      message === 'Access token or API key required' ||
      message === 'Invalid or expired access token' ||
      message === 'Invalid API key'
    ) {
      return Response.json({ error: message }, { status: 401 });
    }
    return new Response('error', { status: 500 });
  }
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname === '/users/contacts') {
        return dispatchAddContact(req);
      }
      return new Response('Not Found', { status: 404 });
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  if (server) server.stop(true);
  if (originalFlag === undefined) delete process.env.CONTACTS_ENABLED;
  else process.env.CONTACTS_ENABLED = originalFlag;
});

const post = () =>
  fetch(`${baseUrl}/users/contacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'someone@example.com' }),
  });

describe('POST /users/contacts — CONTACTS_ENABLED gate (E2E)', () => {
  test('returns 404 when disabled, even with no auth (gate short-circuits before auth)', async () => {
    process.env.CONTACTS_ENABLED = 'false';
    const res = await post();
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not found' });
  });

  test('returns 404 when unset (disabled-when-unset)', async () => {
    delete process.env.CONTACTS_ENABLED;
    const res = await post();
    expect(res.status).toBe(404);
  });

  test('passes the contacts gate when enabled, then 401 at auth (no credentials)', async () => {
    process.env.CONTACTS_ENABLED = 'true';
    const res = await post();
    // Not 404 — proves the gate let it through; auth then rejects the tokenless
    // request with 401.
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'Access token or API key required' });
  });
});
