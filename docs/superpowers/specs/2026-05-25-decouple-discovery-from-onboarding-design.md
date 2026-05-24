# Decouple Discovery from Onboarding

**Date:** 2026-05-25

## Problem

`onboarding.completedAt` serves two unrelated purposes:

1. **Discovery eligibility** — determines whether a user appears in vector search results (profile-to-profile and intent matching).
2. **Onboarding state** — determines whether the interactive agent ritual (EdgeClaw bootstrap, MCP tool gate) has been completed.

The `/signup` endpoint and CSV `importMembers` path set `completedAt` solely for purpose #1 — making pre-verified users discoverable in vector search. But this satisfies purpose #2 as a side effect: EdgeClaw's `AGENTS.md` gate calls `read_user_profiles()`, sees `onboardingComplete: true`, and skips the interactive onboarding ritual. Pre-verified Edge City users who connect via Telegram never get greeted, never confirm their profile, never set a first signal, and never receive the welcome message.

## Design

Replace the `completedAt`-based discovery filter with an embedding-based one. A user is discoverable if:

- They have a non-null profile embedding (`user_profiles.embedding IS NOT NULL`).
- They are not soft-deleted (`users.deleted_at IS NULL`).

Both conditions are already present (or implicitly required) in the vector search queries. The `completedAt` check is a redundant second gate that conflates discovery with onboarding.

## Changes

### 1. Remove onboarding filter from vector search — `backend/src/adapters/embedder.adapter.ts`

Four methods contain the filter `(isGhost = true OR onboarding->>'completedAt' IS NOT NULL)`:

- `searchProfilesForHyde` (line ~237)
- `searchIntentsForHyde` (line ~287)
- `searchProfilesByProfileEmbedding` (line ~329)
- `searchIntentsByProfileEmbedding` (line ~376)

**Action:** Remove the `sql\`(isGhost = true OR onboarding->>'completedAt' IS NOT NULL)\`` condition from all four. The existing `isNotNull(userProfiles.embedding)` / `isNotNull(intents.embedding)` and `isNull(schema.users.deletedAt)` conditions already express the correct eligibility. The `isGhost` bypass was only needed because ghost users never had `completedAt` — with the onboarding gate gone, `isGhost` is no longer relevant to the query filter.

After this change, the `innerJoin(schema.users, ...)` in the profile search methods exists solely for the `deletedAt` filter. The intent search methods also join `schema.users` for the same reason.

### 2. Remove onboarding filter from opportunity enrichment — `packages/protocol/src/opportunity/opportunity.discover.ts`

Line ~327:
```typescript
if (candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt && !isDirectTarget) return null;
```

**Action:** Replace with an embedding-based check. The `profile` variable is already fetched on line ~320 (`database.getProfile(candidateUserId)`). Change to:

```typescript
if (!isDirectTarget && !profile?.embedding) return null;
```

This skips candidates who have no profile embedding (meaning enrichment hasn't run for them), unless they're an explicit direct-connection target. The `isGhost` and `completedAt` checks are no longer needed. When both `profile` and `candidateUser` are null (empty `candidateUserId`), the candidate is correctly skipped — there is nothing to present.

### 3. Remove `completedAt` writes from experiment service — `backend/src/services/experiment.service.ts`

**`signup()` method (lines 94–105):** Remove the entire SQL block that sets `onboarding.completedAt`. The comment says "Mark as onboarded so the user is discoverable in vector search filters" — with the filter change, this is no longer needed. Profile enrichment (enqueued on line 109) generates the embedding that now controls discoverability.

**`importMembers()` method (lines 204–217):** Remove the entire SQL block. Same reasoning — the bulk enrichment enqueue on line 224 handles discoverability.

### 4. Update test — `backend/tests/onboarding-filter.spec.ts`

Rewrite the test to reflect the new filter logic. The new eligibility criterion is embedding presence, not `onboarding.completedAt`. Test cases:

- User with embedding → not skipped (discoverable)
- User without embedding → skipped
- Soft-deleted user with embedding → skipped (deletedAt guard, unchanged)
- Direct-connection target without embedding → not skipped (bypass)
- Null profile (no candidateUserId) → skipped (nothing to present)

### Unchanged

These remain as-is — they serve the onboarding-state purpose, not discovery:

- `tool.helpers.ts:333` — `isOnboarding: !(user.onboarding?.completedAt)` (MCP context flag)
- `mcp.server.ts:444` — MCP tool gate for non-onboarded users
- `profile.tools.ts:238–241` — `read_user_profiles()` returning `onboardingComplete`
- `complete_onboarding` tool — sets `completedAt` and auto-joins indexes
- `AGENTS.md` gate logic — checks `onboardingComplete` from `read_user_profiles()`

## Outcome

| User type | Discovery | EdgeClaw onboarding |
|-----------|-----------|-------------------|
| `/signup` user (has embedding) | Discoverable | Gets interactive ritual |
| CSV-imported user (has embedding) | Discoverable | Gets interactive ritual |
| Normal onboarded user (has embedding + completedAt) | Discoverable | Skipped (already done) |
| Brand-new user (no embedding) | Not discoverable | Gets interactive ritual |
| Ghost user (has embedding) | Discoverable | N/A (no agent interaction) |

## Risk

**Low.** The embedding check is strictly more permissive than the old filter for users who have embeddings — it removes a gate, not adds one. Users without embeddings were already invisible in vector search (the `IS NOT NULL` check on the embedding column has always been there). The MCP tool gate and EdgeClaw's agent-side onboarding flow are completely untouched.
