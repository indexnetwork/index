# Index Federation Protocol v0.1 — Design

## Overview

Index Network becomes a federated protocol where self-hosted nodes communicate over HTTP/JSON REST. Users own their data on their home nodes; indexes host intents. Nodes interact through a minimal set of endpoints.

## Decisions

| Aspect | Decision |
|--------|----------|
| Node model | Any node hosts 1+ users |
| Federation | Open, permissionless |
| Wire format | HTTP/JSON REST |
| Identifiers | URL-based, dereferenceable |
| Data locality | User data on user node, intents on index node |
| Chat | Direct between users, both nodes store copy |
| Opportunity finder | Runs on user node, queries remote indexes |
| Auth | HTTP Signatures, node-level trust |

## Node Roles

A node can serve two roles (most serve both):

- **User Node**: hosts user profiles, personal index, runs opportunity finder
- **Index Node**: hosts indexes and their intents, runs semantic search within scope

## Entity Identifiers

All entities are identified by canonical URLs:

- User: `https://node-a.com/users/{id}`
- Index: `https://node-b.com/indexes/{id}`
- Intent: `https://node-b.com/indexes/{indexId}/intents/{id}`

## Node Discovery

```
GET /.well-known/index-protocol
```
```json
{
  "version": "0.1.0",
  "name": "Alice's Node",
  "baseUrl": "https://node-a.com",
  "endpoints": {
    "users": "/users",
    "indexes": "/indexes",
    "inbox": "/inbox"
  },
  "publicKey": {
    "id": "https://node-a.com#main-key",
    "pem": "-----BEGIN PUBLIC KEY-----\n..."
  }
}
```

When a node encounters a foreign URL, it resolves the base URL, fetches this endpoint, and knows how to communicate.

## Protocol Endpoints

### 1. User Profile

```
GET /users/{id}
→ { id, name, avatar, narrative, attributes, nodeUrl }
```

Profile data for display. Embeddings are NOT exposed.

### 2. Index Info

```
GET /indexes/{id}
→ { id, title, prompt, permissions, memberCount, nodeUrl }
```

### 3. Join Index

```
POST /indexes/{id}/members
Body: { actor: "https://node-a.com/users/alice-id" }
→ 201 { membership }
→ 403 (not allowed by join policy)
```

The index node fetches the actor URL to verify the user exists.

### 4. Push Intent to Index

```
POST /indexes/{id}/intents
Body: {
  actor: "https://node-a.com/users/alice-id",
  payload: "Looking for a Rust developer...",
  embedding: [0.012, -0.034, ...],
  metadata: { sourceType, ... }
}
→ 201 { intentUrl: "https://node-b.com/indexes/{id}/intents/{intentId}" }
```

The intent lives on the index node. The user node keeps a reference to the intentUrl.

### 5. Update/Delete Intent

```
PUT    /indexes/{id}/intents/{intentId}  → update
DELETE /indexes/{id}/intents/{intentId}  → remove
```

Only the original actor (verified by URL) can modify.

### 6. Query Index

```
POST /indexes/{id}/query
Body: {
  embedding: [...],
  limit: 50,
  filters: { status: "ACTIVE" }
}
→ { results: [{ intentUrl, payload, embedding, similarity, userId }] }
```

Returns raw intents + embeddings for the caller to evaluate locally.

### 7. Chat Message

```
POST /inbox
Body: {
  type: "ChatMessage",
  from: "https://node-a.com/users/alice",
  to: "https://node-b.com/users/bob",
  sessionId: "uuid",
  content: "Hey, saw your intent about Rust...",
  context: {
    indexUrl: "https://node-b.com/indexes/xyz",
    opportunityId: "..."
  },
  timestamp: "2026-02-16T10:00:00Z"
}
→ 202 Accepted
```

Sessions are implicit — first message to a new (from, to) pair creates the session on both sides.

## Authentication

**Node-to-node:** HTTP Signatures. Sending node signs requests with its private key. Receiving node verifies using the sender's public key from `/.well-known/index-protocol`.

**User authorization:** A user's actions are sent by their home node. The `actor` field identifies the user. The receiving node trusts the sending node authenticated its own users. Authorization rules (e.g., membership checks) are enforced by the receiving node.

## Opportunity Finder

Runs entirely on the user's node:

1. Knows which indexes the user belongs to (local + remote URLs)
2. Generates query embedding from user's intents/profile
3. Fans out `POST /indexes/{id}/query` to each index node
4. Collects raw intents + embeddings
5. Runs evaluation agents locally
6. Produces opportunities stored locally

No additional protocol endpoints needed.

## Codebase Structure

New directory `protocol/src/federation/`:

```
federation/
├── spec/                    # Protocol types (no implementation logic)
│   ├── types.ts             # FederatedUser, FederatedIndex, FederatedIntent, ChatMessage
│   ├── endpoints.ts         # Endpoint paths + request/response schemas (Zod)
│   └── well-known.ts        # Well-known response schema
├── server/                  # Incoming federation requests
│   ├── federation.controller.ts
│   └── signature.ts
├── client/                  # Outgoing federation calls
│   ├── federation.client.ts
│   └── resolver.ts          # URL → local-or-remote resolution
└── bridge/                  # Connects federation to existing services
    ├── index.bridge.ts
    ├── intent.bridge.ts
    ├── chat.bridge.ts
    └── user.bridge.ts
```

**Key principle:** Existing services don't know about federation. The bridge layer translates between protocol types and internal types. A remote intent push goes through the bridge and calls the same `IntentService` used by local API routes.

**Local vs remote resolution:**

```typescript
async function resolve(url: string) {
  if (isLocal(url)) return localLookup(url);
  return remoteFetch(url);
}
```

Services that need to handle remote entities get a resolver injected. The resolver transparently fetches from remote nodes when needed.
