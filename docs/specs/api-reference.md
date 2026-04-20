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

Eligibility filters match the pre-batch pickup flow: status `pending` or `draft`, the caller's user listed in `actors`, draft exclusion when `createdBy == user`, agent has `notify_on_opportunity = true`, no committed delivery row exists, and `canUserSeeOpportunity` passes. Results are capped at 20, ordered oldest-first, with rendered card fields suitable for direct interpolation into a delivery prompt.

**Request body**: empty.

**Response**:
```json
{
  "opportunities": [
    {
      "opportunityId": "...",
      "rendered": {
        "headline": "...",
        "personalizedSummary": "...",
        "suggestedAction": "...",
        "narratorRemark": "..."
      }
    }
  ]
}
```

- Returns `{ "opportunities": [] }` when nothing is pending (not `204`).
- Each poll also bumps `agents.last_seen_at`.

**Errors**:
- `403` if the agent is not owned by the authenticated user.

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
- `toolName` — Name of the tool to invoke (e.g. `read_intents`, `create_opportunities`)

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
| `read_indexes` | Index | List user's indexes |
| `read_index_memberships` | Index | List members of an index |
| `update_index` | Index | Update index settings (title, prompt) |
| `create_index` | Index | Create a new index |
| `delete_index` | Index | Delete an index |
| `create_index_membership` | Index | Add a member to an index |
| `delete_index_membership` | Index | Remove a member from an index |
| `create_opportunities` | Opportunity | Discover opportunities (search, target, introduce) |
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
