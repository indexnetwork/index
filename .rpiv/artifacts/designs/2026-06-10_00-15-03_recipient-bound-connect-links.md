---
date: 2026-06-10T00:15:03+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Recipient-bound connect links"
tags: [design, connect-links, auth, opportunities, frontend]
status: ready
parent: /Users/aposto/Projects/index/.worktrees/research-recipient-bound-connect-links/.rpiv/artifacts/research/2026-06-09_23-41-51_recipient-bound-connect-links.md
last_updated: 2026-06-10T00:15:03+0300
last_updated_by: Yankı Ekin Yüksel
---

# Design: Recipient-bound Connect Links

## Summary
Recipient-bound connect links move the trust boundary from possession of a short code to an authenticated backend resolver. Public `/c/:code` no longer resolves the database row; it only bridges valid-looking codes to a frontend `/c/:code` continuation that preserves the opaque code through login and then calls authenticated `/api/c/:code/go`, where the backend compares `AuthenticatedUser.id` to `connect_links.user_id` before any greeting, approval, DM, or acceptance side effect.

## Requirements
- Require authentication before any short-link side effect for all connect-link kinds: `connect`, `send_direct`, `outreach`, and `approve_introduction`.
- Compare the authenticated account to the resolved `connect_links.user_id`; only the intended recipient may proceed.
- Preserve login continuity by carrying the short code through login instead of redirecting to a final `/u/:id/chat?msg=...` URL before recipient validation.
- Preserve existing correct-recipient destinations: Telegram-preferred links still try `t.me`, web links still go to profile chat or conversation routes with greeting text.
- Wrong-account, malformed, unknown, expired, and terminal links must present generic unavailable/not-found UX.
- Avoid JWTs in callback URLs; use the frontend authenticated API client, which attaches `Authorization: Bearer <jwt>`.
- Do not change schema or protocol/MCP link minting semantics; link rows already store recipient identity.

## Current State Analysis
The current short-link resolver is possession-based. Backend `/c/:code` and `/c/:code/go` are rate-limited but unauthenticated, resolve `connect_links.user_id`, and pass that stored recipient id into opportunity side-effect methods. The link rows already contain the intended recipient, but the browser account is never compared to that value.

### Key Discoveries
- `backend/src/controllers/connect-link.controller.ts:88-125` handles public `/c/:code`; it currently calls `resolveConnectLink(code)` and performs `approve_introduction` inline.
- `backend/src/controllers/connect-link.controller.ts:133-199` handles `/c/:code/go`; it currently generates greetings, calls `startChat`, `approveIntroduction`, Telegram helpers, and conversation lookup using `link.userId` as actor.
- `backend/src/services/connect-link.service.ts:183-193` returns a `ResolvedLink` containing stored `userId`, `opportunityId`, `kind`, `greeting`, and narrowed `preferredSurface`.
- `backend/src/services/connect-link.service.ts:197-247` can resolve expired opportunities to recipient-visible replacements and can extend link TTL; unauthenticated `/c/:code` must not invoke this in the new flow.
- `backend/src/guards/auth.guard.ts:26-43` verifies Better Auth JWTs from `Authorization: Bearer` or a query `token`; the chosen continuation avoids query tokens and uses bearer headers.
- `backend/src/main.ts:489-493` rewrites backend-host `/c/*` to `/api/c/*` for controller dispatch.
- `backend/src/main.ts:536-549` executes guards in order and passes the final guard result as the controller `user` argument.
- `frontend/src/lib/api.ts:46-48` attaches a bearer JWT on authenticated API calls.
- `frontend/src/contexts/AuthContext.tsx:32-47` supports `openLoginModal(callbackURL?)`; `frontend/src/components/AuthModal.tsx:57-66` and `frontend/src/components/AuthModal.tsx:114-121` pass callback URLs into magic-link and Google auth.
- `frontend/src/contexts/AuthContext.tsx:129-140` redirects unauthenticated users away from non-public routes; `/c/` must be added as public or the short code is lost before route-level login can run.
- `frontend/src/routes.tsx:1-153` has no `/c/:code` route today.
- `frontend/src/app/u/[id]/chat/page.tsx:33-38` is the existing one-shot login-modal pattern that preserves `window.location.href` through auth.
- `frontend/src/app/l/[code]/page.tsx:17-105` is the closest short-code route state-machine pattern for loading, auth-required, authenticated API, and error handling.

## Scope
### Building
- Refactor backend `ConnectLinkController.resolve` into a no-DB public bridge for syntactically valid short codes.
- Protect backend `ConnectLinkController.go` with `RateLimit('read'), AuthGuard` and recipient equality.
- Return masked 404s for unknown, expired, terminal, malformed, and wrong-account resolver failures.
- Preserve current destination construction after authorization for `connect`, `send_direct`, `outreach`, and `approve_introduction`.
- Add a typed frontend `connect-links` service and `APIContext` hook.
- Add frontend `/c/:code` continuation route that opens login with `window.location.href`, calls the authenticated resolver once authenticated, redirects to returned URLs, and renders confirmation/unavailable states.
- Register `/c/:code` in React Router and add `/c/` to public route prefixes.
- Add targeted backend and frontend regression tests for auth gating, wrong-account masking, route registration, public-prefix behavior, and link-kind preservation.

### Not Building
- No database schema changes; `connect_links.user_id` already stores recipient identity.
- No protocol package changes; protocol/MCP already mints `acceptUrl` with `viewerId` and `preferredSurface`.
- No JWTs in callback URLs or query params.
- No Better Auth cookie-session support in `AuthGuard`; the frontend uses existing bearer-token API flow.
- No changes to opportunity service semantics beyond making existing calls unreachable until recipient validation passes.
- No redesign of final chat pages or Telegram URL behavior.

