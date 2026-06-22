---
title: "Expose Introducer Opportunities to Notification Pollers"
type: spec
tags: [opportunities, introducer, notification, polling, feed-category, delivery]
created: 2026-05-06
updated: 2026-05-06
linear-issue: IND-253
blocks: IND-247
---

# Expose Introducer Opportunities to Notification Pollers

## Problem

`fetchPendingCandidates` in `OpportunityDeliveryService` uses raw SQL that only queries `status IN ('pending', 'draft')`. Introducer opportunities waiting for user approval sit at `latent` status, so they never reach the OpenClaw ambient/daily pollers — they only appear on the web home feed.

IND-247 (Seren's Telegram message templates) requires a two-section layout: "Conversations waiting" (direct matches) + "Help your community" (introducer/connector-flow opportunities). For this to work, the pending endpoint must return both types with a classification field.

## Design

### Rewrite `fetchPendingCandidates` to use the database adapter

Replace the raw SQL in `fetchPendingCandidates` with the same adapter the feed graph uses: `getOpportunitiesForUser(userId, { statuses, limit })`. This aligns the notification pipeline's visibility rules with the home feed.

#### Flow

1. **Resolve agent owner + guard** — keep `resolveAgentOwner(agentId)`. Query `agents.notify_on_opportunity` once at the top; bail early if false.

2. **Fetch via adapter** — call `getOpportunitiesForUser(userId, { statuses: ['latent', 'pending', 'draft'], limit: 150 })`. The adapter's SQL visibility guard handles role-based filtering. The 150-row cap matches the feed graph's fetch ceiling.

3. **JS filter chain** (mirrors feed graph):
   - `canUserSeeOpportunity(actors, status, userId)` — read-level ACL
   - `isActionableForViewer(actors, status, userId)` — actionability gate (Rule 2 restricts latent intros to the introducer only while unapproved)
   - Draft `createdBy` exclusion — skip drafts where `detection.createdBy === userId`
   - **Delivery dedup** — batch-query `opportunity_deliveries` for all surviving candidate IDs in one query, then filter out already-delivered ones

4. **Classify** — run `classifyOpportunity(opp, userId)` on each survivor to produce `feedCategory`.

5. **Count + slice** — `totalPending` is the post-filter count before applying `effectiveLimit`. Then slice to `effectiveLimit` and render cards.

#### Delivery dedup detail

The current raw SQL uses a `NOT EXISTS` subquery against `opportunity_deliveries`. After switching to the adapter, this check moves to a batch JS filter:

- Collect all candidate opportunity IDs after the visibility/actionability filters.
- Run a single query: `SELECT opportunity_id FROM opportunity_deliveries WHERE opportunity_id IN (...) AND user_id = ? AND channel = 'openclaw' AND delivered_at IS NOT NULL` grouped by `(opportunity_id, delivered_at_status)`.
- Build a Set of `opportunityId:status` keys that have been delivered.
- Filter out candidates whose `id:status` key is in the Set.

### Response shape changes

```typescript
interface PendingCandidate {
  opportunityId: string;
  counterpartUserId: string | null;
  feedCategory: 'connection' | 'connector-flow';
  rendered: RenderedCard;
}

// GET /api/agents/:id/opportunities/pending response
{
  opportunities: PendingCandidate[];
  totalPending: number;
}
```

- `feedCategory` is derived from `classifyOpportunity()` — `'connection'` for direct matches, `'connector-flow'` when the viewer is the introducer.
- `totalPending` is the count of all eligible opportunities after filters but before the limit is applied. Enables overflow messaging ("N more conversations waiting").
- `expired` category is excluded — the pollers don't query expired statuses.

### Controller change

`getPendingOpportunities` in `agent.controller.ts` returns `{ opportunities, totalPending }` instead of `{ opportunities }`. No new routes or endpoints.

### What this does NOT include

- Prompt changes in the openclaw-plugin (ambient/daily templates) — deferred to IND-247.
- New MCP tools — introducer approval uses the existing `update_opportunity(id, "pending")` path, same as the web UI (frontend line 754 in `ChatContent.tsx`).
- Changes to the accepted-opportunity endpoint — that correctly excludes introducers and should stay as-is.

## Files to change

- `services/api/src/services/opportunity-delivery.service.ts` — rewrite `fetchPendingCandidates`, update `PendingCandidate` type
- `services/api/src/controllers/agent.controller.ts` — update response shape to include `totalPending`
- `docs/specs/api-reference.md` — update endpoint documentation
- Tests covering the new behavior

## Acceptance criteria

1. `GET /api/agents/:id/opportunities/pending` returns latent opportunities where the viewer is the introducer with `approved=false`.
2. Each item in the response includes `feedCategory: 'connection' | 'connector-flow'`.
3. Response includes `totalPending` count reflecting all eligible opportunities before limit.
4. Existing pending opportunities continue to appear as before. Draft opportunities where `detection.createdBy === userId` are excluded (same rule as the feed graph via `isActionableForViewer`).
5. Delivery dedup still prevents re-delivery of already-confirmed opportunities.
6. The `isActionableForViewer` filter ensures latent intros only surface for the introducer, not other actors.
