---
name: review-web-persona-routing
description: "Design or review a main-web chat persona cutover without breaking CLI, onboarding, Telegram, or other consumers that share authentication and chat endpoints. Use when routing new web sessions to a restricted persisted persona, making legacy web sessions read-only, or when session-vs-API-key provenance is too coarse to identify the browser product surface."
---

# Web persona cutover routing

Use a **dedicated server-selected web route**, not credential kind or a client-controlled
surface header, to define the product boundary.

## Why

In this repo, Better Auth bearer/session JWTs are used by both the browser and CLI.
`AuthGuard` provenance (`session` vs `api_key`) therefore cannot distinguish main web
from CLI or onboarding. Globally changing `/chat/stream` for every `session` caller
silently breaks those consumers.

## Pattern

1. Keep the existing compatibility endpoint (`/chat/stream`) behavior unchanged for
   CLI, onboarding, and other non-web consumers.
2. Add a dedicated route such as `/chat/web/stream` guarded by
   `RateLimit('write'), SessionOnlyGuard`.
3. Have the main web composer explicitly call that route. The route itself supplies a
   server-owned surface enum (`web`); never infer authority from request body,
   `x-index-surface`, `Origin`, or `prefillMessages`.
4. Persist the selected persona at session creation. For follow-ups, treat stored
   persona as authoritative and reject request/stored mismatch or unknown values.
5. If scoped sessions are stable, include persona in the internal registry key (for
   example `signal-intent`) while preserving canonical public scope metadata.
6. Keep legacy sessions readable, but reject new web-route turns before attachments,
   scope mutation, graph selection, or message writes. Return a typed product-safe
   action that starts a separate new-persona session; never rewrite history.
7. Use a positive tool allowlist for the restricted persona. Narrow surviving shared
   tool schemas/handlers when their normal modes exceed the persona's authority.

## Verification matrix

- flag off: dedicated web route preserves the old persona;
- flag on: new web route persists the new persona and follow-ups inherit it;
- compatibility route: CLI/onboarding remain on the old persona;
- persona spoof/mismatch and unknown stored persona fail closed;
- legacy web history loads, but a turn is rejected before side effects;
- Telegram/MCP/direct-tool paths never enter the web route;
- frontend handles non-SSE typed errors and removes optimistic/queued placeholders;
- a continuation action forces the next new session to the new persona even under
  cached feature-flag skew.

## See also

- **manage-feature-flags** — ship the new route/persona dark, then flip Railway and
  the local mirror only with explicit approval.
- **review-connect-routing** — related guidance for server-vs-client surface
  routing decisions.