## Decisions
### Public short-link bridge does not resolve DB before auth
**Ambiguity:** Public `/c/:code` could keep resolving rows before login for better dead-link UX, but `resolveConnectLink()` can also self-heal expired rows by extending TTL.

**Explored:**
- Option A — No DB before auth: public `/c/:code` validates only syntax and redirects/bridges the code to frontend continuation. This avoids public row lookup and TTL self-heal before account proof (`backend/src/services/connect-link.service.ts:237-247`).
- Option B — Validate before login: public `/c/:code` keeps DB existence/expiry checks, preserving current dead-link UX but retaining unauthenticated resolve behavior (`backend/src/controllers/connect-link.controller.ts:106`).

**Decision:** No DB before auth. For valid-looking codes, public `/c/:code` sends the browser to frontend `/c/:code`; authenticated `/c/:code/go` is the first DB trust point.

### Wrong-account failures are masked at the backend boundary
**Ambiguity:** The backend could return structured 403 while frontend masks it, or the backend itself could return 404 for mismatches.

**Explored:**
- Option A — Backend 404: wrong-account, missing, expired, and terminal links are indistinguishable at API boundary.
- Option B — API 403, UI 404: clearer internal status but exposes recipient-mismatch semantics to any authenticated caller.

**Decision:** Backend returns 404 for recipient mismatch. This matches the developer's Not Found UX decision and avoids a recipient oracle.

### Frontend continuation uses a new connect-links service
**Ambiguity:** The route could call `useAuthenticatedAPI()` directly like the invitation page, reuse `connectionsService`, or introduce a dedicated service.

**Explored:**
- Option A — New service: explicit `connect-links` domain boundary, typed response, and reusable hook via `APIContext`.
- Option B — Route-local API: fewer files, but route owns URL construction.
- Option C — Connections service: smaller than a new service, but mixes short-link continuation with connection-event actions.

**Decision:** Add `frontend/src/services/connect-links.ts`, wire it through `APIContext`, and consume it via `useConnectLinks()` in the continuation route.

### Existing opportunity side-effect methods remain the implementation surface
`OpportunityService.startChat`, `approveIntroduction`, `getCounterpartTelegramHandle`, `getCounterpartTelegramHandleForOpp`, and `getConversationIdForOpp` already enforce actor/business invariants and preserve destination semantics once called with the true authenticated recipient (`backend/src/services/opportunity.service.ts:563-596`, `backend/src/services/opportunity.service.ts:640-754`, `backend/src/services/opportunity.service.ts:1141-1197`). The design changes only when and with which actor id these methods are invoked.

## Architecture
### backend/src/controllers/connect-link.controller.ts:1-199 — MODIFY
Refactor public bridge and authenticated resolver.

```ts
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { resolveConnectLink } from '../services/connect-link.service';
import { opportunityService } from '../services/opportunity.service';

/** Route params when path has :code */
type RouteParams = Record<string, string>;

type ConnectLinkGoResponse =
  | { url: string }
  | { kind: 'approve_introduction' };

const CODE_PATTERN = /^[A-Za-z0-9]{10}$/;

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unavailable</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This opportunity is no longer available</h1>
<p style="color:#666">The opportunity behind this link has expired or been closed.</p>
</div></body></html>`;

