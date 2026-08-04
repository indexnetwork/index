# Mac API client boundary

This folder is the standalone API-consumption boundary for the native macOS/iOS prototypes under `apps/mac`.

It is now **wired into `IndexApp`**: `assemble.py` inlines `client.mjs` + `mappers.mjs` + `deeplink.mjs` into `Resources/index.html` as a `window.IndexApi` IIFE, and `src/index-amiga/api.jsx` builds a live client from `window.INDEX_NATIVE` (injected by the Swift shell). When no native credential is present (browser preview), the app falls back to `window.INDEX_DATA` demo data. `IndexApp-iOS` is not wired yet.

## Role

- Own calls to `services/api` (`/api/auth/me`, `/api/intents/list`, `/api/opportunities/radar`, `/api/questions`, conversations, etc.).
- Keep endpoint paths aligned with the decorated controllers in `services/api/src/controllers` and the `/api` global prefix in `services/api/src/main.ts`.
- Convert backend DTOs into the existing prototype shapes (`INTENTS`, people/opportunity cards, clarifiers).
- Keep auth/token handling isolated from UI components.
- Preserve fake-data fallback in the app for signed-out browser preview.

## Authentication

The native macOS client authenticates with a **90-day CLI API key** minted via the browser `/cli-auth` flow (mirroring `packages/cli/src/login.command.ts`) and stored in the Keychain by the Swift shell. All requests send it as the **`x-api-key`** header:

- `client.mjs` accepts a `getApiKey` option (read lazily) alongside the existing `getToken`; when it resolves to a value, the client attaches `x-api-key`.
- Fetch-based SSE in `api.jsx` (`streamChat`, `streamInbox`) sets `x-api-key` directly, since `EventSource` cannot set headers.
- `services/api/src/lib/cors.ts` includes `x-api-key` in `Access-Control-Allow-Headers`.

API-key chat uses the **orchestrator** persona (not the Signal web persona). Session-only routes (`/intents/:id/visit`, `/questions/counts`, agent management writes, account deletion) are unreachable with an API key and are skipped or read-only in the UI.

## Current files

- `client.mjs` — dependency-free fetch wrapper and resource methods for the Index API (`x-api-key` aware).
- `mappers.mjs` — pure mappers from API responses to the current mac prototype view models.
- `deeplink.mjs` — pure `parseDeepLink(url)`: the single place where a `https://index.network/o|u|c/<id>` universal link or an `index://` alias becomes a route. The Swift shell only delivers URLs; it makes no routing decision. Contract tested in `deeplink.spec.mjs`.
- `index.mjs` — barrel exports for future consumers.

## Endpoint coverage checked against controllers

The client base URL includes `/api`, matching the global prefix applied in `services/api/src/main.ts`. Resource methods currently cover these controller routes:

- `auth.controller.ts`: `GET /auth/me`, `PATCH /auth/profile/update`, `POST /auth/cli-credential/revoke`
- `network.controller.ts`: `GET /networks`, `GET /networks/:id/overview`, `GET /networks/:id/my-intents`, `POST /networks`, `POST /networks/:id/join`, `POST /networks/:id/leave`
- `intent.controller.ts`: `POST /intents/list`, `GET /intents/:id`, `PATCH /intents/:id/archive`, `PATCH /intents/:id/status`
- `opportunity.controller.ts`: `GET /opportunities`, `GET /opportunities/radar` (incl. `scopeType=intent`), `GET /opportunities/chat-context`, `GET /opportunities/:id`, `GET /opportunities/:id/invite-message`, `PATCH /opportunities/:id/status` (incl. intent scope), `POST /opportunities/:id/start-chat` (incl. intent scope)
- `question.controller.ts`: `GET /questions` (incl. `scopeType=intent`, `conversationId`, `mode`), `POST /questions/:id/answer`, `POST /questions/:id/dismiss`
- `conversation.controller.ts`: `GET /conversations`, `GET /conversations/negotiations`, `GET /conversations/:id/messages`, `POST /conversations/:id/messages`, `POST /conversations/dm`, `PATCH /conversations/:id/metadata`, `DELETE /conversations/:id`
- `agent.controller.ts`: `GET /agents` (read-only; management writes are session-only)
- `tool.controller.ts`: `POST /tools/:toolName` (`client.tools.invoke`, available for REST tool calls)

Onboarding creates a real intent through the `create_intent` MCP tool via a single JSON-RPC `tools/call` to `/mcp` (`api.jsx`'s `mcpCall`), since intent creation has no plain REST POST. SSE endpoints are consumed directly via `fetch` (not through the resource methods): `POST /chat/stream` and `GET /conversations/stream`.
