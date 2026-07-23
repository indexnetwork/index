---
name: review-connect-routing
description: "Review or design Index connect-link (/c/:code) routing changes safely. Use when a PR changes connect links, Telegram/web redirect behavior, preferredSurface/clientSurface, user_socials-based reachability, or drops connect_links columns. Prevents forcing the clicker into Telegram based only on the counterparty and flags mixed-version migration risk."
---

# review-connect-routing

Use this before approving or implementing changes to connect links (`/c/:code`, `/c/:code/go`), especially changes that touch Telegram routing, `preferredSurface` / `clientSurface`, or the `connect_links` schema.

## Product invariant

A connect-link click must respect the **clicker/client context**, not just the counterparty's reachability.

Do **not** auto-route to Telegram solely because the counterparty has a Telegram handle. That can force a clicker who does not have Telegram — or who opened from the web/app — into the wrong surface. Telegram reachability is necessary for a Telegram deep link, but not sufficient to choose Telegram.

Prefer one of these designs:

1. Honor an explicit delivery/click/client surface signal (`x-index-surface`, `clientSurface`, stored link delivery surface, or equivalent).
2. Offer an explicit choice when multiple surfaces are possible.
3. Default to the web/app unless the clicker explicitly arrived through a Telegram-specific flow.

## Review checklist

1. Identify whose preference the routing signal represents:
   - clicker/current client: good candidate for redirect choice
   - link minter/initiator: can be stale or wrong
   - counterparty reachability only: insufficient and likely wrong
2. Verify the fallback matrix:
   - clicker wants/arrives via web + counterparty has Telegram → should not force Telegram
   - Telegram-specific flow + counterparty has Telegram → `t.me` may be OK
   - Telegram-specific flow + no counterparty handle → web fallback
   - no explicit surface signal → safe default, usually web/app or chooser
3. Keep identity-binding uses separate from routing decisions. `x-index-surface` / `clientSurface` may still matter for Telegram identity binding even if it should not blindly drive redirects.
4. If dropping a routing column such as `connect_links.preferred_surface`, require a compatibility plan:
   - first deploy code that no longer reads/writes the column while the column remains
   - drop the column in a later PR after rollout
   - avoid migrations that make rollback or mixed-version deploys fail
5. Require tests for the matrix above, especially "counterparty has Telegram but clicker/web context should stay web".

## PR handling precedent

PR #1070 was closed without merging because it routed by the counterparty's live Telegram reachability alone and dropped `connect_links.preferred_surface`. That would have forced clickers into Telegram whenever the counterparty had a handle, even when the clicker did not have Telegram or intended to continue on web.

## See also

- `verify-production-release` — destructive Drizzle migration and rollback/mixed-version deployment checks.
