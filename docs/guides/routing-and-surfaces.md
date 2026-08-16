# Routing and Surfaces

Read this before changing how an Index link or request decides **where a user ends up**:
universal links and the AASA file (`apps/web/server.ts`), the deep-link landing pages
(`apps/web/src/components/DeepLinkLanding.tsx`), the app-side parser
(`apps/mac/api/deeplink.mjs`), the `/c/:code` tombstone
(`services/api/src/controllers/connect-link.controller.ts`), or the chat route/persona
boundary.

## The governing rule

**Routing must respect the requester's own proven context** — not the counterparty's
reachability, not the minter's assumption at creation time, and not anything the client
merely declares.

A destination chosen from what someone *else* can be reached on, or from a surface
snapshotted when a link was created, is a guess about a person who is not there. It can
push a user into an app they do not use, or a surface they deliberately left. Prefer, in
order:

1. The context the request itself **proves** — the OS resolving a universal link, the
   server-owned route the client actually called.
2. An explicit choice offered to the user.
3. A safe default (web / landing page) — never a redirect derived from a third party's
   profile.

The universal-link design follows this structurally: the operating system decides
whether the app or the web page handles the URL, so no server-side guess is involved.

### Corollary: identity binding is not a routing decision

Keep the two separate, and keep the separation explicit in review. This is exactly why
the Telegram binding survived the connect-link removal while surface routing did not:
`x-index-telegram-username` / `x-index-telegram-handle` still upsert into `user_socials`
(after verifying the handle belongs to the authenticated user) because that is a claim
about *identity and reachability*. It feeds delivery. It never picks a destination.

A signal answering "who is this, and where can we reach them?" must not be silently
promoted into "where should this click land?".

## Deep links and acceptance

### Current state (2026-08)

Connect links are gone. Do not reintroduce them, and do not review as if they exist:

- `POST /opportunities/:id/connect-link`, `POST /:id/connect-token`, `GET /:id/connect`,
  `GET /:id/approve-introduction`, and `/c/:code/go` were deleted, along with `acceptUrl`
  minting on opportunity cards.
- Surface routing went with them: the `x-index-surface` request header, `clientSurface`
  threading in the protocol, and `connect_links.preferred_surface` reads no longer
  exist. **There is no surface signal to route on.**
- Acceptance is app-only. Opportunity cards carry `appUrl` =
  `https://index.network/o/<id>`; `packages/protocol` mints it for every MCP-facing card
  (`attachOpportunityAppLink` in `opportunity.tools.ts`, woven into the card prose beside
  `profileUrl`), so Claude Desktop, the CLI, the web, and Hermes all get it. The Hermes
  plugin additionally attaches the identical link to any MCP-forwarded payload carrying
  an `opportunityId`, and never overwrites one the backend already set. That URL opens
  the macOS app through a universal link, and the app makes the authenticated acceptance
  call. Without the app it renders a static landing page (download CTA on macOS, "open it
  on your Mac" elsewhere — the CTA target is still a placeholder route).
- `GET /c/:code` survives only as a tombstone: valid-looking codes 302 to
  `${WEB_APP_URL}/c/<code>`, everything else gets a 404 page. No DB lookup, no side
  effects.
- Universal links stay dead until `APPLE_TEAM_ID` is set on the web host (the AASA
  currently ships `TEAMIDPLACEHOLDER`) and a signed, notarized app is released.

### Review checklist

1. For any new redirect or link target, name **whose context the decision represents**:
   - the clicker / the resolving client → legitimate
   - the link minter at creation time → stale by construction
   - the counterparty's stored handles or reachability → wrong; reject
2. Do not reintroduce a client-supplied surface header as a routing input. A
   client-declared surface is unauthenticated, and that is why it was removed. A
   server-owned route, or the OS's own resolution, is the trustworthy boundary.
3. Deep-link paths must stay consistent across all four places that encode them: the
   AASA `components` list, the web routes, the app parser's route table, and the auth
   guard's public-prefix list. A path added to one and missed in another either 404s or,
   worse, bounces an unauthenticated visitor into login.
4. Landing pages are the no-app fallback: keep them unauthenticated and side-effect free
   — no API calls, no login continuation, no acceptance. Platform sniffing there is
   presentation only, never routing.
5. `connect_links` is still live schema, and the two-phase rule applies to its pending
   drop: the code that stopped reading and writing it ships first, the migration dropping
   it ships in a later PR after rollout, and the `/c/:code` tombstone stays until
   in-flight links age out (~30-day TTL). Do not fold the drop into a behavior change,
   and check rollback and mixed-version deploys.
6. Require tests at the level of the decision: parser unit tests for URL→route mapping, a
   static assertion on the AASA shape, and guard-level tests proving deep-link paths are
   public.

### Precedent

PR #1070 was closed without merging because it routed by the counterparty's live Telegram
reachability alone, *and* dropped `connect_links.preferred_surface` in the same change.
That would have forced clickers into Telegram whenever the counterparty had a handle —
even when the clicker had no Telegram or meant to continue on web — and it coupled a
behavior change to a destructive migration. Both halves of that precedent still bind: the
routing rule above, and the two-phase column/table drop.

## Web chat persona cutovers

The same rule governs the chat boundary: use a **dedicated server-selected web route**,
not credential kind and not a client-controlled header, to define the product boundary.

### Why

Better Auth bearer/session JWTs are used by both the browser and the CLI. `AuthGuard`
provenance (`session` vs `api_key`) therefore **cannot** distinguish main web from CLI or
onboarding. Globally changing `/chat/stream` for every `session` caller silently breaks
those consumers.

### Pattern

1. Keep the existing compatibility endpoint (`/chat/stream`) unchanged for CLI,
   onboarding, and other non-web consumers.
2. Add a dedicated route such as `/chat/web/stream`, guarded by
   `RateLimit('write'), SessionOnlyGuard`.
3. Have the main web composer call that route explicitly. The route itself supplies a
   server-owned surface enum (`web`); never infer authority from the request body, a
   client-declared surface header, `Origin`, or `prefillMessages`.
4. Persist the selected persona at session creation. For follow-ups, treat the stored
   persona as authoritative and reject request/stored mismatches or unknown values.
5. If scoped sessions are stable, include the persona in the internal registry key (for
   example `signal-intent`) while preserving canonical public scope metadata.
6. Keep legacy sessions readable, but reject new web-route turns *before* attachments,
   scope mutation, graph selection, or message writes. Return a typed product-safe action
   that starts a separate new-persona session; never rewrite history.
7. Use a positive tool allowlist for the restricted persona. Narrow any surviving shared
   tool schemas and handlers whose normal modes exceed the persona's authority.

### Verification matrix

- flag off: the dedicated web route preserves the old persona;
- flag on: the new web route persists the new persona, and follow-ups inherit it;
- compatibility route: CLI and onboarding remain on the old persona;
- persona spoof/mismatch and unknown stored persona fail closed;
- legacy web history loads, but a turn is rejected before side effects;
- Telegram, MCP, and direct-tool paths never enter the web route;
- the frontend handles non-SSE typed errors and removes optimistic/queued placeholders;
- a continuation action forces the next new session to the new persona even under cached
  feature-flag skew.

## See also

- [Feature flags](./feature-flags.md) — ship the new route or persona dark, then flip
  Railway and the local mirror only with explicit approval.
- `verify-production-release` skill — destructive-migration, rollback, and
  mixed-version deployment checks.
- `docs/specs/api-reference.md` — "Universal links and deep-link landing pages" and the
  Telegram identity-binding headers.
