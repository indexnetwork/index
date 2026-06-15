# Design: Fix silent intent→network orphaning

## Problem (confirmed in prod)

Intents can end up registered to **zero** networks even when the user is an
eligible member of a network that should accept them. The user sees "intent
saved" but it never appears in any network, with no feedback.

Production evidence (user `Timour Kosters`, network `Edge City`):

- Owns **11** active intents; only **1** has an `intent_networks` row.
- The other **10 are in zero networks** — including intents that are clearly
  on-theme (e.g. *"Meet builders in Healdsburg during Edge Esmeralda"*).
- He is a member of **Index Early Birds**, a network with **no prompt**, which
  the assignment policy assigns to **unconditionally at score 1.0**. The orphans
  are not even there.
- Systemic: across 203 Edge City members, ~40 intents are orphaned the same way
  (Timour 1/11, Seren 1/8, Adam Byrne 3/14, Miela 7/10).

## Root causes

Assignment to networks happens **once**, inside the HyDE queue
(`backend/src/queues/intent.queue.ts` → `handleGenerateHyde`, lines ~196-272),
at intent-creation time. Three properties of that path each produce permanent,
silent orphaning:

1. **Creation-time only, no backfill.** Networks are resolved at the instant the
   intent is created (`getAssignmentNetworkIdsForUser` →
   `resolveAssignmentNetworkScope`). Joining a network later, or the relevance
   picture changing later, never re-evaluates existing intents. Intents created
   before a membership/feature existed stay orphaned forever.

2. **Scope filtering with no fallback.** When the job carries a `networkScopeId`
   (agent/UI bound to one network), `resolveAssignmentNetworkScope` narrows the
   candidate set to that single network (+ personal networks). If the intent
   scores `< 0.7` against that network's prompt, it is assigned to **nothing** —
   it does not fall back to the user's other memberships (e.g. the no-prompt
   Index Early Birds), so it disappears entirely.

3. **Swallowed failures.** The whole assignment block is wrapped in
   `try/catch → logger.warn`, and `intent.service.ts:createFromProposal` returns
   success even when `assignIntentToNetwork` throws. A lost/failed HyDE job or a
   transient error produces an orphan with no signal to the user or operator.

The 0.7 relevance threshold is **not** the root cause — orphans include intents
that would score ~0.9 against the network prompt, and intents eligible for a
no-prompt network that bypasses scoring entirely.

## Goals

- No active intent should be silently orphaned from networks it qualifies for.
- Joining a network re-evaluates the joiner's existing intents against it.
- A safety net reconciles any intent that slips through (job loss, scope drop,
  pre-feature data).
- Remediation and the structural fix **share one assignment core** so behavior
  cannot drift between them.
- Reconciliation must **not** regenerate HyDE docs or trigger opportunity
  discovery (avoid notification spam on old intents).

## Design

### 1. Extract an assignment-only core (refactor, no behavior change)

Pull the network-assignment loop out of `handleGenerateHyde` into a private
method on `IntentQueue`:

```ts
// backend/src/queues/intent.queue.ts
/**
 * Resolve the user's eligible networks (respecting optional scope), score the
 * intent against each, and upsert intent_networks rows for assigned networks.
 * Pure assignment: no HyDE regeneration, no opportunity discovery.
 * Idempotent — assignIntentToNetwork upserts on (intentId, networkId).
 */
private async assignIntentToNetworks(
  intentId: string,
  userId: string,
  networkScopeId?: string,
): Promise<{ assignedNetworkIds: string[]; evaluatedCount: number }> {
  // ...exactly the existing lines 207-271, returning the assigned ids...
}
```

`handleGenerateHyde` then calls `assignIntentToNetworks(intentId, userId,
networkScopeId)` in place of the inline block. Net behavior unchanged; this just
makes the core reusable and testable.

**Add an explicit orphan signal** at the end of the core:

```ts
if (assignedNetworkIds.length === 0) {
  this.logger.warn('[IntentAssign] Intent assigned to NO networks', {
    intentId, userId, networkScopeId, evaluatedCount,
  });
  // emit metric: intent_network_orphaned_total
}
```

This converts silent loss (cause 3) into an observable event.

### 2. New assignment-only job: `reconcile_intent_networks`

Add a job that runs **only** the assignment core — no HyDE, no opportunity
enqueue:

```ts
// payload
export interface IntentReconcileData { intentId: string; userId: string; networkScopeId?: string }

// in processJob switch
case 'reconcile_intent_networks':
  await this.handleReconcileNetworks(data as IntentReconcileData);
  break;

private async handleReconcileNetworks(d: IntentReconcileData) {
  await this.assignIntentToNetworks(d.intentId, d.userId, d.networkScopeId);
}

addReconcileJob(d: IntentReconcileData) {
  // jobId dedupes concurrent reconciles for the same intent+scope
  return this.addJob('reconcile_intent_networks', d, {
    jobId: `reconcile-${d.intentId}-${d.networkScopeId ?? 'global'}`,
  });
}
```