function getFrontendUrl(): string {
  return (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network').replace(/\/+$/, '');
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFoundJson(): Response {
  return jsonError('Link not found', 404);
}

/**
 * ConnectLinkController: opaque short-link dispatcher.
 *
 * Public `/c/:code` is only a bridge into the frontend continuation route. It
 * deliberately does not resolve `connect_links` rows: account binding happens
 * on authenticated `/c/:code/go`, where the JWT user must match the stored
 * recipient before any opportunity side effect or destination lookup runs.
 */
@Controller('/c')
export class ConnectLinkController {
  /**
   * GET /c/:code — public short-link bridge.
   *
   * Valid-looking short codes are redirected to the frontend continuation route
   * with the same opaque code. The frontend preserves that URL through login and
   * calls authenticated `/api/c/:code/go`. This route performs no DB lookup and
   * no opportunity side effects.
   */
  @Get('/:code')
  @UseGuards(RateLimit('read'))
  async resolve(_req: Request, _user: unknown, params?: RouteParams) {
    const code = params?.code;
    if (!code) return new Response('Missing code', { status: 400 });

    if (!CODE_PATTERN.test(code)) {
      return new Response(EXPIRED_HTML, { status: 404, headers: { 'Content-Type': 'text/html' } });
    }

    return Response.redirect(`${getFrontendUrl()}/c/${code}`, 302);
  }

  /**
   * GET /c/:code/go — authenticated JSON resolver.
   *
   * Resolves the short code, verifies the authenticated user is the stored
   * recipient, then performs the kind-specific side effect and returns the final
   * destination. Unknown, terminal, malformed, and wrong-account links are all
   * masked as 404. No greeting generation, DM lookup, approval, or acceptance
   * runs until the recipient check passes.
   */
  @Get('/:code/go')
  @UseGuards(RateLimit('read'), AuthGuard)
  async go(_req: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const code = params?.code;
    if (!code) return jsonError('Missing code', 400);
    if (!CODE_PATTERN.test(code)) return notFoundJson();

    const link = await resolveConnectLink(code);
    if (!link) return notFoundJson();
    if (link.userId !== user.id) return notFoundJson();

    const frontendUrl = getFrontendUrl();
    const greetingForRecipient = async () => (
      link.greeting ?? (await opportunityService.getGreetingForCard(link.opportunityId, user.id))
    );

    if (link.kind === 'approve_introduction') {
      const result = await opportunityService.approveIntroduction(link.opportunityId, user.id);
      if ('error' in result) return jsonError(result.error, result.status);
      return Response.json({ kind: 'approve_introduction' } satisfies ConnectLinkGoResponse);
    }

    // `connect` (receiver flipping pending → accepted) and `send_direct`
    // (sender flipping draft/latent → accepted) both want the chat open and the
    // greeting ready to send. opportunityService.startChat handles both source
    // statuses; the semantic difference lives in the matrix that picked `kind`.
    if (link.kind === 'connect' || link.kind === 'send_direct') {
      const result = await opportunityService.startChat(link.opportunityId, user.id);
      if ('error' in result) return jsonError(result.error, result.status);

      const greeting = await greetingForRecipient();

      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandle(result.counterpartUserId);
        const target = handle
          ? (greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`)
          : (greeting
              ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
              : `${frontendUrl}/u/${result.counterpartUserId}/chat`);
        return Response.json({ url: target } satisfies ConnectLinkGoResponse);
      }

      const target = greeting
        ? `${frontendUrl}/u/${result.counterpartUserId}/chat?msg=${encodeURIComponent(greeting)}`
        : `${frontendUrl}/u/${result.counterpartUserId}/chat`;
      return Response.json({ url: target } satisfies ConnectLinkGoResponse);
    }

    if (link.kind === 'outreach') {
      const greeting = await greetingForRecipient();

      if (link.preferredSurface === 'telegram') {
        const handle = await opportunityService.getCounterpartTelegramHandleForOpp(link.opportunityId, user.id);
        if (handle) {
          const target = greeting ? `https://t.me/${handle}?text=${encodeURIComponent(greeting)}` : `https://t.me/${handle}`;
          return Response.json({ url: target } satisfies ConnectLinkGoResponse);
        }
      }
      const conversationId = await opportunityService.getConversationIdForOpp(link.opportunityId, user.id);
      const target = conversationId
        ? `${frontendUrl}/conversations/${conversationId}${greeting ? `?msg=${encodeURIComponent(greeting)}` : ''}`
        : frontendUrl;
      return Response.json({ url: target } satisfies ConnectLinkGoResponse);
    }

    return jsonError('Unknown link kind', 400);
  }
}
```

### backend/tests/connect-link.e2e.spec.ts:1-127 — MODIFY
Update public bridge/controller tests and add authenticated resolver checks.

```ts
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
```

### backend/tests/connect-link.surface.spec.ts:1-188 — MODIFY
Update surface-aware redirect tests to pass an authenticated recipient and add wrong-account masking coverage.

```ts
import '../src/startup.env';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { ConnectLinkController } from '../src/controllers/connect-link.controller';
import type { AuthenticatedUser } from '../src/guards/auth.guard';
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

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^https:\/\/t\.me\/counterpart_handle/);
    expect(body.url).toContain('text=hello%20there');
  });

  test('preferredSurface=telegram + counterpart has no TG handle → web fallback', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
      preferredSurface: 'telegram',
    });

    const res = await controller.go(makeRequest(`/c/${code}/go`), mockUser(), { code });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
    expect(body.url).toContain('msg=hello%20there');
  });

  test('preferredSurface unset + counterpart has TG handle → web URL', async () => {
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
    expect(body.url).not.toMatch(/^https:\/\/t\.me/);
    expect(body.url).toContain(`${FRONTEND_URL}/u/${COUNTERPART_ID}/chat`);
  });

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
  });

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
  });

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
  });

  test('wrong authenticated recipient is masked as 404 before destination side effects', async () => {
    const { code } = await mintConnectLink({
      userId: CALLER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'hello there',
      preferredSurface: 'telegram',
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
  });

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
        preferredSurface: 'telegram',
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
  });
});
```

### frontend/src/services/connect-links.ts — NEW
Typed frontend service for authenticated connect-link continuation.

```ts
export type ConnectLinkResolution =
  | { url: string }
  | { kind: 'approve_introduction' };

/**
 * Authenticated connect-link continuation API.
 *
 * The backend masks unknown, expired, terminal, and wrong-account links as 404.
 * Callers should render the same unavailable UX for those failures.
 */
export const createConnectLinksService = (
  api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>,
) => ({
  resolveConnectLink: async (
    code: string,
    options?: { signal?: AbortSignal },
  ): Promise<ConnectLinkResolution> => {
    return api.get<ConnectLinkResolution>(`/c/${encodeURIComponent(code)}/go`, options);
  },
});
```

### frontend/src/contexts/APIContext.tsx:1-128 — MODIFY
Wire the new connect-links service into the provider and export `useConnectLinks()`.

```tsx
import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIndexesService } from '@/services/networks';
import { createIntentsService } from '@/services/intents';
import { createConnectionsService } from '@/services/connections';
import { createConnectLinksService } from '@/services/connect-links';
import { createSynthesisService } from '@/services/synthesis';
import { createDiscoverService } from '@/services/discover';
import { createFilesService } from '@/services/files';
import { createLinksService } from '@/services/links';
import { createAuthService } from '@/services/auth';
import { createIntegrationsService } from '@/services/integrations';
import { createAdminService } from '@/services/admin';
import { createUsersService } from '@/services/users';
import { createOpportunitiesService } from '@/services/opportunities';
import { createConversationService } from '@/services/conversation';
import { createApiKeysService } from '@/services/api-keys';
import { createAgentsService } from '@/services/agents';
import { createQuestionsService } from '@/services/questions';

