# Mac API client boundary

This folder is the standalone API-consumption boundary for the native macOS prototype under `apps/mac`.

It is now **wired into the mac app**: `scripts/assemble.py` inlines `client.mjs` + `mappers.mjs` + `deeplink.mjs` into `Resources/index.html` as a `window.IndexApi` IIFE, and `src/ui/bridge.jsx` builds a live client from `window.INDEX_NATIVE` (injected by the Swift shell). When no native credential is present (browser preview), the app falls back to `window.INDEX_DATA` demo data.

## Role

- Own calls to `services/api` (`/api/auth/me`, `/api/intents/list`, `/api/opportunities/radar`, conversations, etc.).
- Keep endpoint paths aligned with the decorated controllers in `services/api/src/controllers` and the `/api` global prefix in `services/api/src/main.ts`.
- Convert backend DTOs into the existing prototype shapes (`INTENTS`, people/opportunity cards).
- Keep auth/token handling isolated from UI components.
- Preserve fake-data fallback in the app for signed-out browser preview.

## Authentication

The native macOS client uses an ordinary 90-day Better Auth API key minted through the web `/cli-auth` handshake. The Swift shell stores it only in the Keychain and supplies it directly to `NativeAPIRequestBridge`; JavaScript receives only credential-free structured operations and nonsecret authentication status. Credentials and API-key headers are never exposed to the WKWebView, browser callback, local storage, or logs.

Native REST, MCP, upload, and bounded SSE requests are method/path allowlisted before the Swift bridge attaches the credential. Session-only routes, including key management, remain unavailable through this principal. Logout quarantines in-flight work and deletes Keychain state; the key itself is removed in Index web settings.

## Current files

- `client.mjs` — dependency-free resource wrapper supporting browser bearer tokens or the credential-free native structured bridge.
- `mappers.mjs` — pure mappers from API responses to the current mac view models.
- `deeplink.mjs` — pure `parseDeepLink(url)`: the single place where a configured Index universal link or an `index://` alias becomes a route. Swift delivers URLs without deciding their destination.
- `native-api-bridge.mjs` — correlation, cancellation, event, and resource wrappers over native structured operations.
- `index.mjs` — barrel exports for consumers.

## Endpoint coverage checked against controllers

The client base URL includes `/api`, matching the global prefix applied in `services/api/src/main.ts`. Resource methods currently cover these controller routes:

- `auth.controller.ts`: `GET /auth/me`, `PATCH /auth/profile/update`
- `network.controller.ts`: `GET /networks`, `GET /networks/:id/overview`, `GET /networks/:id/my-intents`, `POST /networks`, `POST /networks/:id/join`, `POST /networks/:id/leave`
- `intent.controller.ts`: `POST /intents/list`, `GET /intents/:id`, `PATCH /intents/:id/archive`, `PATCH /intents/:id/status`
- `opportunity.controller.ts`: `GET /opportunities`, `GET /opportunities/radar` (incl. `scopeType=intent`), `GET /opportunities/chat-context`, `GET /opportunities/:id`, `GET /opportunities/:id/invite-message`, `PATCH /opportunities/:id/status` (incl. intent scope), `POST /opportunities/:id/start-chat` (incl. intent scope)
- `conversation.controller.ts`: `GET /conversations`, `GET /conversations/negotiations`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /conversations/dm`, `PATCH /conversations/:id/metadata`, `DELETE /conversations/:id`
- `agent.controller.ts`: `GET /agents` (read-only; management writes are session-only)
- `tool.controller.ts`: `POST /tools/:toolName` (`client.tools.invoke`; used for the onboarding-allowed `preview_user_context` / `confirm_user_context`)
- `enrichment.controller.ts`: `POST /enrichment/enrich` (`client.enrichment.trigger`; runs the full public-research enrichment inline and returns the resolved identity + discovered socials)

Onboarding creates a real intent through the `create_intent` MCP tool via a single JSON-RPC `tools/call` to `/mcp` (`bridge.jsx`'s `mcpCall`), since intent creation has no plain REST POST. SSE endpoints are consumed directly via `fetch` (not through the resource methods): `POST /chat/stream` and `GET /conversations/stream`.

## Data loading

Matches the web app's lazy contract:

| Phase | Calls | Notes |
|-------|-------|-------|
| **Boot** (`loadSnapshot`) | `GET /auth/me`, `POST /intents/list` (page 1, limit 100) | Blocking; `PEOPLE` and `NETWORKS` start empty |
| **Networks** (`loadNetworks`) | `GET /networks` | Background after boot; updates `env.networks` and `window.INDEX_DATA.NETWORKS` |
| **Intent open** (`refreshRadar`) | `GET /opportunities/radar` (skeleton then full) | Per selected intent; same `RADAR_STATUSES` as web |

Intent row badges use server `waitingOpportunityCount`. Deep links to opportunities fall back to `GET /opportunities/:id` when the card is not yet in loaded radar.
