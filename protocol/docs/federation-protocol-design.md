# Federation Protocol — Minimal Design

## Core Model

- **Identity** = domain (`user@node.example.com` or `did:web:node.example.com:user:id`)
- **Index** = domain (`https://node.example.com/indexes/{id}`)
- **Node** = self-hosted instance
- **Local/remote** = same trait — index is identified by canonical URL; resolver fetches from origin. No "remote" vs "local" tables.

---

## Decouple: Spec vs Implementation

| Layer | What | Where |
|-------|------|-------|
| **Spec** | Wire format, identifiers, semantics | `protocol/docs/spec/` (independent of code) |
| **Implementation** | DB, agents, API | Current codebase |

**Rule:** Spec is normative. Implementation follows spec; spec does not follow implementation.

---

## Identifiers (Domain-First)

```
# User (identity)
{origin}/{path}   e.g. https://a.index.network/u/xyz
did:web:...      optional DID for portability

# Index
{origin}/indexes/{id}   canonical
```

Same pattern for both: **origin** = node domain; **path** = resource. Keep internal UUIDs; expose via stable URLs.

---

## Federation Scope

1. **Index** — canonical ID; same join/membership regardless of origin. Resolver handles fetch.
2. **Query** — fan-out to index origins (local or remote), merge.
3. **Chat** — identity domain-scoped; same trait for local/federated users.

---

## Communication

- **Between nodes:** HTTP(S) + JSON. REST for reads; webhooks or pull for writes.
- **Sync model:** Pull (periodic fetch) or push (webhook) — keep it simple; pick one per resource type.
- **Auth:** Node-to-node: API key or mTLS. User identity: existing Privy/JWT, but include `origin` in claims for federation.

---

## Minimal Spec Layout

```
protocol/docs/spec/
├── identifiers.md      # User, index, intent IDs
├── index-federation.md # Subscribe, query, merge
├── wire-types.md       # JSON schemas (or reference)
└── changelog.md        # Versioning
```

One doc per concern. No code. Reference from implementation via comments or generated types.

---

## Query Across Indexes

```
GET /indexes?ids=https://a.example/indexes/foo,https://b.example/indexes/bar
  → resolver fetches each by origin (local = cache/DB, remote = HTTP)
  → same interface for both
  → merge results
```

---

## Next Steps (Minimal)

1. Index ID = canonical URL (`origin + /indexes/{id}`). `index_members` references index by that ID; resolver fetches local or remote.
2. Specify wire format for index metadata + intents (JSON schema).
3. Federated query = fan-out by index origin, merge.