export interface APIContextType {
  indexesService: ReturnType<typeof createIndexesService>;
  intentsService: ReturnType<typeof createIntentsService>;
  connectionsService: ReturnType<typeof createConnectionsService>;
  connectLinksService: ReturnType<typeof createConnectLinksService>;
  synthesisService: ReturnType<typeof createSynthesisService>;
  discoverService: ReturnType<typeof createDiscoverService>;
  filesService: ReturnType<typeof createFilesService>;
  linksService: ReturnType<typeof createLinksService>;
  authService: ReturnType<typeof createAuthService>;
  integrationsService: ReturnType<typeof createIntegrationsService>;
  adminService: ReturnType<typeof createAdminService>;
  usersService: ReturnType<typeof createUsersService>;
  opportunitiesService: ReturnType<typeof createOpportunitiesService>;
  conversationService: ReturnType<typeof createConversationService>;
  apiKeysService: ReturnType<typeof createApiKeysService>;
  agentsService: ReturnType<typeof createAgentsService>;
  questionsService: ReturnType<typeof createQuestionsService>;
}

const APIContext = createContext<APIContextType | undefined>(undefined);

export function APIProvider({ children }: { children: ReactNode }) {
  const api = useAuthenticatedAPI();

  const services = useMemo(() => ({
    indexesService: createIndexesService(api),
    intentsService: createIntentsService(api),
    connectionsService: createConnectionsService(api),
    connectLinksService: createConnectLinksService(api),
    synthesisService: createSynthesisService(api),
    discoverService: createDiscoverService(api),
    filesService: createFilesService(api),
    linksService: createLinksService(api),
    authService: createAuthService(api),
    integrationsService: createIntegrationsService(api),
    adminService: createAdminService(api),
    usersService: createUsersService(api),
    opportunitiesService: createOpportunitiesService(api),
    conversationService: createConversationService(api),
    apiKeysService: createApiKeysService(api),
    agentsService: createAgentsService(api),
    questionsService: createQuestionsService(api),
  }), [api]);

  return (
    <APIContext.Provider value={services}>
      {children}
    </APIContext.Provider>
  );
}

export function useAPI() {
  const context = useContext(APIContext);
  if (context === undefined) {
    throw new Error('useAPI must be used within an APIProvider');
  }
  return context;
}

export function useNetworks() {
  const { indexesService } = useAPI();
  return indexesService;
}

export function useIntents() {
  const { intentsService } = useAPI();
  return intentsService;
}

export function useConnections() {
  const { connectionsService } = useAPI();
  return connectionsService;
}

export function useConnectLinks() {
  const { connectLinksService } = useAPI();
  return connectLinksService;
}

export function useSynthesis() {
  const { synthesisService } = useAPI();
  return synthesisService;
}

export function useDiscover() {
  const { discoverService } = useAPI();
  return discoverService;
}

export function useFiles() {
  const { filesService } = useAPI();
  return filesService;
}

export function useLinks() {
  const { linksService } = useAPI();
  return linksService;
}

export function useAuth() {
  const { authService } = useAPI();
  return authService;
}

export function useAdmin() {
  const { adminService } = useAPI();
  return adminService;
}

export function useUsers() {
  const { usersService } = useAPI();
  return usersService;
}

export function useOpportunities() {
  const { opportunitiesService } = useAPI();
  return opportunitiesService;
}

export function useConversations() {
  const { conversationService } = useAPI();
  return conversationService;
}

export function useApiKeys() {
  const { apiKeysService } = useAPI();
  return apiKeysService;
}

export function useAgents() {
  const { agentsService } = useAPI();
  return agentsService;
}

