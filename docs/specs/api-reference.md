---
title: "Protocol API Reference"
type: spec
tags: [api, controllers, endpoints, rest, protocol, authentication, sse]
created: 2026-03-26
updated: 2026-04-08
---

# Protocol API Reference

Complete reference for all HTTP endpoints exposed by the protocol server. All routes are prefixed with `/api` (global prefix). The server runs on port 3001 by default.

## Table of Contents

- [Authentication Patterns](#authentication-patterns)
- [Non-Controller Routes](#non-controller-routes)
- [Auth](#auth)
- [Agents](#agents)
- [Chat](#chat)
- [Conversation](#conversation)
- [Debug](#debug)
- [Network](#network)
- [Integration](#integration)
- [Intent](#intent)
- [Link](#link)
- [Opportunity](#opportunity)
- [Network Opportunity](#network-opportunity)
- [Profile](#profile)
- [Storage](#storage)
- [Subscribe](#subscribe)
- [Unsubscribe](#unsubscribe)
- [Tools](#tools)
- [User](#user)
- [Queue Monitoring (Dev Only)](#queue-monitoring-dev-only)

---

## Authentication Patterns

### AuthGuard

Most endpoints require the `AuthGuard`, which verifies JWT tokens statelessly via the local JWKS endpoint.

- **Header**: `Authorization: Bearer <jwt>`
- **Fallback**: `?token=<jwt>` query parameter
- **Errors**:
  - `401` — `Access token required` (no token provided)
  - `401` — `Invalid or expired access token` (verification failed)

The guard returns an `AuthenticatedUser` object with `id`, `email` (nullable), and `name` fields, which is passed to the handler as the second argument. Individual controllers may return additional 403/404 errors for user-level access checks.

### DebugGuard

Debug endpoints additionally require the `DebugGuard`, which gates access based on environment:

- **Enabled when**: `NODE_ENV === 'development'` or `ENABLE_DEBUG_API === 'true'`
- **Error**: `404` — `Not found` (when disabled)

Debug endpoints apply both guards: `DebugGuard` first, then `AuthGuard`.

### Public Routes

Some routes have no guard at all:
- `GET /api/auth/providers`
- `GET /api/chat/shared/:token`
- `GET /api/networks/share/:code`
- `GET /api/networks/public/:id`
- `POST /api/subscribe/`
- `GET /api/unsubscribe/:token`
- `GET /api/storage/avatars/:userId/:filename`
- `GET /api/storage/index-images/:userId/:filename`

### Error Response Format

All error responses follow a consistent JSON format:

```json
{ "error": "Error message description" }
```

---

## Non-Controller Routes

These routes are handled directly in `main.ts` before the controller routing loop.

### Health Check

```
GET /health
```

**Auth**: None

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2026-03-26T00:00:00.000Z",
  "service": "protocol-v2"
}
```

### Better Auth Routes

The following paths are delegated to Better Auth and are not handled by controllers:

- `/api/auth/sign-in`
- `/api/auth/sign-up`
- `/api/auth/sign-out`
- `/api/auth/session`
- `/api/auth/callback`
- `/api/auth/error`
- `/api/auth/get-session`
- `/api/auth/forget-password`
- `/api/auth/magic-link`
- `/api/auth/reset-password`
- `/api/auth/verify-email`
- `/api/auth/change-password`
- `/api/auth/change-email`
- `/api/auth/delete-user`
- `/api/auth/list-sessions`
- `/api/auth/revoke-session`
- `/api/auth/revoke-other-sessions`
- `/api/auth/update-user`
- `/api/auth/token`
- `/api/auth/jwks`
- `/api/auth/api-key/create`
- `/api/auth/api-key/list`
- `/api/auth/api-key/delete`

Refer to the [Better Auth documentation](https://www.better-auth.com/) for details on these endpoints.

API keys created for personal agents include `metadata.agentId`. MCP auth resolves API keys into `{ userId, agentId? }` identities, so the same user can authorize multiple agents with separate keys.

### MCP request header: `x-index-surface`

MCP clients SHOULD declare the rendering surface for their user on every request via the `x-index-surface` header. Accepted values: `telegram | web` (case-insensitive, whitespace-trimmed). Absent or unknown values are coerced to `web` (the default).

The value drives the click-time redirect on opportunity connect links (`/c/{code}/go`):

- `telegram` — when the target user has a Telegram handle, redirects to `https://t.me/{handle}?text=...`; falls back to the web chat URL if the target has no handle.
- `web` (or absent) — always redirects to `${FRONTEND_URL}/u/{counterpartUserId}/chat?msg=...`.

The surface is snapshotted onto each minted `connect_links` row at MCP-call time (the auth resolver reads the header, the protocol threads it through `ResolvedToolContext.clientSurface`, and `mintConnectLink` writes it). First mint wins for the link's lifetime; rotation of an expired row re-stamps the surface.

Today only EdgeClaw (the Telegram-bot MCP surface) sends `telegram`. Every other caller — Claude Desktop, the web app, Claude Code, the CLI — omits the header and gets the web fallback.

### Performance Stats (Dev Only)

```
GET /dev/performance
```

**Auth**: None (only available when `NODE_ENV !== 'production'`)

**Response**: JSON object with performance statistics.

---

## Auth

**Controller prefix**: `/auth`

### GET /api/auth/providers

Returns the list of configured social auth providers.

**Auth**: None (public)

**Response**:
```json
{
  "providers": ["google"],
  "emailPassword": true
}
```

- `providers` — array of enabled social providers (currently only `"google"` if configured)
- `emailPassword` — `true` when `NODE_ENV !== 'production'`

### GET /api/auth/me

Returns the current authenticated user with their full profile.

**Auth**: AuthGuard

**Response**:
```json
{
  "user": {
    "id": "...",
    "name": "...",
    "email": "...",
    "intro": "...",
    "avatar": "...",
    "location": "...",
    "timezone": "...",
    "socials": { ... },
    "isGhost": false,
    "notificationPreferences": { ... },
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

**Side effect**: If the user has a name and at least one social link but no profile, a background profile sync is triggered automatically.

### PATCH /api/auth/profile/update

Updates the authenticated user's profile fields and/or notification preferences.

**Auth**: AuthGuard

**Request body**:
```json
{
  "name": "string (optional)",
  "intro": "string (optional)",
  "avatar": "string (optional)",
  "location": "string (optional)",
  "timezone": "string (optional)",
  "socials": { "x": "...", "linkedin": "...", "github": "...", "websites": ["..."] },
  "notificationPreferences": {
    "connectionUpdates": true,
    "weeklyNewsletter": false
  }
}
```

**Response**: Same shape as `GET /api/auth/me`.

### DELETE /api/auth/account

Soft-deletes the authenticated user's account.

**Auth**: AuthGuard

**Response**:
```json
{ "success": true }
```

---

## Chat

**Controller prefix**: `/chat`

### POST /api/chat/message

Send a message to the chat graph for synchronous processing.

**Auth**: AuthGuard

**Request body**:
```json
{
  "message": "string (required)"
}
```

**Response**:
```json
{
  "response": "...",
  "error": "... (if any)"
}
```

### POST /api/chat/stream

SSE streaming endpoint for chat messages with context support. Streams graph events and LLM tokens in real-time.

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "message": "string | null (optional)",
  "sessionId": "string | null (optional — creates new session if omitted)",
  "useCheckpointer": "boolean (optional, default: true)",
  "fileIds": ["string (optional — file IDs to attach)"],
  "indexId": "string | null (optional — scope to a specific index)",
  "recipientUserId": "string | null (optional — DM recipient for ghost invites)",
  "prefillMessages": [
    { "role": "assistant | user", "content": "string (max 10000 chars)" }
  ]
}
```

**Response**: SSE stream (`Content-Type: text/event-stream`)

SSE event types:
- `status` — Processing status updates
- `routing` — Which subgraph was selected and why
- `subgraph_result` — Results from subgraph execution
- `debug_meta` — Graph execution metadata (graph name, iterations, tools)
- `done` — Final event with `sessionId`, full response text, `messageId`, `title`, and `suggestions`
- `error` — Error event with message and code `STREAM_ERROR`

**Response headers**:
- `X-Session-Id` — The session ID for this chat

### GET /api/chat/sessions

List all chat sessions for the authenticated user.

**Auth**: AuthGuard

**Response**:
```json
{
  "sessions": [...]
}
```

### POST /api/chat/session

Get a specific session with its messages (including assistant metadata).

**Auth**: AuthGuard

**Request body**:
```json
{
  "sessionId": "string (required)"
}
```

**Response**:
```json
{
  "session": { ... },
  "messages": [
    {
      "id": "...",
      "role": "user | assistant",
      "content": "...",
      "traceEvents": "... (assistant messages only)",
      "debugMeta": "... (assistant messages only)",
      "createdAt": "..."
    }
  ]
}
```

### POST /api/chat/session/delete

Delete a chat session.

**Auth**: AuthGuard

**Request body**:
```json
{
  "sessionId": "string (required)"
}
```

**Response**:
```json
{ "success": true }
```

### POST /api/chat/session/title

Update a chat session title.

**Auth**: AuthGuard

**Request body**:
```json
{
  "sessionId": "string (required)",
  "title": "string (required, non-empty)"
}
```

**Response**:
```json
{ "success": true, "title": "..." }
```

### POST /api/chat/session/share

Generate a share token for a chat session.

**Auth**: AuthGuard

**Request body**:
```json
{
  "sessionId": "string (required)"
}
```

**Response**:
```json
{ "shareToken": "..." }
```

### POST /api/chat/session/unshare

Remove the share token from a chat session.

**Auth**: AuthGuard

**Request body**:
```json
{
  "sessionId": "string (required)"
}
```

**Response**:
```json
{ "success": true }
```

### POST /api/chat/message/:id/metadata

Update message metadata with frontend trace events (called after streaming completes).

**Auth**: AuthGuard

**Path params**:
- `id` — Message ID

**Request body**:
```json
{
  "traceEvents": ["array of trace event objects (max 2000)"]
}
```

**Response**:
```json
{ "success": true }
```

### GET /api/chat/shared/:token

Get a shared chat session (read-only, public access).

**Auth**: None (public)

**Path params**:
- `token` — Share token

**Response**:
```json
{
  "session": {
    "id": "...",
    "title": "...",
    "createdAt": "..."
  },
  "messages": [
    {
      "id": "...",
      "role": "...",
      "content": "...",
      "createdAt": "..."
    }
  ]
}
```

---

## Agents

**Controller prefix**: `/agents`

All agent routes use `AuthGuard`.

### GET /api/agents

List the agents the current user owns or has been authorized to use.

**Response**:
```json
{
  "agents": [
    {
      "id": "...",
      "ownerId": "...",
      "name": "...",
      "description": "...",
      "type": "personal",
      "status": "active",
      "metadata": {},
      "transports": [],
      "permissions": [],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### POST /api/agents

Create a personal agent owned by the current user.

**Request body**:
```json
{
  "name": "My Claude Agent",
  "description": "Handles partner negotiations"
}
```

**Response**:
```json
{
  "agent": {
    "id": "...",
    "name": "My Claude Agent",
    "type": "personal",
    "status": "active",
    "transports": [],
    "permissions": []
  }
}
```

### GET /api/agents/me

Resolve and return the agent bound to the calling API key (`x-api-key` header). The key's `metadata.agentId` is read from the database and the matching agent is returned in the same shape as `GET /api/agents/:id`. Returns 400 if called with a JWT or with a key that has no agent binding. Used by personal-agent runtimes (e.g. the OpenClaw plugin setup wizard) to bootstrap their `agentId` from a single pasted API key, avoiding a separate agent-id input.

### GET /api/agents/:id

Fetch one agent by ID if the current user owns it or has a permission grant on it.

### PATCH /api/agents/:id

Update mutable fields on a personal agent.

**Request body**:
```json
{
  "name": "Updated Agent Name",
  "description": "optional or null",
  "status": "inactive"
}
```

**Notes**:
- System agents return `403` for mutation attempts.
- Empty patch bodies return `400`.

### DELETE /api/agents/:id

Soft-delete a personal agent and deactivate its transports.

**Response**: `204 No Content`

### POST /api/agents/:id/transports

Add a transport to an owned personal agent. The only supported channel is `mcp` — the agent authenticates with an API key (see `POST /api/agents/:id/tokens`) and pulls work from the Index Network MCP server and the negotiation pickup endpoint below. Transports are MCP-only.

**Request body (mcp channel)**:
```json
{
  "channel": "mcp",
  "config": {},
  "priority": 0
}
```

- `priority` — integer ordering hint when multiple transports on the same agent are eligible for the same event (higher priority first).

**Response**:
```json
{
  "transport": {
    "id": "...",
    "agentId": "...",
    "channel": "mcp",
    "active": true,
    "failureCount": 0
  }
}
```

### DELETE /api/agents/:id/transports/:transportId

Remove a transport from an owned personal agent.

**Response**: `204 No Content`

### POST /api/agents/:id/permissions

Grant the current user a permission set on an agent.

**Request body**:
```json
{
  "actions": ["manage:intents", "manage:negotiations"],
  "scope": "global",
  "scopeId": "optional-for-node-or-network"
}
```

**Response**:
```json
{
  "permission": {
    "id": "...",
    "agentId": "...",
    "userId": "...",
    "scope": "global",
    "scopeId": null,
    "actions": ["manage:intents", "manage:negotiations"],
    "createdAt": "..."
  }
}
```

### DELETE /api/agents/:id/permissions/:permissionId

Revoke a permission from an agent.

**Response**: `204 No Content`

### GET /api/agents/:id/tokens

List API keys bound to an owned personal agent. Raw key values are never returned — only stored metadata (id, name, creation timestamp).

**Response**:
```json
{
  "tokens": [
    { "id": "...", "name": "My Claude Agent API Key", "createdAt": "..." }
  ]
}
```

### POST /api/agents/:id/tokens

Create an API key bound to an owned personal agent. The backend issues the key through Better Auth and stores `metadata.agentId` automatically.

**Request body**:
```json
{
  "name": "My Claude Agent API Key"
}
```

**Response**:
```json
{
  "token": {
    "id": "...",
    "key": "idx_live_...",
    "name": "My Claude Agent API Key",
    "createdAt": "..."
  }
}
```

**Notes**:
- The raw `key` value is only returned once.
- System agents return `403`.

### DELETE /api/agents/:id/tokens/:tokenId

Revoke an API key bound to an owned personal agent.

**Response**: `204 No Content`

**Errors**:
- `404` if the token does not exist or is not bound to the route agent

### POST /api/agents/:id/negotiations/pickup

Claim the next pending negotiation turn for an owned personal agent. Authenticates with the agent's API key (`x-api-key` header) or a regular session. Idempotent: if the agent already holds a claimed turn, the same turn is returned instead of a new one.

The backend atomically transitions the oldest `tasks.state = 'waiting_for_agent'` row where the caller's user is a participant to `state = 'claimed'`. A 6-hour claim timeout is enqueued; if the agent does not submit a response in that window the turn is released back to `waiting_for_agent` for another claim attempt, and an unclaimed turn eventually falls through to the system `Index Negotiator` after 24 hours.

**Request body**: empty.

**Response (nothing to claim)**: `204 No Content`.

**Response (claimed)**:
```json
{
  "negotiationId": "...",
  "taskId": "...",
  "opportunity": {
    "id": "...",
    "reasoning": "Why the evaluator flagged this match",
    "actors": [ /* opportunity actor records */ ],
    "status": "negotiating"
  },
  "turn": {
    "number": 3,
    "deadline": "2026-04-14T12:00:00.000Z",
    "counterpartyAction": "counter",
    "history": [
      { "turnNumber": 0, "agent": "source", "action": "propose", "message": "..." },
      { "turnNumber": 1, "agent": "candidate", "action": "counter", "message": "..." },
      { "turnNumber": 2, "agent": "source", "action": "counter", "message": "..." }
    ]
  },
  "context": {
    "ownUser": { /* UserNegotiationContext for the claiming user */ },
    "otherUser": { /* UserNegotiationContext for the counterparty */ },
    "indexContext": { "networkId": "...", "prompt": "..." },
    "seedAssessment": { "score": 82, "reasoning": "...", "valencyRole": "..." },
    "isDiscoverer": true,
    "discoveryQuery": "optional — only set when the negotiation originated from a discovery query"
  }
}
```

- `turn.deadline` — ISO-8601 timestamp; the claim expires at `claimedAt + 6h`.
- `turn.counterpartyAction` — action from the preceding turn (`propose`, `counter`, `question`, `accept`, `reject`), or `"none"` if this is the first turn.
- `context.ownUser` / `context.otherUser` — the persisted absolute source/candidate context projected into the claiming user's perspective. May be `null` only for legacy tasks created before turn-context persistence landed.
- `opportunity` — `null` when the task has no linked opportunity.

**Errors**:
- `403` if the agent is not owned by the authenticated user.

### POST /api/agents/:id/negotiations/:negotiationId/respond

Submit a response for a negotiation turn previously claimed via `pickup`. Authenticates with the agent's API key or a session. The backend atomically CAS's the task from `claimed` (scoped to this `agentId`) to `working`, persists the turn, then either finalizes the negotiation (on `accept`, `reject`, or when the turn cap is reached) or returns it to `waiting_for_agent` for the counterparty.

**Request body**:
```json
{
  "action": "counter",
  "message": "optional free-form text shown to the other side",
  "assessment": {
    "reasoning": "Why the agent chose this action",
    "suggestedRoles": {
      "ownUser": "agent",
      "otherUser": "patient"
    }
  }
}
```

- `action` — one of `propose`, `accept`, `reject`, `counter`, `question`.
- `message` — optional string or `null`.
- `assessment.suggestedRoles.ownUser` / `.otherUser` — each one of `agent`, `patient`, `peer`.

**Response**:
```json
{ "success": true }
```

**Errors**:
- `403` if the agent is not owned by the authenticated user.
- `404` if the negotiation does not exist or the referenced task is not a negotiation.
- `409` if the task is not in `claimed` state or is claimed by a different agent.

### GET /api/agents/:id/opportunities/pending

Fetch all undelivered eligible opportunities for an owned personal agent as a batch. Authenticates with the agent's API key (`x-api-key` header) or a session. Read-only: the response does not reserve or mutate the delivery ledger, so callers are expected to decide which candidates to surface and then commit each selection via the `confirm_opportunity_delivery` MCP tool.

Uses the same `getOpportunitiesForUser` database adapter as the feed graph. Eligibility filters: status `latent`, `pending`, or `draft`, the caller's user listed in `actors`, agent has `notify_on_opportunity = true`, `canUserSeeOpportunity` + `isActionableForViewer` JS filters (mirroring the feed graph), no committed delivery row exists. In practice `isActionableForViewer` excludes drafts (only `latent` and `pending` are actionable). Latent opportunities only surface for the introducer when `approved=false`. Results are capped at 20 by default; pass `?limit=N` (1..20) to request fewer. Results are ordered oldest-first, with rendered card fields suitable for direct interpolation into a delivery prompt.

**Query parameters**:

| Parameter | Type    | Required | Description |
|-----------|---------|----------|-------------|
| `limit`   | number  | no       | Maximum number of opportunities to return. Server clamps to `[1, 20]` and truncates fractional values. Out-of-range values (`0`, negatives, `>20`) are normalized rather than rejected. Defaults to `20` when omitted or empty. |

**Request body**: empty.

**Response**:
```json
{
  "opportunities": [
    {
      "opportunityId": "...",
      "counterpartUserId": "... | null",
      "feedCategory": "connection | connector-flow",
      "rendered": {
        "headline": "...",
        "personalizedSummary": "...",
        "suggestedAction": "...",
        "narratorRemark": "..."
      }
    }
  ],
  "totalPending": 5
}
```

- `feedCategory` — `'connection'` for direct matches, `'connector-flow'` when the viewer is the introducer.
- `totalPending` — count of all eligible opportunities after filters but before the limit is applied. Enables overflow messaging ("N more conversations waiting").
- Returns `{ "opportunities": [], "totalPending": 0 }` when nothing is pending (not `204`).
- Each poll also bumps `agents.last_seen_at`.

**Errors**:
- `400` if `limit` is present but does not parse to a finite number (e.g. `abc`, `Infinity`, `NaN`) — `{"error":"limit must be a finite number"}`.
- `403` if the agent is not owned by the authenticated user.

### GET /api/agents/:id/opportunities/accepted

Fetch accepted opportunities where the authenticated user is the counterparty (not the accepter, not an introducer) and no delivery record with `deliveredAtStatus = 'accepted'` exists yet. Used by the openclaw-plugin accepted-opportunity poller.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID.

**Query params**:

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `limit`   | number | no       | Maximum number of opportunities to return. Server clamps to `[1, 20]`. Defaults to `10`. |

**Response 200**:
```json
{
  "opportunities": [
    {
      "opportunityId": "...",
      "accepterUserId": "...",
      "accepterName": "Alice",
      "conversationUrl": "https://index.network/conversations/...",
      "telegramHandle": "alice_tg",
      "rendered": {
        "headline": "...",
        "personalizedSummary": "..."
      }
    }
  ]
}
```

- `telegramHandle` is `null` when the accepter has no `user_socials` entry with `label = 'telegram'` or when the stored value is not a valid Telegram username.
- `conversationUrl` falls back to the frontend base URL if no DM exists.
- Returns `{ "opportunities": [] }` when no undelivered accepted opportunities exist.

**Errors**:
- `400` if `limit` is present but does not parse to a finite number.
- `403` if the agent is not owned by the authenticated user.

### GET /api/agents/:id/opportunities/delivery-stats

Return committed delivery counts for an owned personal agent since a given timestamp, grouped by trigger type.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID.

**Query params**:

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `since`   | string | yes      | ISO 8601 timestamp; counts deliveries with `delivered_at >= since`. |

**Response 200**:
```json
{ "ambient": 2, "digest": 1 }
```

- `ambient` — number of committed deliveries with `trigger = "ambient"` since the given timestamp.
- `digest` — number of committed deliveries with `trigger = "digest"` since the given timestamp.

**Response 400**: `{ "error": "..." }` when `since` is missing or cannot be parsed as a valid ISO 8601 date.

**Errors**:
- `403` if the agent is not owned by the authenticated user.

**Used by**: the OpenClaw plugin's ambient discovery poller, which calls this endpoint before each cycle to feed today's committed delivery count into the agent's prompt for soft self-restraint against a ≤3/day target.

---

### POST /api/agents/:id/opportunities/pickup

Atomically reserve and return one pending opportunity for the agent to process. Returns 204 if no opportunities are pending. Also updates the agent's `lastSeenAt` heartbeat.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID. The authenticated user must own this agent.

**Response 200**:
```json
{
  "opportunityId": "uuid",
  "reservationToken": "token-string",
  "reservationExpiresAt": "ISO-8601-timestamp",
  "rendered": { ... }
}
```

**Response 204**: No pending opportunities.

**Errors**:
- `404` if the agent is not owned by the authenticated user or does not exist (returns 404 regardless to prevent existence disclosure).

---

### POST /api/agents/:id/opportunities/:opportunityId/delivered

Confirm that the agent has successfully delivered an opportunity. Must be called with the `reservationToken` issued by the preceding `pickup` call.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID. The authenticated user must own this agent.
- `opportunityId` — Opportunity ID.

**Request body**:
```json
{ "reservationToken": "token-string" }
```

**Response 200**:
```json
{ "ok": true }
```

**Errors**:
- `404` — Invalid or expired reservation token; the message has already been confirmed or the token is wrong.
- `404` if the agent is not owned by the authenticated user or does not exist.

---

### POST /api/agents/:id/test-messages

Enqueue a test message for the agent. Owner-only. Used to verify that a personal agent's delivery pipeline is working correctly.

**Auth**: `AuthGuard` (session only).

**Path params**:
- `id` — Agent ID. The authenticated user must own this agent.

**Request body**:
```json
{ "content": "Hello from test" }
```

**Response 201**: The enqueued test message record.

**Errors**:
- `404` if the agent is not owned by the authenticated user or does not exist.

---

### POST /api/agents/:id/test-messages/pickup

Atomically reserve and return one pending test message. Returns 204 if no messages are pending. Also updates the agent's `lastSeenAt` heartbeat.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID. The authenticated user must own this agent.

**Response 200**: The reserved test message with a `reservationToken`.

**Response 204**: No pending test messages.

**Errors**:
- `404` if the agent is not owned by the authenticated user or does not exist.

---

### POST /api/agents/:id/test-messages/:messageId/delivered

Confirm delivery of a test message. Must be called with the `reservationToken` issued by the preceding `test-messages/pickup` call.

**Auth**: `AuthOrApiKeyGuard` (session or API key).

**Path params**:
- `id` — Agent ID.
- `messageId` — Test message ID.

**Request body**:
```json
{ "reservationToken": "token-string" }
```

**Response 200**:
```json
{ "ok": true }
```

**Errors**:
- `404` — Invalid or expired reservation token.

---

## Conversation

**Controller prefix**: `/conversations`

### GET /api/conversations

List all conversations for the authenticated user.

**Auth**: AuthGuard

**Response**:
```json
{
  "conversations": [...]
}
```

### GET /api/conversations/negotiations

List A2A agent-to-agent negotiation conversations for the authenticated user.

**Auth**: AuthGuard

**Response**:
```json
{
  "conversations": [...]
}
```

### POST /api/conversations

Create a new conversation with participants.

**Auth**: AuthGuard

**Request body**:
```json
{
  "participants": [
    { "participantId": "string", "participantType": "user | agent" }
  ]
}
```

The authenticated user must be included in the participants array.

**Response** (`201`):
```json
{
  "conversation": { ... }
}
```

### GET /api/conversations/:id/messages

Get messages for a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID

**Query params**:
- `limit` — Max messages to return (optional)
- `before` — Cursor for pagination, return messages before this ID (optional)
- `taskId` — Filter messages by task ID (optional)

**Response**:
```json
{
  "messages": [...]
}
```

### POST /api/conversations/:id/messages

Send a message in a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID

**Request body**:
```json
{
  "parts": ["array of message parts (required, A2A-compatible)"],
  "taskId": "string (optional)",
  "metadata": { "key": "value (optional)" }
}
```

**Response** (`201`):
```json
{
  "message": { ... }
}
```

### POST /api/conversations/dm

Get or create a DM conversation with a peer user.

**Auth**: AuthGuard

**Request body**:
```json
{
  "peerUserId": "string (required)"
}
```

**Response**:
```json
{
  "conversation": { ... }
}
```

### PATCH /api/conversations/:id/metadata

Update metadata for a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID

**Request body**:
```json
{
  "metadata": { "key": "value (required)" }
}
```

**Response**:
```json
{ "success": true }
```

### DELETE /api/conversations/:id

Hide a conversation for the authenticated user (soft-hide via `hiddenAt`).

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID

**Response**:
```json
{ "success": true }
```

### GET /api/conversations/:id/tasks

List all tasks for a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID

**Response**:
```json
{
  "tasks": [...]
}
```

### GET /api/conversations/:id/tasks/:taskId

Get a single task within a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID
- `taskId` — Task ID

**Response**:
```json
{
  "task": { ... }
}
```

### GET /api/conversations/:id/tasks/:taskId/artifacts

Get artifacts for a task within a conversation.

**Auth**: AuthGuard

**Path params**:
- `id` — Conversation ID
- `taskId` — Task ID

**Response**:
```json
{
  "artifacts": [...]
}
```

### GET /api/conversations/stream

SSE endpoint for real-time conversation events. Streams new messages and conversation updates to the authenticated user.

**Auth**: AuthGuard

**Response**: SSE stream (`Content-Type: text/event-stream`)

- Initial event: `{ "type": "connected" }`
- Subsequent events: conversation-scoped data pushed in real time
- Keepalive comments sent every 15 seconds

---

## Debug

**Controller prefix**: `/debug`

All debug endpoints require both `DebugGuard` (dev/staging only) and `AuthGuard`.

### GET /api/debug/intents/:id

Returns a full diagnostic snapshot for a single intent, including the intent record, HyDE document stats, index assignments, related opportunities, and a pipeline-health diagnosis.

**Auth**: DebugGuard + AuthGuard

**Path params**:
- `id` — Intent ID

**Response**:
```json
{
  "exportedAt": "...",
  "intent": {
    "id": "...",
    "text": "...",
    "summary": "...",
    "status": "active | archived",
    "confidence": 0.85,
    "inferenceType": "...",
    "sourceType": "...",
    "hasEmbedding": true,
    "createdAt": "...",
    "updatedAt": "..."
  },
  "hydeDocuments": {
    "count": 3,
    "oldestGeneratedAt": "...",
    "newestGeneratedAt": "..."
  },
  "indexAssignments": [
    { "indexId": "...", "indexTitle": "...", "indexPrompt": "..." }
  ],
  "opportunities": {
    "total": 5,
    "byStatus": { "pending": 2, "accepted": 3 },
    "items": [
      {
        "opportunityId": "...",
        "counterpartUserId": "...",
        "confidence": 0.9,
        "status": "accepted",
        "createdAt": "...",
        "indexId": "..."
      }
    ]
  },
  "diagnosis": {
    "hasEmbedding": true,
    "hasHydeDocuments": true,
    "isInAtLeastOneIndex": true,
    "hasOpportunities": true,
    "allOpportunitiesFilteredFromHome": false,
    "filterReasons": []
  }
}
```

### GET /api/debug/home

Returns a home-level diagnostic snapshot for the authenticated user, including intent stats, index memberships, opportunity aggregates, simulated home-view filtering, and a pipeline-health diagnosis.

**Auth**: DebugGuard + AuthGuard

**Response**:
```json
{
  "exportedAt": "...",
  "userId": "...",
  "intents": {
    "total": 10,
    "byStatus": { "active": 8, "archived": 2 },
    "withEmbeddings": 8,
    "withHydeDocuments": 6,
    "inAtLeastOneIndex": 7,
    "orphaned": 1
  },
  "indexes": [
    { "indexId": "...", "title": "...", "userIntentsAssigned": 3 }
  ],
  "opportunities": {
    "total": 15,
    "byStatus": { "pending": 5, "accepted": 10 },
    "actionable": 4
  },
  "homeView": {
    "cardsReturned": 4,
    "filteredOut": {
      "notActionable": 3,
      "duplicateCounterpart": 2,
      "notVisible": 6
    }
  },
  "diagnosis": {
    "hasActiveIntents": true,
    "intentsHaveEmbeddings": true,
    "intentsHaveHydeDocuments": true,
    "intentsAreIndexed": true,
    "hasOpportunities": true,
    "opportunitiesReachHome": true,
    "bottleneck": null
  }
}
```

### POST /api/debug/intents/:id/discover

Runs the opportunity discovery pipeline for a specific intent and returns the full graph trace. **WARNING**: This persists results (creates/reactivates opportunities).

**Auth**: DebugGuard + AuthGuard

**Path params**:
- `id` — Intent ID

**Response**:
```json
{
  "exportedAt": "...",
  "preflight": { ... },
  "result": { ... }
}
```

Returns `diagnosis` string instead of `result` if there are no candidates or graph execution fails.

### GET /api/debug/chat/:id

Returns a debug-friendly view of a chat session, including messages and per-turn debug metadata (graph, iterations, tools).

**Auth**: DebugGuard + AuthGuard

**Path params**:
- `id` — Session (conversation) ID

**Response**:
```json
{
  "sessionId": "...",
  "exportedAt": "...",
  "title": "...",
  "indexId": "...",
  "messages": [
    { "role": "user | assistant", "content": "..." }
  ],
  "turns": [
    {
      "messageIndex": 1,
      "graph": "chat",
      "iterations": 3,
      "tools": [
        {
          "name": "...",
          "args": { ... },
          "resultSummary": "...",
          "success": true,
          "durationMs": 1234,
          "steps": [...],
          "graphs": [
            { "name": "...", "durationMs": 500, "agents": [...] }
          ]
        }
      ]
    }
  ],
  "sessionMetadata": { ... }
}
```

---

## Network

**Controller prefix**: `/networks`

### GET /api/networks

List indexes the authenticated user is a member of, including their personal index.

**Auth**: AuthGuard

**Response**:
```json
{
  "networks": [...]
}
```

### POST /api/networks

Create a new index.

**Auth**: AuthGuard

**Request body**:
```json
{
  "title": "string (required)",
  "prompt": "string (optional)",
  "imageUrl": "string | null (optional)",
  "joinPolicy": "anyone | invite_only (optional)",
  "allowGuestVibeCheck": "boolean (optional)"
}
```

**Response**:
```json
{
  "index": { ... }
}
```

### GET /api/networks/search-users

Search users by name/email, optionally excluding existing members of an index.

**Auth**: AuthGuard

**Query params**:
- `q` — Search query string
- `indexId` — Exclude members of this network (optional)

**Response**:
```json
{
  "users": [...]
}
```

### GET /api/networks/my-members

Get all members of every index the signed-in user is a member of (deduplicated). Used for @mentions in chat.

**Auth**: AuthGuard

**Response**:
```json
{
  "members": [...]
}
```

### GET /api/networks/discovery/public

Get public indexes the user has not joined.

**Auth**: AuthGuard

**Response**:
```json
{
  "networks": [...]
}
```

### GET /api/networks/share/:code

Get an index by its invitation share code. Used for invitation page preview.

**Auth**: None (public)

**Path params**:
- `code` — Invitation share code

**Response**:
```json
{
  "index": { ... }
}
```

### GET /api/networks/public/:id

Get a public index by ID. Only works for indexes with `joinPolicy: 'anyone'`.

**Auth**: None (public)

**Path params**:
- `id` — Network ID

**Response**:
```json
{
  "index": { ... }
}
```

### GET /api/networks/shared/:userId

Get non-personal indexes shared between the authenticated user and a target user.

**Auth**: AuthGuard

**Path params**:
- `userId` — Target user ID

**Response**:
```json
{
  "networks": [...]
}
```

### POST /api/networks/invitation/:code/accept

Accept an invitation to join an index using the invitation code.

**Auth**: AuthGuard

**Path params**:
- `code` — Invitation code

**Response**: JSON with accepted index details.

### PUT /api/networks/:id/key

Update a network's human-readable key. Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Request body**:
```json
{
  "key": "string (required)"
}
```

Key must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`, be 3–64 characters, and not collide with an existing key.

**Response**: JSON with updated network or `400`/`409` validation errors.

### GET /api/networks/:id

Get a single index by ID with owner info and member count. Members only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{
  "index": { ... }
}
```

### PUT /api/networks/:id

Update an index (title, prompt, image, join policy). Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Request body**:
```json
{
  "title": "string (optional)",
  "prompt": "string | null (optional)",
  "imageUrl": "string | null (optional)",
  "joinPolicy": "anyone | invite_only (optional)",
  "allowGuestVibeCheck": "boolean (optional)"
}
```

**Response**:
```json
{
  "index": { ... }
}
```

### DELETE /api/networks/:id

Soft-delete an index. Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{ "success": true }
```

### POST /api/networks/:id/rotate-master-key

Rotate the master key on an experiment network. Owner only. The plaintext is returned exactly once; the previous key stops working immediately. Every owner of the network also receives the new key by email.

**Auth**: `AuthOrApiKeyGuard` (session or API key)

**Path params**:
- `id` — Network ID

**Request body**: none

**Response**:
```json
{
  "masterKey": "<plaintext-64-chars>"
}
```

**Errors**:
- `403` — Caller is not an owner of an experiment network (covers both "not an experiment" and "not an owner" — the controller's pre-check returns 403 for both).

### GET /api/networks/:id/members

Get members of an index. Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{
  "members": [...],
  "metadataKeys": [],
  "pagination": { "page": 1, "limit": 10, "total": 10, "totalPages": 1 }
}
```

### POST /api/networks/:id/members

Add a member to an index. Owner/admin only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Request body**:
```json
{
  "userId": "string (required)",
  "permissions": ["string (optional — include 'admin' for admin role)"]
}
```

**Response**:
```json
{
  "member": { ... },
  "message": "Member added | Already a member"
}
```

### DELETE /api/networks/:id/members/:memberId

Remove a member from an index. Owner only. Cannot remove yourself.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID
- `memberId` — User ID to remove

**Response**:
```json
{ "success": true }
```

### PATCH /api/networks/:id/permissions

Update index permissions (join policy, guest vibe check). Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Request body**:
```json
{
  "joinPolicy": "anyone | invite_only (optional)",
  "allowGuestVibeCheck": "boolean (optional)"
}
```

**Response**:
```json
{
  "index": { ... }
}
```

### GET /api/networks/:id/member-settings

Get current user's member settings (permissions and ownership status).

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**: JSON with member settings.

### GET /api/networks/:id/my-intents

Get current user's intents in an index. Members only.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{
  "intents": [...]
}
```

### POST /api/networks/:id/join

Join a public index.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{
  "index": { ... }
}
```

**Errors**:
- `404` — Index not found
- `403` — Index not public

### POST /api/networks/:id/leave

Leave an index. Members (non-owners) can leave.

**Auth**: AuthGuard

**Path params**:
- `id` — Network ID

**Response**:
```json
{ "success": true }
```

**Errors**:
- `404` — Not found or not a member
- `400` — Cannot leave (owner)

---

### POST /api/networks/:id/signup

Headless experiment-network signup. Provisions or re-provisions a user account and returns an API key bound to a network-scoped personal agent. Never sends email.

**Auth**: `ExperimentMasterKeyGuard` — `x-api-key` header containing the network's master key (issued once at network creation, stored by the caller).

**Path params**:
- `id` — Network ID (must be an experiment network with a master key set).

**Request body** (`email` required; all other fields optional):
```json
{
  "email": "attendee@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" }
  ]
}
```

Validation caps: `name` 200 chars, `bio` 2000 chars, `location` 200 chars, `socials` ≤ 32 entries, each `label` 64 chars, each `value` 256 chars. `socials` labels are open vocabulary.

**Response 201** (new user created):
```json
{
  "user":   { "id": "uuid", "email": "attendee@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name": "index",
    "url": "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

**Response 200** (existing user): Same shape. A fresh API key is always returned; the previous key for this user+network is revoked on each call.

**Idempotency**: Same email = same user. Key is rotated on every call — store the latest returned `apiKey`. No orphan agent records: repeated calls reuse the same scoped agent and rotate its token.

**Errors**:
- `400` — Missing/invalid email; oversized field; malformed `socials` array.
- `401` — Missing `x-api-key` header.
- `403` — Master key invalid; network not experiment type; network deleted.

---

### POST /api/networks/:id/members/import/parse

Parse a CSV file and validate rows before committing an import. Owner-only, experiment networks only. Intended for large files (> 500 rows) where client-side parsing is skipped.

**Auth**: `AuthOrApiKeyGuard`; caller must own the network.

**Path params**:
- `id` — Network ID.

**Request**: Multipart form data with a `file` field containing the CSV.

**Response 200**:
```json
{
  "valid": [{ "email": "a@example.com", "name": "Alice" }],
  "invalid": [{ "row": { "email": "" }, "reason": "Missing email" }]
}
```

**Errors**:
- `400` — No file supplied or CSV is unparseable.
- `403` — Not the network owner or scope violation.

---

### POST /api/networks/:id/members/import

Import validated rows (from `/import/parse`) into the network. Owner-only, experiment networks only.

**Auth**: `AuthOrApiKeyGuard`; caller must own the network.

**Path params**:
- `id` — Network ID.

**Request body**:
```json
{ "members": [{ "email": "a@example.com", "name": "Alice" }] }
```

**Response 200**:
```json
{ "imported": 42, "skipped": 3, "ownersNotified": 1 }
```

- `imported` — Number of new accounts provisioned and added as members.
- `skipped` — Number of rows that were skipped (errors).
- `ownersNotified` — Number of network owners who received a credentials summary email. The email contains an inline CSV with every minted API key (`email,name,api_key`). Per-user invitation emails are not sent for bulk imports — the owner distributes keys out-of-band.

**Errors**:
- `400` — `members` array is missing or empty.
- `403` — Not the network owner or scope violation.

---

### POST /api/networks/:id/members/invite

Invite a single member to an experiment network by email. Owner-only, experiment networks only. Idempotent on the (user, network) pair: re-inviting a user who already has a network-scoped agent is a no-op (no key minted, no email re-sent). A user who exists but lacks a scoped agent for this network — e.g. a ghost contact created via personal-import — is provisioned and emailed the same way a brand-new user is.

**Auth**: `AuthOrApiKeyGuard`; caller must own the network.

**Path params**:
- `id` — Network ID (must be an experiment network).

**Request body**:
```json
{ "email": "attendee@example.com", "name": "Optional Name" }
```

**Response 201** (user newly created): A network-scoped personal agent and API key are provisioned, and an invitation email containing the connect command is sent.
```json
{
  "user": { "id": "user-uuid", "email": "attendee@example.com" },
  "created": true,
  "alreadyMember": false,
  "agentProvisioned": true
}
```

**Response 200** (user already exists): Status code is 200 regardless of whether a scoped agent had to be provisioned. Examples:

- Pre-existing user without a scoped agent (e.g. ghost contact) — agent + key minted, invitation email sent:
  ```json
  {
    "user": { "id": "user-uuid", "email": "attendee@example.com" },
    "created": false,
    "alreadyMember": false,
    "agentProvisioned": true
  }
  ```
- Pre-existing user already provisioned and already a member — pure no-op:
  ```json
  {
    "user": { "id": "user-uuid", "email": "attendee@example.com" },
    "created": false,
    "alreadyMember": true,
    "agentProvisioned": false
  }
  ```

The raw API key is delivered only via the invitation email and is never returned in this response. Use `POST /api/networks/:id/signup` (master-key auth) for headless flows that need the key in-band.

**Errors**:
- `400` — Missing or malformed email.
- `403` — Not the network owner, not an experiment network, or scope violation.
- `409` — Email belongs to a soft-deleted account and cannot be invited.
- `500` — Provisioning failed.

---

### POST /api/networks/:id/members/:memberId/resend-invite

Resend the invitation email to an existing network member, optionally rotating their API key. Owner-only, experiment networks only. Used when a member did not receive their initial invitation email or requests a refreshed API key.

**Auth**: `AuthOrApiKeyGuard`; caller must own the network.

**Path params**:
- `id` — Network ID (must be an experiment network).
- `memberId` — User ID of the network member to resend the invite to.

**Request body**:
```json
{}
```

**Response 200**: Invitation email resent with the current or newly minted API key.
```json
{
  "rotated": false,
  "email": "attendee@example.com"
}
```

**Response 200 with key rotation**: An existing API key for the member's network-scoped agent was revoked and a new one was minted before sending the email.
```json
{
  "rotated": true,
  "email": "attendee@example.com"
}
```

When `rotated: true`, the member's previous API key is no longer valid and the new key is delivered only via the resent invitation email. When `rotated: false`, the member's existing API key remains valid and the email contains the same key that was previously issued.

**Errors**:
- `403` — Not the network owner, not an experiment network, or scope violation.
- `404` — Member not found or not a member of this network.
- `500` — Provisioning or email delivery failed.

---

## Integration

**Controller prefix**: `/integrations`

Supported toolkits: `gmail`, `slack`, `telegram`

> **Telegram** is a bot-based orchestrator connection (not a Composio OAuth toolkit). It doesn't use `/link` or `/import`; connection is established via a deep link returned by `POST /connect/telegram`, and disconnection is via `DELETE /:id` with `id = telegram:<userId>`.

### GET /api/integrations

List connected accounts for the authenticated user.

**Auth**: AuthGuard

**Query params**:
- `indexId` — Filter to connections linked to this network (optional)

**Response**:
```json
{
  "connections": [...]
}
```

### POST /api/integrations/connect/:toolkit

Start OAuth flow to connect a toolkit.

**Auth**: AuthGuard

**Path params**:
- `toolkit` — `gmail`, `slack`, or `telegram`

**Response**:
- For `gmail`/`slack`: OAuth redirect URL from the integration adapter.
- For `telegram`: `{ "deepLink": "https://t.me/<bot_username>?start=<token>" }` where `<token>` is a short-lived one-time token (15 min TTL). Opening the link prompts Telegram to message the bot with `/start <token>`, which completes the connection.

### POST /api/integrations/:toolkit/link

Link a toolkit connection to an index.

**Auth**: AuthGuard

**Path params**:
- `toolkit` — `gmail` or `slack`

**Request body**:
```json
{
  "indexId": "string (required)"
}
```

**Response**:
```json
{ "success": true }
```

### DELETE /api/integrations/:toolkit/link

Unlink a toolkit from an index. Does not revoke the OAuth connection.

**Auth**: AuthGuard

**Path params**:
- `toolkit` — `gmail` or `slack`

**Query params**:
- `indexId` — Network to unlink from (required)

**Response**:
```json
{ "success": true }
```

### POST /api/integrations/:toolkit/import

Import contacts from a connected toolkit into an index.

**Auth**: AuthGuard

**Path params**:
- `toolkit` — `gmail` or `slack`

**Request body**:
```json
{
  "indexId": "string (optional — defaults to personal index)"
}
```

**Response**: Import result with counts.

### DELETE /api/integrations/:id

Disconnect (delete) a connected account.

**Auth**: AuthGuard

**Path params**:
- `id` — Connection ID (or `telegram:<userId>` for Telegram)

**Behavior**:
- Composio connections (`gmail`/`slack`): disconnects the OAuth account and removes all index integration links.
- Telegram (`telegram:<userId>`): clears the stored chatId and notification prefs. The deep-link token is unchanged; reconnect via `POST /connect/telegram`.

**Response**: Disconnect result.

---

## Webhooks

**Controller prefix**: `/webhooks`

### POST /api/webhooks/telegram

Inbound endpoint for Telegram Bot API updates. Called by Telegram when the bot receives a message (text or `/start <token>` deep-link callback).

**Auth**: Header `X-Telegram-Bot-Api-Secret-Token` must match `TELEGRAM_WEBHOOK_SECRET`. Otherwise responds `401`.

**Body**: Telegram `Update` object (JSON). The handler only inspects `message.chat.id` and `message.text`.

**Response**: Always `200 OK`. Inbound handling is fire-and-forget so the endpoint never blocks Telegram's delivery pipeline.

> Registered automatically at backend startup via `setWebhook` when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are configured.

---

## Intent

**Controller prefix**: `/intents`

### POST /api/intents/list

List intents with pagination and filters.

**Auth**: AuthGuard

**Request body**:
```json
{
  "page": "number (optional)",
  "limit": "number (optional)",
  "archived": "boolean (optional)",
  "sourceType": "string (optional)"
}
```

**Response**:
```json
{
  "intents": [
    {
      "id": "...",
      "payload": "...",
      "summary": "...",
      "createdAt": "...",
      "updatedAt": "...",
      "archivedAt": "... | null"
    }
  ],
  "pagination": { ... }
}
```

### POST /api/intents/confirm

Confirm a proposed intent from chat. Persists the pre-verified intent directly.

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "proposalId": "string (required)",
  "description": "string (required)",
  "indexId": "string (optional)"
}
```

**Response**:
```json
{
  "success": true,
  "proposalId": "...",
  "intentId": "..."
}
```

### POST /api/intents/reject

Reject a proposed intent from chat. Logs the rejection for analytics.

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "proposalId": "string (required)"
}
```

**Response**:
```json
{
  "success": true,
  "proposalId": "..."
}
```

### POST /api/intents/proposals/status

Batch-check proposal statuses. Returns which proposal IDs have been confirmed.

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "proposalIds": ["string"]
}
```

**Response**:
```json
{
  "statuses": { ... }
}
```

### GET /api/intents/:id

Get a single intent by ID.

**Auth**: AuthGuard

**Path params**:
- `id` — Intent ID

**Response**:
```json
{
  "intent": {
    "id": "...",
    "payload": "...",
    "summary": "...",
    "createdAt": "...",
    "updatedAt": "...",
    "archivedAt": "... | null"
  }
}
```

### PATCH /api/intents/:id/archive

Archive an intent.

**Auth**: AuthGuard

**Path params**:
- `id` — Intent ID

**Response**:
```json
{ "success": true }
```

---

## Link

**Controller prefix**: `/links`

### GET /api/links

List all links for the authenticated user.

**Auth**: AuthGuard

**Response**:
```json
{
  "links": [
    {
      "id": "...",
      "url": "...",
      "createdAt": "...",
      "lastSyncAt": "... | null"
    }
  ]
}
```

### POST /api/links

Create a new link.

**Auth**: AuthGuard

**Request body**:
```json
{
  "url": "string (required)"
}
```

**Response**:
```json
{
  "link": { ... }
}
```

### DELETE /api/links/:id

Delete a link.

**Auth**: AuthGuard

**Path params**:
- `id` — Link ID

**Response**:
```json
{ "success": true }
```

### GET /api/links/:id/content

Get link content/metadata.

**Auth**: AuthGuard

**Path params**:
- `id` — Link ID

**Response**:
```json
{
  "url": "...",
  "lastSyncAt": "... | null",
  "lastStatus": "...",
  "pending": true
}
```

---

## Opportunity

**Controller prefix**: `/opportunities`

### GET /api/opportunities

List opportunities for the authenticated user.

**Auth**: AuthGuard

**Query params**:
- `status` — Filter by status: `pending`, `stalled`, `accepted`, `rejected`, `expired` (optional)
- `networkId` — Filter by network (optional)
- `limit` — Max results (optional)
- `offset` — Pagination offset (optional)

**Response**:
```json
{
  "opportunities": [...]
}
```

### GET /api/opportunities/chat-context

Get shared accepted opportunities between the authenticated user and a peer, used as chat context.

**Auth**: AuthGuard

**Query params**:
- `peerUserId` — Peer user ID (required)

**Response**: JSON with opportunity cards for chat context.

### GET /api/opportunities/home

Home view with dynamic sections including LLM-categorized opportunities, presenter text, and Lucide icons.

**Auth**: AuthGuard

**Query params**:
- `indexId` — Scope to a specific network (optional)
- `limit` — Max results (optional)

**Response**: JSON with categorized home sections.

### POST /api/opportunities/discover

Discover opportunities via HyDE graph.

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "query": "string (required, min 1 char)",
  "limit": "number (optional, default: 5)"
}
```

**Response**: JSON with discovered opportunities.

### GET /api/opportunities/:id

Get one opportunity with presentation for the viewer.

**Auth**: AuthGuard

**Path params**:
- `id` — Opportunity ID

**Response**: JSON with opportunity details and presentation.

### GET /api/opportunities/:id/invite-message

Generate an invite message for a ghost counterpart on an opportunity.

**Auth**: AuthGuard

**Path params**:
- `id` — Opportunity ID

**Response**: JSON with generated invite message.

### PATCH /api/opportunities/:id/status

Update opportunity status.

**Auth**: AuthGuard

**Path params**:
- `id` — Opportunity ID

**Request body**:
```json
{
  "status": "latent | draft | negotiating | pending | stalled | accepted | rejected | expired"
}
```

**Response**: JSON with updated opportunity.

**Error responses**:
- `403` — Caller is not an actor on the opportunity
- `404` — Opportunity not found
- `409` — Self-accept blocked. Caller's actor already has `actedAt` set (they advanced the opportunity earlier) and is attempting to accept it. The other party must accept. See `docs/domain/opportunities.md#bilateral-acceptance`.

---

### POST /api/opportunities/:id/start-chat

Atomically accept a `pending` or `draft` opportunity and resolve the h2h conversation for the actor pair. Backs the Start Chat button on both ambient (pending) and orchestrator (draft) opportunity cards so the frontend can navigate directly to `/chat/:conversationId` in a single round-trip.

Runs the same side effects as `PATCH .../status` with `status=accepted` (sibling acceptance, contact membership upsert), plus `getOrCreateDM(userA, userB)` to resolve/create the DM conversation. Does **not** insert a seed system message — the accepted opportunity itself renders inline in the chat timeline (per IND-237).

**Auth**: AuthGuard

**Path params**:
- `id` — Opportunity ID (full UUID or short prefix; resolved server-side)

**Request body**: empty

**Response**:
```json
{
  "conversationId": "string",
  "counterpartUserId": "string",
  "opportunity": { "id": "string", "status": "accepted", "...": "..." }
}
```

**Error responses**:
- `400` — Opportunity is not in `pending` or `draft` status
- `403` — Caller is not an actor on the opportunity
- `404` — Opportunity not found
- `409` — Self-accept blocked. Caller's actor already has `actedAt` set. See `docs/domain/opportunities.md#bilateral-acceptance`.
- `500` — Status update or DM resolution failed

---

## Network Opportunity

**Controller prefix**: `/networks` (separate controller registered alongside NetworkController)

### GET /api/networks/:indexId/opportunities

List opportunities for an index. Requires membership.

**Auth**: AuthGuard

**Path params**:
- `indexId` — Network ID

**Query params**:
- `status` — Filter by status (optional)
- `limit` — Max results (optional)
- `offset` — Pagination offset (optional)

**Response**:
```json
{
  "opportunities": [...]
}
```

### POST /api/networks/:indexId/opportunities

Create a manual opportunity (curator). Requires owner or member permission.

**Auth**: AuthGuard

**Path params**:
- `indexId` — Network ID

**Request body**:
```json
{
  "parties": [
    { "userId": "string", "intentId": "string (optional)" }
  ],
  "reasoning": "string (required)",
  "category": "string (optional)",
  "confidence": "number (optional)"
}
```

`parties` must contain at least 2 entries.

**Response** (`201`): JSON with created opportunity.

---

## Profile

**Controller prefix**: `/profiles`

### POST /api/profiles/sync

Trigger profile sync/generation for the authenticated user. Runs the profile graph.

**Auth**: AuthGuard

**Response**: JSON with profile generation result.

---

## Storage

**Controller prefix**: `/storage`

### POST /api/storage/files

Upload a library file to S3.

**Auth**: AuthGuard

**Content-Type**: `multipart/form-data`

**Form field**: `file` — The file to upload

**Response**:
```json
{
  "message": "File uploaded successfully",
  "file": {
    "id": "...",
    "name": "...",
    "size": "...",
    "type": "...",
    "createdAt": "...",
    "url": "..."
  }
}
```

### GET /api/storage/files

List library files for the authenticated user.

**Auth**: AuthGuard

**Query params**:
- `page` — Page number (default: 1)
- `limit` — Items per page (default: 100, max: 100)

**Response**:
```json
{
  "files": [...],
  "pagination": { ... }
}
```

### GET /api/storage/files/:id

Download a library file (streams content from S3).

**Auth**: AuthGuard

**Path params**:
- `id` — File ID

**Response**: Binary file content with `Content-Disposition: attachment`.

### DELETE /api/storage/files/:id

Soft-delete a library file.

**Auth**: AuthGuard

**Path params**:
- `id` — File ID

**Response**:
```json
{ "success": true }
```

### POST /api/storage/avatars

Upload an avatar image to S3.

**Auth**: AuthGuard

**Content-Type**: `multipart/form-data`

**Form field**: `avatar` — The image file

**Response**:
```json
{
  "message": "Avatar uploaded successfully",
  "avatarUrl": "..."
}
```

### GET /api/storage/avatars/:userId/:filename

Serve an avatar image (public, streamed from S3).

**Auth**: None (public)

**Path params**:
- `userId` — User ID
- `filename` — Avatar filename

**Response**: Image binary with `Cache-Control: public, max-age=31536000, immutable`.

### POST /api/storage/index-images

Upload an index/network image to S3.

**Auth**: AuthGuard

**Content-Type**: `multipart/form-data`

**Form field**: `image` — The image file

**Response**:
```json
{
  "message": "Index image uploaded successfully",
  "imageUrl": "..."
}
```

### GET /api/storage/index-images/:userId/:filename

Serve an index image (public, streamed from S3).

**Auth**: None (public)

**Path params**:
- `userId` — User ID
- `filename` — Image filename

**Response**: Image binary with `Cache-Control: public, max-age=31536000, immutable`.

---

## Subscribe

**Controller prefix**: `/subscribe`

### POST /api/subscribe/

Subscribe to newsletter or waitlist via Loops.so.

**Auth**: None (public)

**Request body**:
```json
{
  "email": "string (required)",
  "type": "newsletter | waitlist (optional, default: newsletter)",
  "name": "string (optional)",
  "whatYouDo": "string (optional)",
  "whoToMeet": "string (optional)"
}
```

**Response**:
```json
{ "success": true }
```

---

## Unsubscribe

**Controller prefix**: `/unsubscribe`

### GET /api/unsubscribe/:token

Soft-delete a ghost user to opt out of emails. Returns an HTML response.

**Auth**: None (public)

**Path params**:
- `token` — Unsubscribe token from `userNotificationSettings`

**Response**: HTML page confirming unsubscribe or indicating the link is no longer valid.

---

## User

**Controller prefix**: `/users`

### GET /api/users/batch

Batch-fetch users by IDs (max 100).

**Auth**: AuthGuard

**Query params**:
- `ids` — Comma-separated user IDs

**Response**:
```json
{
  "users": [
    {
      "id": "...",
      "name": "...",
      "intro": "...",
      "avatar": "...",
      "location": "...",
      "socials": { ... },
      "isGhost": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### POST /api/users/contacts

Manually add a contact by email (creates ghost user if not registered).

**Auth**: AuthGuard

**Request body** (Zod-validated):
```json
{
  "email": "string (required, valid email)",
  "name": "string (optional)"
}
```

**Response**:
```json
{
  "result": { ... }
}
```

### DELETE /api/users/contacts/:contactId

Remove a contact from the authenticated user's personal network (soft delete of the `'contact'` membership).

**Auth**: AuthGuard

**Response**: `{ "success": true }` on success, `404` if the contact is not a member.

### POST /api/users/:userId/negotiations

Trigger a discovery negotiation between the authenticated viewer and the target user. Responds with `400` if the viewer targets themselves, `404` if the target does not exist, `409` if a negotiation between the two parties is already in flight.

**Auth**: AuthGuard

**Response** (`201`):
```json
{
  "negotiation": {
    "id": "...",
    "counterparty": { "id": "...", "name": "...", "avatar": null },
    "outcome": {
      "hasOpportunity": true,
      "role": "agent",
      "turnCount": 4,
      "reason": "accepted"
    },
    "turns": [
      { "speaker": { "id": "...", "name": "...", "avatar": null }, "action": "propose", "reasoning": "...", "suggestedRoles": null, "createdAt": "..." }
    ],
    "createdAt": "..."
  }
}
```

### GET /api/users/:userId/negotiations

List past negotiations for a user. When the viewer differs from the profile owner, only mutual negotiations are returned.

**Auth**: AuthGuard

**Path params**:
- `userId` — User ID

**Query params**:
- `limit` — Max results (default: 20, max: 50)
- `offset` — Pagination offset (default: 0)
- `result` — Filter by result: `has_opportunity`, `no_opportunity`, `in_progress` (optional)

**Response**:
```json
{
  "negotiations": [
    {
      "id": "...",
      "counterparty": { "id": "...", "name": "...", "avatar": "..." },
      "outcome": {
        "hasOpportunity": true,
        "finalScore": 0.85,
        "role": "...",
        "turnCount": 3,
        "reason": "..."
      },
      "turns": [
        {
          "speaker": { "id": "...", "name": "...", "avatar": "..." },
          "action": "...",
          "fitScore": 0.8,
          "reasoning": "...",
          "suggestedRoles": { ... },
          "createdAt": "..."
        }
      ],
      "createdAt": "..."
    }
  ]
}
```

### PUT /api/users/me/key

Update the authenticated user's human-readable key.

**Auth**: AuthGuard

**Request body**:
```json
{
  "key": "string (required)"
}
```

Key must match `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/`, be 3–64 characters, and not collide with an existing key. Reserved words (`me`, `new`, `edit`, `delete`, `settings`, `admin`) are rejected.

**Response**: JSON with updated user or `400`/`409` validation errors.

### GET /api/users/:userId/negotiations/insights

Generate an aggregated AI insight summary of the user's negotiations. Self-only: only the authenticated user can view their own insights.

**Auth**: AuthGuard

**Path params**:
- `userId` — User ID (must equal the authenticated user's ID)

**Response**:
```json
{
  "insights": {
    "summary": "...",
    "stats": {
      "totalCount": 10,
      "opportunityCount": 6,
      "noOpportunityCount": 3,
      "inProgressCount": 1,
      "avgScore": 0.72,
      "roleDistribution": { "Helper": 3, "Seeker": 2, "Peer": 1 },
      "topCounterparties": [{ "id": "...", "name": "...", "avatar": "...", "count": 2 }]
    }
  }
}
```

Returns `{ "insights": null }` when no negotiations exist.

**Errors**:
- `403` — Viewer is not the profile owner

### GET /api/users/:userId

Get a user by ID.

**Auth**: AuthGuard

**Path params**:
- `userId` — User ID

**Response**:
```json
{
  "user": {
    "id": "...",
    "name": "...",
    "intro": "...",
    "avatar": "...",
    "location": "...",
    "socials": { ... },
    "isGhost": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

---

## Tools

**Controller prefix**: `/tools`

The Tool API exposes the same handlers used by the ChatAgent as direct HTTP endpoints. This enables external clients (CLI, plugins, third-party integrations) to invoke protocol tools without going through the LLM chat loop.

### GET /api/tools

List all available tools with their names, descriptions, and input schemas.

**Auth**: `AuthGuard`

**Response**:
```json
{
  "tools": [
    {
      "name": "read_intents",
      "description": "Read user's intents with optional filters.",
      "schema": { "type": "object", "properties": { ... } }
    }
  ]
}
```

### POST /api/tools/:toolName

Invoke a tool by name with a JSON query body.

**Auth**: `AuthGuard`

**Path params**:
- `toolName` — Name of the tool to invoke (e.g. `read_intents`, `discover_opportunities`)

**Request body**:
```json
{
  "query": { ... }
}
```

The `query` object is validated against the tool's Zod schema. If omitted or unparsable, defaults to `{}`.

**Response** (success): Tool-specific JSON result with `200` status.

**Error responses**:
- `400` — Invalid request body or query validation failure
- `401` — Missing or invalid auth token
- `403` — User not found or deactivated
- `404` — Tool not found (`Tool "xyz" not found. Available tools: ...`)
- `500` — Internal error during tool execution

### Available Tools

Tools are organized by domain. Each tool has its own input schema (see `GET /api/tools` for full schemas).

| Tool | Domain | Description |
|------|--------|-------------|
| `read_user_profiles` | Profile | Read user profiles (own or by query) |
| `create_user_profile` | Profile | Generate profile from social links or bio |
| `update_user_profile` | Profile | Update profile details |
| `complete_onboarding` | Profile | Mark onboarding complete |
| `read_intents` | Intent | List user's intents with optional filters |
| `create_intent` | Intent | Create a new intent from natural language |
| `update_intent` | Intent | Update an intent (runs full graph pipeline) |
| `delete_intent` | Intent | Archive/delete an intent |
| `create_intent_index` | Intent | Link an intent to an index |
| `read_intent_indexes` | Intent | List indexes linked to an intent |
| `delete_intent_index` | Intent | Unlink an intent from an index |
| `read_networks` | Network | List user's networks |
| `read_network_memberships` | Network | List members of a network |
| `update_network` | Network | Update network settings (title, prompt) |
| `create_network` | Network | Create a new network |
| `delete_network` | Network | Delete a network |
| `create_network_membership` | Network | Add a member to a network |
| `delete_network_membership` | Network | Remove a member from a network |
| `discover_opportunities` | Opportunity | Discover opportunities (search, target, introduce) |
| `list_opportunities` | Opportunity | List user's opportunities with filters |
| `update_opportunity` | Opportunity | Accept or reject an opportunity. Accepting returns a `conversationId` (opens a DM between both parties) |
| `list_contacts` | Contact | List user's contacts |
| `add_contact` | Contact | Add a contact by email |
| `remove_contact` | Contact | Remove a contact |
| `import_contacts` | Contact | Import contacts from file/integration |
| `import_gmail_contacts` | Integration | Import contacts from Gmail via Composio |
| `scrape_url` | Utility | Scrape and extract content from a URL |
| `read_docs` | Utility | Read protocol documentation |

---

## Queue Monitoring (Dev Only)

### Bull Board UI

```
GET /dev/queues/
```

**Auth**: None (only available when `NODE_ENV !== 'production'`)

Serves the Bull Board UI for monitoring BullMQ job queues. Monitors the following queues:
- notification
- intent
- opportunity
- profile
- email

Accessible at `http://localhost:3001/dev/queues/` when the protocol server is running in development mode.