This is the shared primitive used by both backfill-on-join and the safety-net
sweep below.

### 3. Backfill-on-join

When a user joins / is added to a non-personal network, enqueue a
network-scoped reconcile for each of their active intents so existing intents
get a chance to land in the newly-joined network.

Hook points (producers only — `NetworkService` already imports queues):

- `network.service.ts:joinPublicNetwork`
- `network.service.ts:addMember`

```ts
async joinPublicNetwork(networkId: string, userId: string) {
  await this.adapter.joinPublicNetwork(networkId, userId);
  await this.enqueueNetworkBackfill(networkId, userId); // best-effort, catches errors
  return this.adapter.getNetworkDetail(networkId, userId);
}

private async enqueueNetworkBackfill(networkId: string, userId: string) {
  const intents = await this.adapter.getActiveIntents(userId); // id + userId
  await Promise.all(intents.map(i =>
    intentQueue.addReconcileJob({ intentId: i.id, userId, networkScopeId: networkId })
      .catch(err => logger.warn('[NetworkBackfill] enqueue failed', { intentId: i.id, networkId, err }))
  ));
}
```

Scoping to `networkId` keeps it cheap (one network evaluated per intent) and
avoids re-touching unrelated memberships.

### 4. Safety-net reconciliation sweep (catches everything else)

A maintenance cron that finds active intents with **zero** `intent_networks`
rows and enqueues a **global** reconcile for each. This is the backstop that
heals job loss, scope-drop orphans, and pre-feature data without bespoke logic
per cause.

```ts
// backend/src/queues/maintenance or a new intent-reconcile cron
const orphans = await db.getOrphanedActiveIntents({ limit: 500 }); // intents w/ no intent_networks row
for (const o of orphans) intentQueue.addReconcileJob({ intentId: o.id, userId: o.userId });
```

New adapter query:

```sql
select i.id, i.user_id
from intents i
left join intent_networks n on n.intent_id = i.id
where i.archived_at is null and n.intent_id is null
limit $1;
```

Idempotent and self-limiting: once an intent gets at least one row it drops out
of the result set. Safe to run on a schedule.

### 5. (Optional) Stop scoped creation from orphaning at the source

Independent of the safety net, decide the intended semantics of scoped creation:

- **Option A (recommended): scoped creation always assigns the scoped network.**
  If a human explicitly adds an intent inside a network's context, treat it as a
  `manual_override` (score 1.0) for that network rather than scoring it out.
  This matches the existing `createFromProposal(..., networkId)` path, which
  already force-assigns.
- **Option B: fallback to global memberships.** If scoped scoring yields zero
  assignments, re-evaluate against the user's other memberships so the intent at
  least lands in no-prompt networks.

A is simpler and matches user intent; B preserves relevance filtering. The
safety-net sweep (4) makes either non-urgent, but A removes the surprise for
human-initiated, in-network creation.

## Files touched

| File | Change |
|---|---|
| `backend/src/queues/intent.queue.ts` | Extract `assignIntentToNetworks`; add `reconcile_intent_networks` job + `addReconcileJob`; orphan warning/metric |
| `backend/src/services/network.service.ts` | Enqueue network-scoped backfill on `joinPublicNetwork` + `addMember` |
| `backend/src/adapters/database.adapter.ts` | Add `getOrphanedActiveIntents`; ensure `getActiveIntents` returns `{id,userId}` |
| `backend/src/queues/*` (cron) | Register orphan-reconcile sweep; wire `startCrons`/`close` in `main.ts` |
| `backend/src/queues/tests/intent.queue.spec.ts` | Tests: assignment core extraction, reconcile job assigns without HyDE/opportunity, orphan warning fires |

## Testing

- Unit: `assignIntentToNetworks` assigns no-prompt networks at 1.0, scores
  prompted ones, returns empty + warns when nothing matches.
- Unit: `reconcile_intent_networks` writes rows but never calls `invokeHyde` or
  the opportunity enqueue (assert mocks not called).
- Unit: `joinPublicNetwork` enqueues one reconcile per active intent scoped to
  the joined network.
- Integration: orphan sweep query returns only zero-row active intents and is
  idempotent across runs.

## Rollout

1. Ship refactor (1) + reconcile job (2) — inert until invoked.
2. Run the one-off backfill (see `intent-network-backfill.md`) to heal the ~40
   existing orphans, including Timour's.
3. Enable backfill-on-join (3) and the safety-net sweep (4).
4. Decide and ship scoped-creation semantics (5).