export function useQuestionsService() {
  const { questionsService } = useAPI();
  return questionsService;
}
```

### frontend/src/contexts/AuthContext.tsx:129-137 — MODIFY
Add `/c/` to public route prefixes.

```tsx
const publicPrefixes = [
  '/simulation', '/l', '/c/', '/index/', '/blog', '/pages', '/about',
  '/login', '/s/', '/oauth/', '/found-in-translation', '/cli-auth', '/u/',
];
```

### frontend/src/routes.tsx:75-168 — MODIFY
Register `/c/:code` before the wildcard route.

```tsx
{
  path: "/c/:code",
  lazy: () => import("@/app/c/[code]/page"),
},
```

### frontend/src/app/c/[code]/page.tsx — NEW
Frontend continuation page that preserves login and calls the authenticated resolver.

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Loader2 } from 'lucide-react';

import { useAuthContext } from '@/contexts/AuthContext';
import { useConnectLinks } from '@/contexts/APIContext';
import { APIError } from '@/lib/api';

const CODE_PATTERN = /^[A-Za-z0-9]{10}$/;

type PageStep = 'loading' | 'auth-required' | 'resolving' | 'approved' | 'unavailable' | 'error';

interface PageState {
  step: PageStep;
  error: string | null;
}

function CenteredState({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FDFDFD] px-6">
      <div className="max-w-md text-center">{children}</div>
    </div>
  );
}

export default function ConnectLinkContinuationPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, isReady, isLoading: authLoading, openLoginModal } = useAuthContext();
  const connectLinks = useConnectLinks();
  const loginPromptedRef = useRef(false);
  const attemptedCodeRef = useRef<string | null>(null);
  const [state, setState] = useState<PageState>({ step: 'loading', error: null });

  useEffect(() => {
    if (!code || !CODE_PATTERN.test(code)) {
      setState({ step: 'unavailable', error: null });
      return;
    }

    if (!isReady || authLoading) {
      setState({ step: 'loading', error: null });
      return;
    }

    if (!isAuthenticated) {
      attemptedCodeRef.current = null;
      setState({ step: 'auth-required', error: null });
      if (!loginPromptedRef.current && typeof window !== 'undefined') {
        loginPromptedRef.current = true;
        openLoginModal(window.location.href);
      }
      return;
    }

    if (attemptedCodeRef.current === code) return;
    attemptedCodeRef.current = code;
    setState({ step: 'resolving', error: null });

    const controller = new AbortController();
    connectLinks.resolveConnectLink(code, { signal: controller.signal })
      .then((result) => {
        if ('url' in result) {
          window.location.replace(result.url);
          return;
        }
        setState({ step: 'approved', error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof APIError && error.status === 404) {
          setState({ step: 'unavailable', error: null });
          return;
        }
        setState({
          step: 'error',
          error: error instanceof Error ? error.message : 'Could not open this link',
        });
      });

    return () => controller.abort();
  }, [authLoading, code, connectLinks, isAuthenticated, isReady, openLoginModal]);

  const openLogin = () => {
    if (typeof window !== 'undefined') {
      openLoginModal(window.location.href);
    } else {
      openLoginModal();
    }
  };

  if (state.step === 'loading' || state.step === 'resolving') {
    return (
      <CenteredState>
        <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-gray-400" />
        <h1 className="mb-2 text-xl font-semibold text-[#041729]">Connecting…</h1>
        <p className="text-sm text-gray-600">Preparing your connection. This usually takes a few seconds.</p>
      </CenteredState>
    );
  }

  if (state.step === 'auth-required') {
    return (
      <CenteredState>
        <h1 className="mb-2 text-xl font-semibold text-[#041729]">Sign in to continue</h1>
        <p className="mb-6 text-sm text-gray-600">This link is tied to a specific Index Network account.</p>
        <button
          type="button"
          onClick={openLogin}
          className="rounded bg-[#041729] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a2d4a]"
        >
          Sign in
        </button>
      </CenteredState>
    );
  }

  if (state.step === 'approved') {
    return (
      <CenteredState>
        <h1 className="mb-2 text-xl font-semibold text-[#041729]">Introduction approved</h1>
        <p className="mb-6 text-sm text-gray-600">You approved the introduction. Both parties will be connected shortly.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded bg-[#041729] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a2d4a]"
        >
          Go home
        </button>
      </CenteredState>
    );
  }

  if (state.step === 'unavailable') {
    return (
      <CenteredState>
        <h1 className="mb-2 text-xl font-semibold text-[#041729]">This opportunity is no longer available</h1>
        <p className="mb-6 text-sm text-gray-600">The opportunity behind this link has expired or been closed.</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="rounded bg-[#041729] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a2d4a]"
        >
          Go home
        </button>
      </CenteredState>
    );
  }

  return (
    <CenteredState>
      <h1 className="mb-2 text-xl font-semibold text-[#041729]">Could not open this link</h1>
      <p className="mb-6 text-sm text-gray-600">{state.error ?? 'Please try again, or contact support if this keeps happening.'}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded bg-[#041729] px-4 py-2 text-sm font-medium text-white hover:bg-[#0a2d4a]"
      >
        Try again
      </button>
    </CenteredState>
  );
}

export const Component = ConnectLinkContinuationPage;
```

### frontend/tests/auth-context.test.tsx:1-86 — MODIFY
Add public-prefix regression for `/c/:code`.

```tsx
test('allows unauthenticated users to stay on connect-link continuation routes', async () => {
  mocks.useSession.mockReturnValue({ data: null, isPending: false });

  renderAuthProviderAt('/c/Aa0Bb1Cc2D');

  expect(await screen.findByTestId('location')).toHaveTextContent('/c/Aa0Bb1Cc2D');
  expect(mocks.apiClient.get).not.toHaveBeenCalled();
});
```

### frontend/tests/routes.test.tsx:1-406 — MODIFY
Add route smoke coverage for `/c/:code`.

```tsx
// Add to the APIContext mock return object:
useConnectLinks: () => noopService,

// Add to Route rendering smoke tests:
test('/c/:code — Connect-link continuation page renders without crashing', async () => {
  const { Component } = await import('@/app/c/[code]/page');
  const { container } = renderWithRouter(<Component />, {
    route: '/c/Aa0Bb1Cc2D',
  });
  expect(container).toBeTruthy();
});
```

