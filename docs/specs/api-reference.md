---
title: "Protocol API Reference"
type: spec
tags: [api, controllers, endpoints, rest, protocol, authentication, sse]
created: 2026-03-26
updated: 2026-03-26
---

# Protocol API Reference

Complete reference for all HTTP endpoints exposed by the protocol server. All routes are prefixed with `/api` (global prefix). The server runs on port 3001 by default.

## Table of Contents

- [Authentication Patterns](#authentication-patterns)
- [Non-Controller Routes](#non-controller-routes)
- [Auth](#auth)
- [Chat](#chat)
- [Conversation](#conversation)
- [Debug](#debug)
- [Index](#index)
- [Integration](#integration)
- [Intent](#intent)
- [Link](#link)
- [Opportunity](#opportunity)
- [Index Opportunity](#index-opportunity)
- [Profile](#profile)
- [Storage](#storage)
- [Subscribe](#subscribe)
- [Unsubscribe](#unsubscribe)
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
  - `403` — `User not found` or `Account deactivated` (valid token but user issue)

The guard returns an `AuthenticatedUser` object with `id`, `email`, and `name` fields, which is passed to the handler as the second argument.

### DebugGuard

Debug endpoints additionally require the `DebugGuard`, which gates access based on environment:

- **Enabled when**: `NODE_ENV === 'development'` or `ENABLE_DEBUG_API === 'true'`
- **Error**: `404` — `Not found` (when disabled)

Debug endpoints apply both guards: `DebugGuard` first, then `AuthGuard`.

### Public Routes

Some routes have no guard at all:
- `GET /api/auth/providers`
- `GET /api/chat/shared/:token`
- `GET /api/indexes/share/:code`
- `GET /api/indexes/public/:id`
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

Refer to the [Better Auth documentation](https://www.better-auth.com/) for details on these endpoints.

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

## Index

**Controller prefix**: `/indexes`

### GET /api/indexes

List indexes the authenticated user is a member of, including their personal index.

**Auth**: AuthGuard

**Response**:
```json
{
  "indexes": [...]
}
```

### POST /api/indexes

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

### GET /api/indexes/search-users

Search users by name/email, optionally excluding existing members of an index.

**Auth**: AuthGuard

**Query params**:
- `q` — Search query string
- `indexId` — Exclude members of this index (optional)

**Response**:
```json
{
  "users": [...]
}
```

### GET /api/indexes/my-members

Get all members of every index the signed-in user is a member of (deduplicated). Used for @mentions in chat.

**Auth**: AuthGuard

**Response**:
```json
{
  "members": [...]
}
```

### GET /api/indexes/discovery/public

Get public indexes the user has not joined.

**Auth**: AuthGuard

**Response**:
```json
{
  "indexes": [...]
}
```

### GET /api/indexes/share/:code

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

### GET /api/indexes/public/:id

Get a public index by ID. Only works for indexes with `joinPolicy: 'anyone'`.

**Auth**: None (public)

**Path params**:
- `id` — Index ID

**Response**:
```json
{
  "index": { ... }
}
```

### GET /api/indexes/shared/:userId

Get non-personal indexes shared between the authenticated user and a target user.

**Auth**: AuthGuard

**Path params**:
- `userId` — Target user ID

**Response**:
```json
{
  "indexes": [...]
}
```

### POST /api/indexes/invitation/:code/accept

Accept an invitation to join an index using the invitation code.

**Auth**: AuthGuard

**Path params**:
- `code` — Invitation code

**Response**: JSON with accepted index details.

### GET /api/indexes/:id

Get a single index by ID with owner info and member count. Members only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**:
```json
{
  "index": { ... }
}
```

### PUT /api/indexes/:id

Update an index (title, prompt, image, join policy). Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

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

### DELETE /api/indexes/:id

Soft-delete an index. Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**:
```json
{ "success": true }
```

### GET /api/indexes/:id/members

Get members of an index. Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**:
```json
{
  "members": [...],
  "metadataKeys": [],
  "pagination": { "page": 1, "limit": 10, "total": 10, "totalPages": 1 }
}
```

### POST /api/indexes/:id/members

Add a member to an index. Owner/admin only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

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

### DELETE /api/indexes/:id/members/:memberId

Remove a member from an index. Owner only. Cannot remove yourself.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID
- `memberId` — User ID to remove

**Response**:
```json
{ "success": true }
```

### PATCH /api/indexes/:id/permissions

Update index permissions (join policy, guest vibe check). Owner only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

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

### GET /api/indexes/:id/member-settings

Get current user's member settings (permissions and ownership status).

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**: JSON with member settings.

### GET /api/indexes/:id/my-intents

Get current user's intents in an index. Members only.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**:
```json
{
  "intents": [...]
}
```

### POST /api/indexes/:id/join

Join a public index.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

**Response**:
```json
{
  "index": { ... }
}
```

**Errors**:
- `404` — Index not found
- `403` — Index not public

### POST /api/indexes/:id/leave

Leave an index. Members (non-owners) can leave.

**Auth**: AuthGuard

**Path params**:
- `id` — Index ID

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

Supported toolkits: `gmail`, `slack`

### GET /api/integrations

List connected accounts for the authenticated user.

**Auth**: AuthGuard

**Query params**:
- `indexId` — Filter to connections linked to this index (optional)

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
- `toolkit` — `gmail` or `slack`

**Response**: OAuth redirect URL from the integration adapter.

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
- `indexId` — Index to unlink from (required)

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

Disconnect (delete) a connected Composio account. Also removes all index integration links.

**Auth**: AuthGuard

**Path params**:
- `id` — Connection ID

**Response**: Disconnect result from adapter.

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

### POST /api/intents/process

Process user input through the Intent Graph.

**Auth**: AuthGuard

**Request body**:
```json
{
  "content": "string (optional)"
}
```

**Response**: JSON with intent graph execution result.

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
- `status` — Filter by status: `pending`, `viewed`, `accepted`, `rejected`, `expired` (optional)
- `indexId` — Filter by index (optional)
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
- `indexId` — Scope to a specific index (optional)
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
  "status": "latent | draft | pending | viewed | accepted | rejected | expired"
}
```

**Response**: JSON with updated opportunity.

---

## Index Opportunity

**Controller prefix**: `/indexes` (separate controller registered alongside IndexController)

### GET /api/indexes/:indexId/opportunities

List opportunities for an index. Requires membership.

**Auth**: AuthGuard

**Path params**:
- `indexId` — Index ID

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

### POST /api/indexes/:indexId/opportunities

Create a manual opportunity (curator). Requires owner or member permission.

**Auth**: AuthGuard

**Path params**:
- `indexId` — Index ID

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
