---
name: review-connect-routing
description: "Review or design Index deep-link and opportunity-acceptance routing safely. Use when a PR changes universal links (https://index.network/o|u|c/...), the apple-app-site-association file, index:// scheme handling, the deep-link landing pages, the /c/:code tombstone, the pending connect_links table drop, or any routing that infers a destination surface from stored identity/reachability. Prevents routing a user into a surface they are not on, and flags mixed-version migration risk."
---

# review-connect-routing

Use this before approving or implementing changes to how an Index link decides where the
user ends up: universal links and the AASA file (`apps/web/server.ts`), the deep-link
landing pages (`apps/web/src/components/DeepLinkLanding.tsx`), the app-side parser
(`apps/mac/api/deeplink.mjs`), the `/c/:code` tombstone
(`services/api/src/controllers/connect-link.controller.ts`), or the remaining
`connect_links` table.

## Current state (branch `feat/app-deep-links-universal`, 2026-08)

Connect links are gone. Do not reintroduce them, and do not review as if they exist:

- `POST /opportunities/:id/connect-link`, `POST /:id/connect-token`, `GET /:id/connect`,
  `GET /:id/approve-introduction`, and `/c/:code/go` were deleted, along with `acceptUrl`
  minting on opportunity cards.
- Surface routing was deleted with them: the `x-index-surface` request header,
  `clientSurface` threading in the protocol, and `connect_links.preferred_surface` reads
  no longer exist. There is no surface signal to route on.
- Acceptance is app-only. Opportunities carry `appUrl` = `https://index.network/o/<id>`;
  that URL opens the macOS app through a universal link, and the app makes the
  authenticated acceptance call. Without the app it renders a static landing page
  (download CTA on macOS, "open it on your Mac" elsewhere).
- `GET /c/:code` survives only as a tombstone: valid-looking codes 302 to
  `${WEB_APP_URL}/c/<code>`, everything else gets a 404 page. No DB lookup, no side
  effects.
- Universal links are dead until `APPLE_TEAM_ID` is set on the web host (the AASA
  currently ships `TEAMIDPLACEHOLDER`) and a signed, notarized app is released.

## The durable lesson

**Routing must respect the clicker's own context — not the counterparty's reachability,
and not the minter's assumption at creation time.**

A destination chosen from what someone *else* can be reached on, or from a surface
snapshotted when a link was created, is a guess about a person who is not there. It can
push a user into an app they do not use or a surface they deliberately left. Prefer, in
order:

1. The context the click itself proves (the OS resolving a universal link, the client
   actually making the request).
2. An explicit choice offered to the user.
3. A safe default (web/landing), never a redirect derived from a third party's profile.

The universal-link design follows this rule structurally: the operating system decides
whether the app or the web page handles the URL, so no server-side guess is involved.

### Corollary: identity binding is not a routing decision

Keep them separate, and keep the separation explicit in review. This is exactly why the
Telegram binding survived the removal while the surface routing did not:
`x-index-telegram-username` / `x-index-telegram-handle` still upsert into `user_socials`
(after verifying the handle belongs to the authenticated user) because that is a claim
about *identity and reachability*. It feeds delivery. It never picks a destination.

A signal that answers "who is this and where can we reach them?" must not be silently
promoted into "where should this click land?".

## Review checklist

1. For any new redirect or link target, name whose context the decision represents:
   - the clicker / the resolving client: legitimate
   - the link minter at creation time: stale by construction
   - the counterparty's stored handles or reachability: wrong; reject
2. Do not add a client-supplied surface header back as a routing input. A client-declared
   surface is unauthenticated and was removed for this reason; a server-owned route or
   the OS's own resolution is the trustworthy boundary.
3. Deep-link paths must stay consistent across all four places that encode them: the AASA
   `components` list, the web routes, the app parser's route table, and the auth guard's
   public-prefix list. A path added to one and missed in another either 404s or, worse,
   bounces an unauthenticated visitor into login.
4. Landing pages are the no-app fallback and must stay unauthenticated and side-effect
   free — no API calls, no login continuation, no acceptance. Platform sniffing there is
   presentation only, never routing.
5. `connect_links` is still live schema. The two-phase rule applies to its pending drop:
   the code that stopped reading and writing it ships first, the migration dropping it
   ships in a later PR after rollout, and the `/c/:code` tombstone stays until in-flight
   links age out (~30-day TTL). Do not fold the drop into a behavior change, and check
   rollback and mixed-version deploys.
6. Require tests at the level of the decision: parser unit tests for URL→route mapping,
   a static assertion on the AASA shape, and guard-level tests proving deep-link paths
   are public.

## PR handling precedent

PR #1070 was closed without merging because it routed by the counterparty's live Telegram
reachability alone and dropped `connect_links.preferred_surface` in the same change. That
would have forced clickers into Telegram whenever the counterparty had a handle, even when
the clicker did not have Telegram or intended to continue on web — and it coupled a
behavior change to a destructive migration. Both halves of that precedent still bind:
the routing rule above, and the two-phase column/table drop.

## See also

- `verify-production-release` — destructive Drizzle migration and rollback/mixed-version
  deployment checks.
- `docs/specs/api-reference.md` — "Universal links and deep-link landing pages" and the
  Telegram identity-binding headers.