### frontend/src/app/c/[code]/page.test.tsx — NEW
Continuation-route unit tests for login prompt, correct-user redirect/confirmation, and unavailable states.

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const mocks = vi.hoisted(() => ({
  authContext: {
    isReady: true,
    isLoading: false,
    isAuthenticated: false,
    openLoginModal: vi.fn(),
  },
  connectLinks: {
    resolveConnectLink: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => mocks.authContext,
}));

vi.mock('@/contexts/APIContext', () => ({
  useConnectLinks: () => mocks.connectLinks,
}));

vi.mock('@/lib/api', () => ({
  APIError: class APIError extends Error {
    constructor(
      message: string,
      public status: number,
      public response?: unknown,
    ) {
      super(message);
      this.name = 'APIError';
    }
  },
}));

import { APIError } from '@/lib/api';
import { Component as ConnectLinkContinuationPage } from './page';

function renderPage(route = '/c/Aa0Bb1Cc2D') {
  window.history.pushState({}, '', route);
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/c/:code" element={<ConnectLinkContinuationPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConnectLinkContinuationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authContext.isReady = true;
    mocks.authContext.isLoading = false;
    mocks.authContext.isAuthenticated = false;
    mocks.connectLinks.resolveConnectLink.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('opens login with the current /c/:code URL when unauthenticated', async () => {
    renderPage();

    expect(await screen.findByText('Sign in to continue')).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.authContext.openLoginModal).toHaveBeenCalledWith(window.location.href);
    });
    expect(mocks.connectLinks.resolveConnectLink).not.toHaveBeenCalled();
  });

  test('calls the authenticated resolver once and redirects for URL responses', async () => {
    mocks.authContext.isAuthenticated = true;
    mocks.connectLinks.resolveConnectLink.mockResolvedValue({ url: 'https://example.com/next' });
    const replaceSpy = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

    renderPage();

    await waitFor(() => {
      expect(mocks.connectLinks.resolveConnectLink).toHaveBeenCalledTimes(1);
      expect(mocks.connectLinks.resolveConnectLink).toHaveBeenCalledWith('Aa0Bb1Cc2D', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(replaceSpy).toHaveBeenCalledWith('https://example.com/next');
    });
  });

  test('renders introduction-approved confirmation for approve responses', async () => {
    mocks.authContext.isAuthenticated = true;
    mocks.connectLinks.resolveConnectLink.mockResolvedValue({ kind: 'approve_introduction' });

    renderPage();

    expect(await screen.findByText('Introduction approved')).toBeInTheDocument();
  });

  test('renders unavailable state for backend 404 responses', async () => {
    mocks.authContext.isAuthenticated = true;
    mocks.connectLinks.resolveConnectLink.mockRejectedValue(new APIError('Link not found', 404));

    renderPage();

    expect(await screen.findByText('This opportunity is no longer available')).toBeInTheDocument();
  });
});
```

## Slices
### Slice 1: Authenticated backend resolver

**Files**: `backend/src/controllers/connect-link.controller.ts`, `backend/tests/connect-link.e2e.spec.ts`, `backend/tests/connect-link.surface.spec.ts`

#### Automated Verification:
- [ ] Backend connect-link tests pass: `cd backend && bun test tests/connect-link.e2e.spec.ts tests/connect-link.surface.spec.ts`
- [ ] Guard order is present on the side-effecting resolver: `grep -n "@UseGuards(RateLimit('read'), AuthGuard)" backend/src/controllers/connect-link.controller.ts`
- [ ] Public `/c/:code` no longer resolves DB rows: `grep -n "resolveConnectLink(code)" backend/src/controllers/connect-link.controller.ts` appears only inside `go`, not inside `resolve`

#### Manual Verification:
- [ ] Public `/c/:code` performs only code syntax validation and redirects to `${FRONTEND_URL}/c/:code` for well-formed codes.
- [ ] Wrong-account `/c/:code/go` returns `{ "error": "Link not found" }` with 404 before greeting generation or opportunity side effects.
- [ ] Correct-recipient Telegram/web destination behavior in existing surface-aware tests remains unchanged except authenticated user is now passed to `go`.
- [ ] Ratify known Slice 1 atomicity tension: public `/c/:code` redirects to the frontend continuation route that is introduced in Slice 2; do not deploy Slice 1 alone unless a temporary frontend route exists.

### Slice 2: Frontend continuation service and route

**Files**: `frontend/src/services/connect-links.ts`, `frontend/src/contexts/APIContext.tsx`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/routes.tsx`, `frontend/src/app/c/[code]/page.tsx`

#### Automated Verification:
- [ ] Connect-link service is wired through APIContext: `grep -n "connectLinksService" frontend/src/contexts/APIContext.tsx`
- [ ] Frontend `/c/:code` route is registered: `grep -n 'path: "/c/:code"' frontend/src/routes.tsx`
- [ ] `/c/` is public for unauthenticated continuation: `grep -n "'/c/'" frontend/src/contexts/AuthContext.tsx`

#### Manual Verification:
- [ ] Logged-out visits to frontend `/c/:code` open the login modal with `window.location.href` as callback.
- [ ] After login, the route calls `connectLinks.resolveConnectLink(code)` exactly once per code and redirects for `{ url }` responses.
- [ ] `{ kind: 'approve_introduction' }` renders an in-app confirmation instead of redirecting.
- [ ] Backend 404 responses render the generic unavailable/not-found state.

### Slice 3: Frontend and auth-route regression coverage

**Files**: `frontend/tests/auth-context.test.tsx`, `frontend/tests/routes.test.tsx`, `frontend/src/app/c/[code]/page.test.tsx`

#### Automated Verification:
- [ ] Frontend auth and route tests pass: `cd frontend && bun test tests/auth-context.test.tsx tests/routes.test.tsx src/app/c/[code]/page.test.tsx`
- [ ] AuthContext test asserts `/c/:code` remains public for unauthenticated users: `grep -n "connect-link continuation" frontend/tests/auth-context.test.tsx`
- [ ] Route smoke tests include `/c/:code`: `grep -n 'Connect-link continuation page' frontend/tests/routes.test.tsx`

#### Manual Verification:
- [ ] The continuation page test covers logged-out login callback preservation.
- [ ] The continuation page test covers authenticated `{ url }` redirects.
- [ ] The continuation page test covers `{ kind: 'approve_introduction' }` confirmation.
- [ ] The continuation page test covers backend 404 rendering generic unavailable UX.

