---
title: "User and index keys with short ID display"
type: spec
tags: [user, index, key, schema, cli, api, prefix-matching]
created: 2026-03-31
updated: 2026-03-31
---

## Behavior

### Keys for users and indexes

Users and indexes gain a `key` column -- a human-readable, URL-safe identifier (e.g. `jane-doe`, `ai-research-network`). Keys are unique per table, optional (nullable), and auto-generated on creation from the entity's name/title.

**Auto-generation rules:**
1. Take the user's `name` or index's `title`
2. Convert to kebab-case (lowercase, spaces/special chars to hyphens, collapse consecutive hyphens, trim leading/trailing hyphens)
3. If the resulting key already exists, append a numeric suffix (`-2`, `-3`, etc.)
4. If no name/title is available, leave key as null

**Key format validation (for manual updates):**
- Lowercase alphanumeric characters and hyphens only: `/^[a-z0-9][a-z0-9-]*[a-z0-9]$/` (or single char: `/^[a-z0-9]$/`)
- Minimum 3 characters
- Maximum 64 characters
- Cannot start or end with a hyphen
- Must not collide with an existing key in the same table

**Key update API:**
- `PUT /api/users/me/key` with `{ key: string }` -- updates the authenticated user's key
- `PUT /api/networks/:id/key` with `{ key: string }` — updates a network's key (owner only)

### Identifier resolution (idOrKey)

All existing endpoints that accept a UUID in path params now also accept a key (for users/indexes) or a short ID prefix (for intents, opportunities, conversations).

**Detection logic:**
- If the param matches UUID format (`/^[0-9a-f]{8}-[0-9a-f]{4}-/`), treat as full UUID
- If the param matches hex prefix format (`/^[0-9a-f]{1,36}$/`) and the entity is intent/opportunity/conversation, treat as ID prefix
- Otherwise, treat as a key (for users/indexes)

**Prefix matching (intents, opportunities, conversations):**
- `WHERE id LIKE '<prefix>%'`
- If exactly one match, return it
- If zero matches, return 404
- If multiple matches, return 409 with message "Ambiguous ID prefix, please provide more characters"

### CLI display changes

**Network list:** Show key column (instead of UUID). Personal indexes remain filtered.

**Intent list:** Show first 8 characters of UUID as short ID.

**Opportunity list:** Show first 8 characters of UUID as short ID.

**Conversation list:** Show first 8 characters of UUID as short ID.

**All subcommands accepting IDs:** Accept short ID prefix (8+ chars) or key. The CLI sends these directly to the API; resolution happens server-side.

## Constraints

- Keys are unique per table but not globally unique across tables
- Personal indexes can have keys (auto-generated from user's name + "-personal" or similar), but personal indexes remain hidden from public listings
- Key column is nullable to support existing records without keys
- Prefix matching uses SQL LIKE, not full-text search
- Prefix matching minimum length is not enforced server-side (the CLI displays 8 chars, but the API accepts any prefix length)
- Key validation rejects reserved words: `me`, `new`, `edit`, `delete`, `settings`, `admin`

## Acceptance Criteria

1. Schema: `users` table has `key` column (text, unique, nullable)
2. Schema: `indexes` table has `key` column (text, unique, nullable)
3. Migration generated and properly named
4. Auto-generation: creating a user/index with a name/title auto-generates a key
5. Auto-generation: duplicate names produce suffixed keys (e.g. `jane-doe-2`)
6. API: `PUT /api/users/me/key` updates the user's key with validation
7. API: `PUT /api/networks/:id/key` updates the network's key (owner only) with validation
8. API: invalid key format returns 400 with descriptive error
9. API: duplicate key returns 409
10. Lookup: user endpoints accept key in place of UUID
11. Lookup: index endpoints accept key in place of UUID
12. Lookup: intent/opportunity/conversation endpoints accept short ID prefix
13. Prefix: single match returns the entity
14. Prefix: no match returns 404
15. Prefix: multiple matches returns 409
16. CLI: network list shows key column
17. CLI: intent list shows 8-char short IDs
18. CLI: opportunity list shows 8-char short IDs
19. CLI: conversation list shows 8-char short IDs
20. CLI: show/archive/accept/reject subcommands accept short IDs and keys