### Slice 4: Verification hardening for all link kinds

**Files**: `backend/tests/connect-link.e2e.spec.ts`, `backend/tests/connect-link.surface.spec.ts`

#### Automated Verification:
- [ ] Backend connect-link tests pass with all link kinds covered: `cd backend && bun test tests/connect-link.e2e.spec.ts tests/connect-link.surface.spec.ts`
- [ ] Surface tests cover all authenticated resolver kinds: `grep -n "send_direct\|outreach\|approve_introduction" backend/tests/connect-link.surface.spec.ts`
- [ ] Public e2e tests prove `approve_introduction` no longer approves inline: `grep -n "approve-introduction code redirects" backend/tests/connect-link.e2e.spec.ts`

#### Manual Verification:
- [ ] `connect` and `send_direct` both preserve web chat destination behavior for the correct recipient.
- [ ] `outreach` remains behind the recipient check before conversation lookup.
- [ ] `approve_introduction` mutates only through authenticated `/go` and returns `{ kind: 'approve_introduction' }`.
- [ ] Wrong-account calls for all four link kinds return 404 and leave status/approval state unchanged.

## Desired End State
Correct recipient opening a daily-brief connect link while logged out:

```text
GET https://protocol.example/c/AbCd123456
  -> backend validates code syntax only
  -> 302 https://app.example/c/AbCd123456
  -> frontend opens login with callbackURL=https://app.example/c/AbCd123456
  -> after auth, frontend calls GET /api/c/AbCd123456/go with Authorization bearer
  -> backend compares authenticated user.id to resolved connect_links.user_id
  -> backend starts chat/builds destination and returns { url }
  -> frontend window.location.replace(url)
```

Wrong account opening the same link:

```text
GET /api/c/AbCd123456/go with Authorization for other user
  -> resolveConnectLink(code)
  -> link.userId !== authenticated user.id
  -> 404 { "error": "Link not found" }
  -> frontend renders unavailable/not-found state
  -> no greeting generation, startChat, approveIntroduction, or DM lookup occurs
```

Frontend service usage:

```ts
const connectLinks = useConnectLinks();
const result = await connectLinks.resolveConnectLink(code);
if (result.url) window.location.replace(result.url);
```

## File Map
```text
backend/src/controllers/connect-link.controller.ts          # MODIFY — no-DB public bridge, authenticated recipient-bound resolver
backend/tests/connect-link.e2e.spec.ts                      # MODIFY — public bridge and authenticated resolver tests
backend/tests/connect-link.surface.spec.ts                  # MODIFY — authenticated surface-aware redirect and mismatch tests
frontend/src/services/connect-links.ts                      # NEW — typed continuation service
frontend/src/contexts/APIContext.tsx                        # MODIFY — connectLinksService provider/hook
frontend/src/contexts/AuthContext.tsx                       # MODIFY — `/c/` public prefix
frontend/src/routes.tsx                                     # MODIFY — `/c/:code` route
frontend/src/app/c/[code]/page.tsx                          # NEW — continuation route
frontend/tests/auth-context.test.tsx                        # MODIFY — public-prefix regression
frontend/tests/routes.test.tsx                              # MODIFY — route smoke regression
frontend/src/app/c/[code]/page.test.tsx                     # NEW — continuation route behavior tests
```

## Ordering Constraints
- Slice 1 must land first because frontend Slice 2 depends on authenticated `/api/c/:code/go` response semantics.
- Slice 2 must land before frontend tests in Slice 3.
- Slice 4 can be authored after Slice 1 but should be finalized after Slice 2 so test contracts and user-facing responses align.
- No slices are parallel in this design; each slice builds on locked prior behavior.

## Verification Notes
- Verify public `/c/:code` no longer calls `resolveConnectLink()` or opportunity side-effect methods before auth.
- Verify `GET /api/c/:code/go` has guard order `RateLimit('read'), AuthGuard`.
- Verify recipient mismatch returns 404 before greeting generation, `startChat`, `approveIntroduction`, `getCounterpartTelegramHandleForOpp`, or `getConversationIdForOpp`.
- Verify `approve_introduction` no longer mutates from public `/c/:code`; it is handled only by authenticated `/go`.
- Verify `outreach` remains protected because `getConversationIdForOpp()` can create a DM.
- Verify Telegram-preferred redirect behavior remains unchanged for the correct recipient.
- Verify `/c/` is included in frontend public prefixes so unauthenticated users are not redirected home before login continuation.
- Verify magic-link/Google callback URLs preserve frontend `/c/:code`, not final chat URLs.
- Run targeted backend tests: `cd backend && bun test tests/connect-link.e2e.spec.ts tests/connect-link.surface.spec.ts`.
- Run targeted frontend tests: `cd frontend && bun test tests/auth-context.test.tsx tests/routes.test.tsx src/app/c/[code]/page.test.tsx`.

## Performance Considerations
- The authenticated recipient comparison must happen before `getGreetingForCard()` to avoid unnecessary LLM/presenter work and opportunity context exposure.
- Public `/c/:code` performs only syntax validation and string redirect construction, reducing public DB load and eliminating unauthenticated TTL self-heal writes.
- The frontend continuation should guard against duplicate resolver calls with a `useRef`/abort pattern because React effects may re-run during auth/session refresh.

## Migration Notes
No schema migration is required. Existing links remain valid because their short codes and row shape are unchanged; the only behavior change is that resolving a link now requires signing into the stored recipient account.

## Pattern References
- `backend/src/controllers/opportunity.controller.ts:133-148` — authenticated GET pattern using `RateLimit('read'), AuthGuard` and service error mapping.
- `backend/src/controllers/opportunity.controller.ts:279-296` — authenticated action endpoint pattern that resolves params and returns structured service errors.
- `frontend/src/app/u/[id]/chat/page.tsx:33-38` — one-shot login modal preserving current URL.
- `frontend/src/app/l/[code]/page.tsx:17-105` — short-code route state machine for loading/auth/error.
- `frontend/src/services/opportunities.ts:129-204` — typed API service factory patterns.
- `frontend/src/contexts/APIContext.tsx:1-128` — service provider/hook wiring pattern.
- `backend/tests/connect-link.surface.spec.ts:30-163` — two-actor opportunity fixture and surface redirect assertions.
- `frontend/tests/auth-context.test.tsx:1-86` — AuthProvider route behavior test pattern.
- `frontend/tests/routes.test.tsx:1-406` — route smoke test pattern.

## Developer Context
**Q (discover: Intended user framing): For this connect-url login issue, what problem are you solving and who hits it?**
A: Daily brief user.

**Q (discover: Possession-based short links must change): From the probe I inferred that connect URLs are currently possession-based: `/c/:code` is unauthenticated, resolves `connect_links.user_id`, and calls `startChat(link.opportunityId, link.userId)` before web login can identify the browser account (`backend/src/controllers/connect-link.controller.ts:68,155`). Keep this behavior or change it?**
A: Change it.

**Q (discover: Preserve recipient binding through login): From the probe I inferred that after fallback to web chat, login returns to `/u/:id/chat?msg=...` and that URL has no connect code or intended-recipient user to compare against (`frontend/src/app/u/[id]/chat/page.tsx:34-36,102-110`). Should the feature preserve recipient binding through login?**
A: Bind through login.

**Q (discover: Scope across acceptance links): You clarified that nowhere should people accept other people's connections. Should this requirement cover only daily-brief `connect` links, or all short-link acceptance kinds the code supports?**
A: All acceptance links.

**Q (discover: Server-side recipient check): Where should the recipient check live for connect-link acceptance? Tradeoff: strongest server-side security vs smallest change to the existing redirect flow.**
A: Server-gated links.

**Q (discover: Wrong-account UX): What should users see when the link is opened by the wrong logged-in account or after logging in as the wrong account?**
A: Not found.

**Q (discover: Correct-recipient destination): For the correct recipient, what should happen after they authenticate through a connect link?**
A: Preserve destination.

**Q (discover: Include non-state-changing outreach links): Should non-state-changing short links, like `outreach` links that only redirect for an already-accepted opportunity, also require the same recipient-account check?**
A: Yes, all links.

**Q (`backend/src/controllers/connect-link.controller.ts:38`, `backend/src/guards/auth.guard.ts:26-43`, `frontend/src/lib/api.ts:46-48`): Static interstitial fetch omits credentials, AuthGuard requires bearer/query JWT, and the frontend API client attaches Authorization. Which continuation shape should the design prefer?**
A: Frontend continuation. Use a frontend route/modal callback that preserves the short code and calls an authenticated backend resolver via the API client; avoid JWTs in URLs.

**Q (design checkpoint: public `/c/:code` DB resolution): Backend `/c/:code` currently validates and resolves the DB row before returning HTML, and `resolveConnectLink()` can self-heal expired links by extending TTL (`backend/src/controllers/connect-link.controller.ts:106`, `backend/src/services/connect-link.service.ts:237`). For recipient-bound links, should unauthenticated `/c/:code` do any DB resolution before login?**
A: No DB before auth.

**Q (design checkpoint: wrong-account API status): After authenticated `/c/:code/go` resolves a link, if `AuthenticatedUser.id` differs from `connect_links.user_id`, should the backend itself return a masked 404 or return a structured 403 while the frontend displays generic Not Found? Evidence: auth errors are centrally structured (`backend/src/main.ts:602`), while your UX decision was “Not found.”**
A: Backend 404.

**Q (design checkpoint: frontend service placement): The frontend continuation route needs one authenticated call to `/api/c/:code/go`. Existing patterns include route-local `useAuthenticatedAPI()` in invitation flow (`frontend/src/app/l/[code]/page.tsx:33`) and typed service factories wired through `APIContext` (`frontend/src/contexts/APIContext.tsx:47`). Where should the connect-link continuation call live?**
A: New service.

**Q (design summary confirmation): Design summary above. Ready to proceed to decomposition?**
A: Proceed.

**Q (decomposition confirmation): 4 slices for recipient-bound connect links. Slice 1: authenticated backend resolver. Slice 2: frontend continuation route/service. Slice 3: frontend route/auth tests. Slice 4: backend all-kind hardening tests. Approve decomposition?**
A: Approve.

## Design History
- Slice 1: Authenticated backend resolver — approved as generated; verifier atomicity finding surfaced and ratified (frontend `/c/:code` target lands in Slice 2)
- Slice 2: Frontend continuation service and route — approved as generated
- Slice 3: Frontend and auth-route regression coverage — approved as generated
- Slice 4: Verification hardening for all link kinds — approved as generated

## References
- `/Users/aposto/Projects/index/.worktrees/research-recipient-bound-connect-links/.rpiv/artifacts/research/2026-06-09_23-41-51_recipient-bound-connect-links.md`
- `.rpiv/artifacts/discover/2026-06-09_23-32-44_recipient-bound-connect-links.md`
- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md`
- `.rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md`
- `.rpiv/artifacts/validation/2026-06-09_13-10-12_ind-354-connect-links-auth-redirect.md`
