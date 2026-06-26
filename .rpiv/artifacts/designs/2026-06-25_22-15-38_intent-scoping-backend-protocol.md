---
date: 2026-06-25T22:15:38+0300
author: Yanek Yuk
commit: d0e5ad8199
branch: dev
repository: index
topic: "Backend/protocol selected-intent scoping for opportunities, questions, and scoped mutations"
tags: [design, backend, protocol, intent-scoping, opportunities, questions, negotiations]
status: ready
parent: .rpiv/artifacts/research/2026-06-25_20-11-34_intent-scoping-mac.md
last_updated: 2026-06-25T22:15:38+0300
last_updated_by: Yanek Yuk
---

# Design: Backend/protocol selected-intent scoping

## Summary
Selected-intent scoping becomes a backend/protocol contract rather than a Mac-local filter. The protocol scope envelope is extended from network-only scope to `scopeType: 'network' | 'intent'`; intent scope uses `scopeId=<intentId>` and is converted into SQL-enforced selected-intent predicates for opportunity reads, question reads, protocol tools, and row-only scoped mutations. REST and Mac API calls may expose convenience `intentId` helpers at the edge, but backend/protocol logic treats selected intent as a first-class scope envelope, not as UI filtering.

## Requirements
- When a user selects an intent as scope, opportunity reads must return opportunities from that intent only.
- Selected-intent question reads must include direct intent questions and negotiation questions for opportunities from that intent.
- Selected-intent accept/start-chat actions must affect only the selected opportunity row, not same-counterpart opportunities from another signal.
- Backend/protocol boundaries must enforce scoping; UI filtering alone is not sufficient.
- Selected intent must be represented canonically as a protocol scope envelope: `scopeType: 'intent', scopeId: <intentId>`. REST/Mac may keep `intentId` as an edge alias, but service/protocol logic should normalize to the same scope model.
- Intent scope is optional and must compose with existing network authorization: existing network membership/focused-network guards still apply where present, and selected intent further narrows the allowed result set when present.
- Home feed/counterpart dedupe must run after selected-intent narrowing so another intent's row cannot hide the scoped row.
- Keep negotiation-answer lifecycle unchanged: answers enrich opportunity metadata and are consumed by later negotiation continuation.
- Mac changes are limited to API client/contract support; no HaloApp live-data wiring or generated bundle edits in this design.

## Current State Analysis
Opportunity generation already records selected-intent provenance, but read and mutation surfaces do not consume it. Questions already support exact source filters, but negotiation-mode questions are keyed by opportunity id, requiring a backend join to selected-intent opportunities.

### Key Discoveries
- `apps/mac/HaloApp/src/halo-amiga/app.jsx:60-68` drops the selected `intent.id`; this is a consumer issue, not the core backend contract.
- `services/api/src/controllers/opportunity.controller.ts:48-73` parses list filters but not `intentId`.
- `services/api/src/services/opportunity.service.ts:284-303` owns default opportunity list statuses and delegates to the adapter.
- `services/api/src/adapters/opportunity.database.adapter.ts:73-157` enforces visibility/network/status filters SQL-side but lacks intent filtering.
- `packages/protocol/src/opportunity/feed/feed.graph.ts:198-205` loads home opportunities before counterpart dedupe, so `intentId` must be passed into this load.
- `packages/protocol/src/opportunity/opportunity.graph.ts:2956-2962` persists `detection.triggeredBy` for intent-driven discovery.
- `services/api/src/adapters/opportunity.database.adapter.ts:413-432` already uses actor-level `intent` JSONB predicates for intent lifecycle cleanup.
- `services/api/src/controllers/question.controller.ts:43-91` exposes pending-question filters.
- `services/api/src/adapters/questioner.adapter.ts:158-166` pushes question mode/source filters into SQL.
- `packages/protocol/src/negotiation/negotiation.graph.ts:415-421` persists negotiation questions with `sourceType='opportunity'` and `sourceId=<opportunityId>`.
- `services/api/src/events/handlers/question.answer.negotiation.ts:56-70` stores negotiation answers in opportunity metadata without status transitions.
- `services/api/src/adapters/opportunity.database.adapter.ts:326-353` accepts sibling opportunities pair-wide, regardless of intent.

## Scope
### Building
- Extend protocol scope primitives so `ToolScopeType = 'network' | 'intent'`, add intent-scope helpers, and update tool context comments/contracts accordingly.
- Add selected-intent scope support to the protocol opportunity query contract via `scopeType: 'intent', scopeId: <intentId>` (with REST/Mac `intentId` edge aliases normalized before service/database calls).
- Add a canonical backend SQL predicate for selected-intent opportunities: `detection.triggeredBy = scopeId OR viewer actor.intent = scopeId` when `scopeType === 'intent'`.
- Thread `intentId` through REST `/opportunities`, REST `/opportunities/home`, `HomeGraph`, and protocol `list_opportunities`.
- Add `intentId` support to pending-question lookup that returns direct intent questions plus negotiation questions for scoped opportunities.
- Add optional intent-scope guards to REST status/start-chat and protocol `update_opportunity` surfaces, normalizing edge `intentId` into `{ scopeType: 'intent', scopeId: intentId }` before guard evaluation.
- Make REST scoped accept/start-chat row-only by skipping pair-wide sibling acceptance when `intentId` is supplied.
- Add targeted unit/contract tests for predicate threading, question joins, and scoped mutation side effects.
- Update Mac API client contract helpers/tests and API reference docs.

### Not Building
- No database schema changes or migrations; existing JSONB `detection` and `actors` fields are sufficient.
- No HaloApp live API wiring, React state rewrite, or generated `Resources/index.html`/`.app` bundle edits.
- No negotiation-answer status transition; answering negotiation questions remains metadata-only.
- No broad removal of sibling acceptance from unscoped web/protocol flows.
- No new standalone question endpoint; selected-intent questions extend `/questions`.

## Decisions
### Canonical selected-intent opportunity predicate
**Ambiguity:** From-intent discovery stores `detection.triggeredBy`, while actor rows may also carry `intent` metadata.

**Explored:**
- `triggeredBy` only — clean for current from-intent queue, but misses actor-linked rows that do not carry `detection.triggeredBy`.
- `triggeredBy OR viewer actor.intent` — covers current persisted provenance and viewer-owned actor-intent rows without matching unrelated counterpart-only data.
- any actor intent — broadest but less viewer-centric in introducer/multi-actor cases.

**Decision:** Use `detection.triggeredBy=<intentId> OR EXISTS actor where actor.userId=<viewerId> AND actor.intent=<intentId>`.

### Read surface coverage
**Ambiguity:** Whether to scope only raw REST list first or every backend/protocol read surface.

**Decision:** Thread `intentId` through all read surfaces that use `getOpportunitiesForUser`: REST `/opportunities`, REST `/opportunities/home`, `HomeGraph`, and protocol `list_opportunities`.

### Selected intent extends the scope envelope
**Correction:** The existing protocol scope model already centers request focus on `scopeType`/`scopeId` (`packages/protocol/src/shared/agent/tool.scope.ts:1-45`, `packages/protocol/src/shared/agent/tool.helpers.ts:65-70`). Treating selected intent as only an ad-hoc `intentId` parameter would create a parallel scope concept.

**Decision:** Extend `ToolScopeType` to `'network' | 'intent'`. A selected-intent context is represented canonically as `{ scopeType: 'intent', scopeId: <intentId> }`. Helpers derive concrete scope values:
- `focusedNetworkId(context)` continues to return a network id only for `scopeType === 'network'`.
- `focusedIntentId(context)` returns an intent id only for `scopeType === 'intent'`.

REST and Mac client helpers may still accept `intentId` as an ergonomic edge alias, but controllers/services normalize it into `{ scopeType: 'intent', scopeId: intentId }` before applying guards or database filters. Existing network authorization remains authoritative: a network-scoped context still uses network guards, and an explicit network filter can still compose with intent scope by passing both the network filter and the intent scope envelope to the backend predicate.

### Selected-intent pending questions
**Ambiguity:** Direct intent questions use `sourceId=<intentId>`, but negotiation questions use `sourceId=<opportunityId>`.

**Decision:** Extend `/questions` and the question adapter with selected-intent scope. REST may accept `intentId` as an edge alias, but controller/service code normalizes it to `{ scopeType: 'intent', scopeId: intentId }`; the adapter uses that scope to return direct intent questions plus negotiation questions whose source opportunity matches the canonical selected-intent predicate.

### Scoped mutation side effects
**Ambiguity:** Existing accept/start-chat side effects accept same-counterpart sibling opportunities pair-wide.

**Decision:** When selected-intent scope is supplied (`scopeType: 'intent', scopeId: <intentId>`, or REST `intentId` normalized to that envelope), verify the selected opportunity matches the canonical selected-intent predicate and skip sibling acceptance entirely. Unscoped behavior remains unchanged.

### Negotiation-answer lifecycle
**Ambiguity:** Whether answering a negotiation question should move the opportunity to `pending`/`draft` for the selected-intent surface.

**Decision:** Keep current metadata-only behavior. Negotiation continuation/status transitions remain owned by the negotiation graph.

## Architecture
### packages/protocol/src/shared/agent/tool.scope.ts — MODIFY
Extend the canonical tool scope envelope with intent scope and add a focused-intent helper.
```ts
export type ToolScopeType = 'network' | 'intent';

export interface ToolScopeEnvelope {
  scopeType?: ToolScopeType;
  scopeId?: string;
}

export function scopeFromNetworkId(networkId: string | null | undefined): ToolScopeEnvelope {
  const scopeId = networkId?.trim();
  return scopeId ? { scopeType: 'network', scopeId } : {};
}

export function scopeFromIntentId(intentId: string | null | undefined): ToolScopeEnvelope {
  const scopeId = intentId?.trim();
  return scopeId ? { scopeType: 'intent', scopeId } : {};
}

export function hasNetworkScope(scope: ToolScopeEnvelope): scope is { scopeType: 'network'; scopeId: string } {
  return scope.scopeType === 'network' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

export function hasIntentScope(scope: ToolScopeEnvelope): scope is { scopeType: 'intent'; scopeId: string } {
  return scope.scopeType === 'intent' && typeof scope.scopeId === 'string' && scope.scopeId.trim().length > 0;
}

export function focusedNetworkId(scope: ToolScopeEnvelope): string | undefined {
  return hasNetworkScope(scope) ? scope.scopeId.trim() : undefined;
}

export function focusedIntentId(scope: ToolScopeEnvelope): string | undefined {
  return hasIntentScope(scope) ? scope.scopeId.trim() : undefined;
}
```

### packages/protocol/src/shared/agent/tool.helpers.ts — MODIFY
Update tool context comments/contracts so `scopeType` can represent network or intent focus.
```ts
export interface ResolvedToolContext {
  userId: string;
  userName: string;
  userEmail: string;
  /** Legacy focused network alias. Prefer `scopeType`/`scopeId` in new code. */
  networkId?: string;
  /** Focused request scope type: `network` for community focus, `intent` for selected-intent focus. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. Network scope uses a network id; intent scope uses an intent id. */
  scopeId?: string;
  // existing fields unchanged
}

export interface ToolContext {
  userId: string;
  /** When set, chat is scoped to this network; converted to `{ scopeType: 'network', scopeId: networkId }` at the boundary. */
  networkId?: string;
  /** Focused request scope type: `network` or `intent`. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. Network scope uses a network id; intent scope uses an intent id. */
  scopeId?: string;
  // existing fields unchanged
}
```

### packages/protocol/src/shared/interfaces/database.interface.ts — MODIFY
Add selected-intent scope envelope support to `OpportunityQueryOptions`.
```ts
export interface OpportunityQueryOptions {
  status?: OpportunityStatus;
  /** When set, filter to opportunities whose status is in this list. Orthogonal to `status` (single) — callers pick one. */
  statuses?: OpportunityStatus[];
  networkId?: string;
  /** Optional selected-intent scope. When `scopeType === 'intent'`, `scopeId` is the selected intent id. */
  scopeType?: 'intent';
  scopeId?: string;
  role?: string;
  limit?: number;
  offset?: number;
  /** When set, include draft opportunities for this chat session. When unset, exclude all draft opportunities (e.g. home view, API). */
  conversationId?: string;
}
```

### services/api/src/adapters/opportunity.database.adapter.ts — MODIFY
Add canonical selected-intent SQL predicate to `getOpportunitiesForUser`, driven by the intent scope envelope.
```ts
  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; statuses?: string[]; networkId?: string; scopeType?: 'intent'; scopeId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
    // Role-based visibility: who can see depends on actor role and status (and whether introducer exists)
    const visibilityGuard = sql`(
      ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'introducer' }])}::jsonb
      OR ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'peer' }])}::jsonb
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'patient' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'agent' }])}::jsonb
        AND (
          ${opportunities.status} IN ('accepted', 'rejected', 'expired')
          OR (${opportunities.status} NOT IN ('latent', 'draft') AND NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
        )
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'party' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
    )`;
    const conditions = [visibilityGuard];
    // Draft visibility: when explicit statuses are requested, the caller decides;
    // otherwise exclude drafts unless a conversationId scopes them to one session.
    const hasExplicitStatuses = (options?.statuses?.length ?? 0) > 0 || !!options?.status;
    if (!hasExplicitStatuses) {
      if (options?.conversationId == null) {
        conditions.push(sql`${opportunities.status} != 'draft'`);
      } else {
        conditions.push(
          sql`(${opportunities.status} != 'draft' OR (${opportunities.context}->>'conversationId') = ${options.conversationId})`
        );
      }
    }
    if (options?.status && !options?.statuses?.length) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.networkId) {
      // Network scope gate (two clauses):
      // 1. The viewer's own actor must be anchored on the bound network. This
      //    alone (the previous fix) closed the case where the viewer wasn't on
      //    the network but a counterpart was.
      // 2. EVERY participant must also be anchored on the bound network —
      //    otherwise a cross-network opportunity (viewer in scope, counterpart
      //    only on another network) passes clause 1 and leaks that counterpart's
      //    user/profile/intent across the network boundary via the card.
      // We key clause 2 on "every participant (distinct actor user) has an
      // in-network anchor" rather than "every actor row is in-network" so that
      // opportunities with redundant actor rows on other networks (same users,
      // duplicate stamps) are not falsely hidden from a scoped reader.
      conditions.push(sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${userId}
          AND actor->>'networkId' = ${options.networkId}
      )`);
      conditions.push(sql`NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS a_out
        WHERE NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS a_in
          WHERE a_in->>'userId' = a_out->>'userId'
            AND a_in->>'networkId' = ${options.networkId}
        )
      )`);
    }
    if (options?.scopeType === 'intent' && options.scopeId) {
      // Optional selected-intent narrowing. This composes with the existing
      // visibility/network/status predicates above: it never broadens a scoped
      // read. From-intent discovery records `detection.triggeredBy`; older or
      // manually linked rows can still be selected when the viewer's own actor
      // carries the selected `intent` id.
      conditions.push(sql`(
        ${opportunities.detection}->>'triggeredBy' = ${options.scopeId}
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
          WHERE actor->>'userId' = ${userId}
            AND actor->>'intent' = ${options.scopeId}
        )
      )`);
    }
    if (options?.statuses?.length) {
      conditions.push(inArray(opportunities.status, options.statuses as Array<typeof opportunities.$inferSelect.status>));
    }
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }
```

### services/api/src/services/tests/opportunity.service.listStatusFilter.spec.ts — MODIFY
Verify default status filters preserve selected-intent scope when passed through the service.
```ts
    it("preserves other options (networkId and intent scope) alongside the default allow-list", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1", { networkId: "net-1", scopeType: 'intent', scopeId: "intent-1" });

      expect(userCall.opts?.networkId).toBe("net-1");
      expect(userCall.opts?.scopeType).toBe('intent');
      expect(userCall.opts?.scopeId).toBe("intent-1");
      expect(userCall.opts?.statuses).toEqual(EXPECTED_USER_STATUSES);
    });
```

### services/api/src/services/opportunity.service.ts — MODIFY
Thread selected-intent scope through list/home options and add scoped mutation options.
```ts
interface IntentScopeOptions {
  scopeType?: 'intent';
  scopeId?: string;
}

function matchesSelectedIntentScope(
  opportunity: Pick<Opportunity, 'detection' | 'actors'>,
  userId: string,
  scope?: IntentScopeOptions,
): boolean {
  if (scope?.scopeType !== 'intent' || !scope.scopeId) return true;
  if (opportunity.detection?.triggeredBy === scope.scopeId) return true;
  return opportunity.actors.some((actor) => actor.userId === userId && actor.intent === scope.scopeId);
}
```

```ts
async getHomeView(
  userId: string,
  options?: { networkId?: string; scopeType?: 'intent'; scopeId?: string; limit?: number; noCache?: boolean; statuses?: OpportunityStatus[] }
): Promise<{ sections: Array<{ id: string; title: string; subtitle?: string; iconName: string; items: unknown[] }>; meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } } | { error: string }> {
  logger.verbose('[OpportunityService] Getting home view', { userId, options });
  if (!this.homeGraph) {
    return { error: 'Home view not available' };
  }
  try {
    const result = await this.homeGraph.invoke({
      userId,
      networkId: options?.networkId,
      scopeType: options?.scopeType,
      scopeId: options?.scopeId,
      limit: options?.limit ?? 50,
      noCache: options?.noCache,
      statuses: options?.statuses,
    });
    if (result.error) {
      return { error: result.error };
    }
    const sections = result.sections ?? [];
    const meta: { totalOpportunities: number; totalSections: number; maintenanceTriggered: boolean } = {
      ...(result.meta ?? { totalOpportunities: 0, totalSections: 0 }),
      maintenanceTriggered: false,
    };

    // Fire-and-forget maintenance: health-scored check replaces empty-feed-only trigger.
    // Intent scope is a feed narrowing, not a maintenance target, so it does not suppress
    // the existing unscoped maintenance trigger. Network scope retains current behavior.
    if (this.maintenanceGraph && !options?.networkId) {
      meta.maintenanceTriggered = true;
      logger.info('[OpportunityService] Triggering maintenance via health scoring', { userId, source: 'home-view' });
      this.maintenanceGraph.invoke({ userId }).catch((err) =>
        logger.warn('[OpportunityService] Maintenance graph failed', { userId, error: err })
      );
    }

    return { sections, meta };
  } catch (e) {
    logger.error('[OpportunityService] getHomeView failed', { userId, error: e });
    return { error: 'Failed to load home view' };
  }
}
```

```ts
async getOpportunitiesForUser(
  userId: string,
  options?: {
    status?: 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
    statuses?: OpportunityStatus[];
    networkId?: string;
    scopeType?: 'intent';
    scopeId?: string;
    limit?: number;
    offset?: number;
  }
) {
  logger.verbose('[OpportunityService] Getting opportunities for user', { userId, options });

  const hasExplicitStatus = !!options?.status || (options?.statuses?.length ?? 0) > 0;
  const rows = await this.db.getOpportunitiesForUser(
    userId,
    hasExplicitStatus ? options : { ...options, statuses: DEFAULT_LIST_STATUSES },
  );

  const allUserIds = new Set<string>();
  for (const opp of rows) {
    for (const actor of opp.actors) {
      allUserIds.add(actor.userId);
    }
  }
  const userMap = new Map<string, string>();
  const lookups = [...allUserIds].map(async (uid) => {
    const user = await this.db.getUser(uid);
    if (user?.name) userMap.set(uid, user.name);
  });
  await Promise.all(lookups);

  return rows.map((opp) => {
    const counterpart = resolveCounterpart(opp.actors, userId);
    const enrichedActors = opp.actors.map((a) => ({
      ...a,
      name: userMap.get(a.userId) ?? undefined,
    }));
    return {
      ...opp,
      actors: enrichedActors,
      counterpartName: counterpart ? (userMap.get(counterpart.userId) ?? undefined) : undefined,
    };
  });
}
```

```ts
async updateOpportunityStatus(
  opportunityId: string,
  status: OpportunityStatus,
  userId: string,
  options?: IntentScopeOptions,
): Promise<OpportunityStatusUpdateResult | { error: string; status: number }> {
  logger.verbose('[OpportunityService] Updating opportunity status', {
    opportunityId,
    status,
    userId,
    scopeType: options?.scopeType,
    scopeId: options?.scopeId,
  });

  const opp = await this.db.getOpportunity(opportunityId);
  if (!opp) {
    return { error: 'Opportunity not found', status: 404 };
  }

  const callerActor = opp.actors.find((a) => a.userId === userId);
  if (!callerActor) {
    return { error: 'Not authorized to update this opportunity', status: 403 };
  }
  if (!matchesSelectedIntentScope(opp, userId, options)) {
    return { error: 'Opportunity not found', status: 404 };
  }

  // Self-accept guard: if the caller has already committed (actedAt is set)
  // and they are trying to accept, block them — the other party must accept.
  if (status === 'accepted' && callerActor.actedAt) {
    return { error: 'You have already acted on this opportunity. The other party must accept.', status: 409 };
  }

  const counterpart = status === 'accepted'
    ? resolveCounterpart(opp.actors, userId)
    : undefined;

  if (counterpart) {
    try {
      await this.db.getOrCreateDM(userId, counterpart.userId);
    } catch (err) {
      logger.error('[OpportunityService.updateOpportunityStatus] getOrCreateDM failed; status left untouched', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
      return { error: 'Failed to create conversation for this opportunity', status: 500 };
    }
  }

  let updated: Awaited<ReturnType<typeof this.db.updateOpportunityStatus>>;
  if (status === 'accepted') {
    updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
  } else if (status === 'pending') {
    updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'pending');
  } else {
    updated = await this.db.updateOpportunityStatus(opportunityId, status);
  }
  if (!updated) {
    return { error: 'Opportunity not found', status: 404 };
  }

  if (!counterpart) {
    return { opportunity: updated };
  }

  const counterpartUserId = counterpart.userId;

  if (options?.scopeType !== 'intent') {
    await this.db.acceptSiblingOpportunities(userId, counterpartUserId, opportunityId).catch((err) => {
      logger.error('[OpportunityService.updateOpportunityStatus] acceptSiblingOpportunities failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId,
        error: err,
      });
    });
  }

  await this.db.upsertContactMembership(userId, counterpartUserId, { restore: true }).catch((err) => {
    logger.error('[OpportunityService.updateOpportunityStatus] upsertContactMembership failed (non-blocking)', {
      opportunityId,
      userId,
      counterpartUserId,
      error: err,
    });
  });
  await this.db.upsertContactMembership(counterpartUserId, userId, { restore: false }).catch((err) => {
    logger.error('[OpportunityService.updateOpportunityStatus] upsertContactMembership (counterpart) failed (non-blocking)', {
      opportunityId,
      userId,
      counterpartUserId,
      error: err,
    });
  });

  return {
    opportunity: updated,
    counterpartUserId,
  };
}
```

```ts
async startChat(
  opportunityId: string,
  userId: string,
  options?: IntentScopeOptions,
): Promise<
  | { conversationId: string; counterpartUserId: string; opportunity: Opportunity }
  | { error: string; status: number }
> {
  const opp = await this.db.getOpportunity(opportunityId);
  if (!opp) {
    return { error: 'Opportunity not found', status: 404 };
  }
  if (opp.status === 'accepted') {
    const isActor = opp.actors.some((a) => a.userId === userId);
    if (!isActor) {
      return { error: 'Not authorized to start chat for this opportunity', status: 403 };
    }
    if (!matchesSelectedIntentScope(opp, userId, options)) {
      return { error: 'Opportunity not found', status: 404 };
    }
    const counterpart = resolveCounterpart(opp.actors, userId);
    if (!counterpart) {
      return { error: 'Opportunity has no counterpart to chat with', status: 400 };
    }
    let conversation: { id: string };
    try {
      conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
    } catch (err) {
      logger.error('[OpportunityService.startChat] getOrCreateDM failed for accepted opp', {
        opportunityId, userId, counterpartUserId: counterpart.userId, error: err,
      });
      return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
    }
    await this.db.unhideConversation(userId, conversation.id).catch((err) => {
      logger.error('[OpportunityService.startChat] unhideConversation failed (non-blocking)', {
        conversationId: conversation.id, userId, error: err,
      });
    });
    return { conversationId: conversation.id, counterpartUserId: counterpart.userId, opportunity: opp };
  }
  if (opp.status !== 'pending' && opp.status !== 'draft' && opp.status !== 'latent') {
    return {
      error: `Cannot start chat on opportunity in status '${opp.status}'; must be pending, draft, or latent.`,
      status: 400,
    };
  }
  const callerActor = opp.actors.find((a) => a.userId === userId);
  if (!callerActor) {
    return { error: 'Not authorized to start chat for this opportunity', status: 403 };
  }
  if (!matchesSelectedIntentScope(opp, userId, options)) {
    return { error: 'Opportunity not found', status: 404 };
  }

  if (callerActor.actedAt) {
    return { error: 'You have already acted on this opportunity. The other party must accept.', status: 409 };
  }

  const counterpart = resolveCounterpart(opp.actors, userId);
  if (!counterpart) {
    return { error: 'Opportunity has no counterpart to chat with', status: 400 };
  }

  let conversation: { id: string };
  try {
    conversation = await this.db.getOrCreateDM(userId, counterpart.userId);
  } catch (err) {
    logger.error('[OpportunityService.startChat] getOrCreateDM failed; opp left untouched', {
      opportunityId,
      userId,
      counterpartUserId: counterpart.userId,
      error: err,
    });
    return { error: 'Failed to resolve conversation for this opportunity', status: 500 };
  }

  await this.db.unhideConversation(userId, conversation.id).catch((err) => {
    logger.error('[OpportunityService.startChat] unhideConversation failed (non-blocking)', {
      conversationId: conversation.id,
      userId,
      error: err,
    });
  });

  const updated = await this.db.stampOpportunityActorAction(opportunityId, userId, 'accepted', userId);
  if (!updated) {
    return { error: 'Failed to accept opportunity', status: 500 };
  }

  if (options?.scopeType !== 'intent') {
    await this.db.acceptSiblingOpportunities(userId, counterpart.userId, opportunityId).catch((err) => {
      logger.error('[OpportunityService.startChat] acceptSiblingOpportunities failed (non-blocking)', {
        opportunityId,
        userId,
        counterpartUserId: counterpart.userId,
        error: err,
      });
    });
  }
  await this.db.upsertContactMembership(userId, counterpart.userId, { restore: true }).catch((err) => {
    logger.error('[OpportunityService.startChat] upsertContactMembership failed (non-blocking)', {
      opportunityId,
      userId,
      counterpartUserId: counterpart.userId,
      error: err,
    });
  });
  await this.db.upsertContactMembership(counterpart.userId, userId, { restore: false }).catch((err) => {
    logger.error('[OpportunityService.startChat] upsertContactMembership (counterpart) failed (non-blocking)', {
      opportunityId,
      userId,
      counterpartUserId: counterpart.userId,
      error: err,
    });
  });

  return {
    conversationId: conversation.id,
    counterpartUserId: counterpart.userId,
    opportunity: updated,
  };
}
```

### services/api/src/controllers/opportunity.controller.ts — MODIFY
Normalize selected-intent REST aliases into the canonical `{ scopeType: 'intent', scopeId }` envelope on list/home/status/start-chat.
```ts
const listStatusSchema = z.enum(['pending', 'stalled', 'accepted', 'rejected', 'expired']);
const uuidQuerySchema = z.string().uuid();
const scopeTypeQuerySchema = z.enum(['intent']);

function parseIntentScopeFromUrl(url: URL): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = url.searchParams.get('scopeType') ?? undefined;
  const rawScopeId = url.searchParams.get('scopeId') ?? undefined;
  const rawIntentId = url.searchParams.get('intentId') ?? undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}

function parseIntentScopeFromBody(body: { scopeType?: unknown; scopeId?: unknown; intentId?: unknown }): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = typeof body.scopeType === 'string' ? body.scopeType : undefined;
  const rawScopeId = typeof body.scopeId === 'string' ? body.scopeId : undefined;
  const rawIntentId = typeof body.intentId === 'string' ? body.intentId : undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}
```

```ts
@Get('')
@UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const rawStatus = url.searchParams.get('status');
  const networkId = url.searchParams.get('networkId') ?? undefined;
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');
  if (rawStatus) {
    const parsed = listStatusSchema.safeParse(rawStatus);
    if (!parsed.success) return Response.json({ error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` }, { status: 400 });
  }
  const scope = parseIntentScopeFromUrl(url);
  if (scope instanceof Response) return scope;
  const options = {
    status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
    networkId,
    ...scope,
    limit: limit ? parseInt(limit, 10) : undefined,
    offset: offset ? parseInt(offset, 10) : undefined,
  };
  const list = await opportunityService.getOpportunitiesForUser(user.id, options);
  logger.verbose('Opportunities listed', { userId: user.id, count: list.length });
  return Response.json({ opportunities: list });
}
```

```ts
@Get('/home')
@UseGuards(RateLimit('read'), AuthGuard)
async getHome(req: Request, user: AuthenticatedUser) {
  const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
  const networkId = url.searchParams.get('networkId') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const noCacheParam = url.searchParams.get('noCache');
  const noCache = noCacheParam === '1' || noCacheParam === 'true';
  const scope = parseIntentScopeFromUrl(url);
  if (scope instanceof Response) return scope;
  const result = await opportunityService.getHomeView(user.id, {
    networkId,
    ...scope,
    limit: limitParam ? parseInt(limitParam, 10) : undefined,
    noCache,
  });
  if ('error' in result) return Response.json({ error: result.error }, { status: 500 });
  return Response.json(result);
}
```

```ts
@Patch('/:id/status')
@UseGuards(RateLimit('write'), AuthGuard)
async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const id = params?.id;
  if (!id) return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
  const resolved = await opportunityService.resolveId(id, user.id);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  let body: { status?: string; scopeType?: string; scopeId?: string; intentId?: string };
  try { body = (await req.json()) as { status?: string; scopeType?: string; scopeId?: string; intentId?: string }; }
  catch { return Response.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const status = body.status as 'latent' | 'draft' | 'pending' | 'negotiating' | 'stalled' | 'accepted' | 'rejected' | 'expired' | undefined;
  const allowed = ['latent', 'draft', 'pending', 'negotiating', 'stalled', 'accepted', 'rejected', 'expired'];
  if (!status || !allowed.includes(status)) return Response.json({ error: 'Invalid status; use one of: ' + allowed.join(', ') }, { status: 400 });
  const scope = parseIntentScopeFromBody(body);
  if (scope instanceof Response) return scope;
  const result = await opportunityService.updateOpportunityStatus(resolved.id, status, user.id, scope);
  if (result && 'error' in result) return Response.json({ error: result.error }, { status: result.status as number });
  return Response.json(result);
}
```

```ts
@Post('/:id/start-chat')
@UseGuards(RateLimit('write'), AuthGuard)
async startChat(req: Request, user: AuthenticatedUser, params?: RouteParams) {
  const id = params?.id;
  if (!id) return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
  const resolved = await opportunityService.resolveId(id, user.id);
  if ('error' in resolved) return Response.json({ error: resolved.error }, { status: resolved.status });
  let body: { scopeType?: string; scopeId?: string; intentId?: string } = {};
  try {
    const rawBody = await req.text();
    body = rawBody.trim() ? (JSON.parse(rawBody) as { scopeType?: string; scopeId?: string; intentId?: string }) : {};
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const scope = parseIntentScopeFromBody(body);
  if (scope instanceof Response) return scope;
  const result = await opportunityService.startChat(resolved.id, user.id, scope);
  if ('error' in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result);
}
```

### packages/protocol/src/opportunity/feed/feed.state.ts — MODIFY
Add the selected-intent scope envelope to HomeGraph state so LangGraph carries it into the load node.
```ts
networkId: Annotation<string | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),
scopeType: Annotation<'intent' | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),
scopeId: Annotation<string | undefined>({
  reducer: (curr, next) => next ?? curr,
  default: () => undefined,
}),
limit: Annotation<number>({
```

### packages/protocol/src/opportunity/feed/feed.graph.ts — MODIFY
Add selected-intent scope to `HomeGraphInvokeInput` and pass it to `getOpportunitiesForUser` before home dedupe.
```ts
export type HomeGraphInvokeInput = {
  userId: string;
  networkId?: string;
  scopeType?: 'intent';
  scopeId?: string;
  limit?: number;
  noCache?: boolean;
  statuses?: OpportunityStatus[];
};
```

```ts
const options: { limit?: number; networkId?: string; scopeType?: 'intent'; scopeId?: string; statuses?: OpportunityStatus[] } = {
  limit: fetchLimit,
  statuses,
};
if (state.networkId) options.networkId = state.networkId;
if (state.scopeType === 'intent' && state.scopeId) {
  options.scopeType = 'intent';
  options.scopeId = state.scopeId;
}
const raw = await this.database.getOpportunitiesForUser(state.userId, options);
```

### packages/protocol/src/opportunity/tests/feed.graph.status-filter.spec.ts — MODIFY
Verify HomeGraph forwards explicit intent scope with status filters.
```ts
function createMockDb(captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: (_userId: string, opts?: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }) => {
      captured.statuses = opts?.statuses;
      captured.scopeType = opts?.scopeType;
      captured.scopeId = opts?.scopeId;
      return Promise.resolve([] as Opportunity[]);
    },
```

```ts
test('explicit intent scope is forwarded with the load query before home dedupe', async () => {
  const captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string } = {};
  const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
  await graph.invoke({ userId: 'u1', scopeType: 'intent', scopeId: '00000000-0000-4000-8000-00000000a111' });
  expect(captured.statuses).toEqual(DEFAULT_HOME_STATUSES);
  expect(captured.scopeType).toBe('intent');
  expect(captured.scopeId).toBe('00000000-0000-4000-8000-00000000a111');
});
```

### packages/protocol/src/opportunity/opportunity.tools.ts — MODIFY
Add selected-intent scope envelope support to `list_opportunities` and `update_opportunity`.
```ts
import { deriveDiscoveryNetworkIds, focusedIntentId, focusedNetworkId, focusedNetworkLabel } from "../shared/agent/tool.scope.js";
```

```ts
function matchesSelectedIntentScope(
  opportunity: Opportunity,
  viewerId: string,
  scope?: { scopeType?: 'intent'; scopeId?: string },
): boolean {
  if (scope?.scopeType !== 'intent' || !scope.scopeId) return true;
  if (opportunity.detection?.triggeredBy === scope.scopeId) return true;
  return opportunity.actors.some((actor) => actor.userId === viewerId && actor.intent === scope.scopeId);
}
```

```ts
querySchema: z.object({
  networkId: z
    .string()
    .optional()
    .describe("Network UUID to filter opportunities to a specific community. Get from read_networks. Defaults to the scoped network in network-scoped chats. Omit to see opportunities across all networks."),
  scopeType: z
    .enum(['intent'])
    .optional()
    .describe("Optional selected scope type. Use 'intent' to narrow listed opportunities to a selected intent."),
  scopeId: z
    .string()
    .optional()
    .describe("Selected intent UUID when scopeType is 'intent'. Ignored only when absent."),
  includeDigestMarkers: z
    .boolean()
    .optional()
    .describe("Internal scheduled-digest mode only. When true, includes hidden delivery markers so the digest send pass can confirm only edited-in opportunities."),
}),
```

```ts
const contextIntentId = focusedIntentId(context);
const rawScopeId = query.scopeId?.trim() || undefined;
if (query.scopeType === 'intent' && !rawScopeId) {
  return error("scopeId required when scopeType is intent.");
}
if (!query.scopeType && rawScopeId) {
  return error("scopeType=intent required when scopeId is provided.");
}
if (rawScopeId && !UUID_REGEX.test(rawScopeId)) {
  return error("Invalid scope ID format.");
}
if (contextIntentId && rawScopeId && contextIntentId !== rawScopeId) {
  return error("This chat is scoped to a different intent.");
}
const effectiveIntentScope = contextIntentId
  ? { scopeType: 'intent' as const, scopeId: contextIntentId }
  : query.scopeType === 'intent' && rawScopeId
    ? { scopeType: 'intent' as const, scopeId: rawScopeId }
    : {};

const fetched = await database.getOpportunitiesForUser(
  context.userId,
  {
    networkId: effectiveIndexId,
    ...effectiveIntentScope,
    statuses,
    limit: CHAT_FETCH_LIMIT,
  },
);
```

```ts
const updateOpportunity = defineTool({
  name: "update_opportunity",
  description:
    "Updates an opportunity's status, advancing it through the connection lifecycle.\n\n" +
    "**Status transitions:**\n" +
    "- `pending`: Sends a draft opportunity to the other party. They'll be notified and can accept or reject. " +
    "This is the primary action after discover_opportunities returns a draft.\n" +
    "- `accepted`: Accept a received opportunity — opens a direct conversation between both parties. Returns a conversationId to surface to the user.\n" +
    "- `rejected`: Decline a received opportunity.\n" +
    "- `expired`: Mark as expired (typically done by the system after timeout).\n\n" +
    "**When to use:** After discover_opportunities or list_opportunities returns opportunity cards. " +
    "The user clicks 'Send' (pending), 'Accept', or 'Reject' on the card, and the agent calls this tool.\n\n" +
    "**Returns:** Confirmation with the new status and notification details (who was notified).",
  querySchema: z.object({
    opportunityId: z
      .string()
      .describe("The UUID of the opportunity to update. Get from discover_opportunities or list_opportunities results."),
    status: z
      .enum(["pending", "accepted", "rejected", "expired"])
      .describe(
        "New status: 'pending' = send the draft to the other party, 'accepted' = accept the connection, " +
        "'rejected' = decline, 'expired' = mark as timed out.",
      ),
    scopeType: z
      .enum(['intent'])
      .optional()
      .describe("Optional selected scope type. Use 'intent' to require this opportunity to belong to a selected intent."),
    scopeId: z
      .string()
      .optional()
      .describe("Selected intent UUID when scopeType is 'intent'. Must match the chat's focused intent when one exists."),
  }),
  handler: async ({ context, query }) => {
    const opportunityId = query.opportunityId?.trim();
    if (!opportunityId || !UUID_REGEX.test(opportunityId)) {
      return error("Valid opportunityId required.");
    }

    const contextIntentId = focusedIntentId(context);
    const rawScopeId = query.scopeId?.trim() || undefined;
    if (query.scopeType === 'intent' && !rawScopeId) {
      return error("scopeId required when scopeType is intent.");
    }
    if (!query.scopeType && rawScopeId) {
      return error("scopeType=intent required when scopeId is provided.");
    }
    if (rawScopeId && !UUID_REGEX.test(rawScopeId)) {
      return error("Invalid scope ID format.");
    }
    if (contextIntentId && rawScopeId && contextIntentId !== rawScopeId) {
      return error("This chat is scoped to a different intent.");
    }
    const effectiveIntentScope = contextIntentId
      ? { scopeType: 'intent' as const, scopeId: contextIntentId }
      : query.scopeType === 'intent' && rawScopeId
        ? { scopeType: 'intent' as const, scopeId: rawScopeId }
        : {};

    const opportunity = await systemDb.getOpportunity(opportunityId);
    if (!opportunity) {
      return error("Opportunity not found.");
    }

    const isActor = opportunity.actors?.some((a) => a.userId === context.userId);
    if (!isActor) {
      return error("Opportunity not found.");
    }

    const scopedNetworkId = focusedNetworkId(context);
    if (scopedNetworkId) {
      const callerOnBoundNetwork = opportunity.actors?.some(
        (a) => a.userId === context.userId && a.networkId === scopedNetworkId,
      );
      if (!callerOnBoundNetwork) {
        return error("Opportunity not found.");
      }
    }

    if (!matchesSelectedIntentScope(opportunity, context.userId, effectiveIntentScope)) {
      return error("Opportunity not found.");
    }

    if (UPDATE_OPPORTUNITY_BLOCKED_STATUSES.has(opportunity.status)) {
      return error(`This opportunity is already ${opportunity.status} and cannot be updated.`);
    }

    const isSend = query.status === "pending";
    const _updateGraphStart = Date.now();
    const _updateTraceEmitter = requestContext.getStore()?.traceEmitter;
    _updateTraceEmitter?.({ type: "graph_start", name: "opportunity" });
    const result = await invokeWithAbortSignal(graphs.opportunity, {
      userId: context.userId,
      operationMode: isSend ? ("send" as const) : ("update" as const),
      opportunityId: query.opportunityId,
      ...(isSend ? {} : { newStatus: query.status }),
    });
    const _updateGraphMs = Date.now() - _updateGraphStart;
    _updateTraceEmitter?.({ type: "graph_end", name: "opportunity", durationMs: _updateGraphMs });

    if (result.mutationResult) {
      if (result.mutationResult.success) {
        return success({
          opportunityId: result.mutationResult.opportunityId,
          status: query.status,
          message: result.mutationResult.message,
          ...(result.mutationResult.notified && { notified: result.mutationResult.notified }),
          ...(result.mutationResult.conversationId && {
            conversationId: result.mutationResult.conversationId,
          }),
          _graphTimings: [{ name: 'opportunity', durationMs: _updateGraphMs, agents: result.agentTimings ?? [] }],
        });
      }
      return error(result.mutationResult.error || "Failed to update opportunity.");
    }
    return error("Failed to update opportunity.");
  },
});
```

### packages/protocol/src/shared/interfaces/questioner.interface.ts — MODIFY
Add selected-intent scope envelope support to protocol-level pending-question filters.
```ts
export interface QuestionFilters {
  mode?: QuestionMode;
  sourceType?: string;
  sourceId?: string;
  /** Optional selected-intent scope. When `scopeType === 'intent'`, `scopeId` is the selected intent id. */
  scopeType?: 'intent';
  scopeId?: string;
}
```

### services/api/src/adapters/questioner.adapter.ts — MODIFY
Add selected-intent question filter joining direct intent questions and negotiation questions sourced from matching opportunities.
```ts
import { questions, opportunities } from '../schemas/database.schema';

export interface AdapterQuestionFilters {
  mode?: 'discovery' | 'intent' | 'enrichment' | 'negotiation';
  sourceType?: string;
  sourceId?: string;
  /** Optional selected-intent scope. When `scopeType === 'intent'`, `scopeId` is the selected intent id. */
  scopeType?: 'intent';
  scopeId?: string;
  networkId?: string;
  conversationId?: string;
  noConversation?: boolean;
  modes?: Array<'discovery' | 'intent' | 'enrichment' | 'negotiation'>;
  limit?: number;
}

if (filters?.scopeType === 'intent' && filters.scopeId) {
  conditions.push(sql`(
    (
      ${questions.detection}->>'mode' = 'intent'
      AND ${questions.detection}->>'sourceType' = 'intent'
      AND ${questions.detection}->>'sourceId' = ${filters.scopeId}
    )
    OR (
      ${questions.detection}->>'mode' = 'negotiation'
      AND ${questions.detection}->>'sourceType' = 'opportunity'
      AND EXISTS (
        SELECT 1
        FROM ${opportunities} scoped_opp
        WHERE scoped_opp.id::text = ${questions.detection}->>'sourceId'
          AND (
            scoped_opp.detection->>'triggeredBy' = ${filters.scopeId}
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(scoped_opp.actors) AS actor
              WHERE actor->>'userId' = ${userId}
                AND actor->>'intent' = ${filters.scopeId}
            )
          )
      )
    )
  )`);
}
```

### services/api/src/services/question.service.ts — MODIFY
Keep service as pass-through; TSDoc mentions selected-intent scope.
```ts
/**
 * Find pending questions for a given user, optionally filtered by detection mode,
 * source type, source id, or selected-intent scope. Intent scope returns direct
 * intent questions plus negotiation questions whose source opportunity belongs
 * to that intent for the same viewer.
 */
async findPending(
  userId: string,
  filters?: AdapterQuestionFilters,
): Promise<AdapterPersistedQuestion[]> {
  logger.verbose('Finding pending questions', { userId, filters });
  return this.adapter.findPending(userId, filters);
}
```

### services/api/src/controllers/question.controller.ts — MODIFY
Normalize `scopeType/scopeId` and `intentId` edge alias into question filters.
```ts
const modeQuerySchema = z.enum(['discovery', 'intent', 'enrichment', 'negotiation']);
const uuidQuerySchema = z.string().uuid();
const scopeTypeQuerySchema = z.enum(['intent']);

function parseIntentScopeFromUrl(url: URL): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = url.searchParams.get('scopeType') ?? undefined;
  const rawScopeId = url.searchParams.get('scopeId') ?? undefined;
  const rawIntentId = url.searchParams.get('intentId') ?? undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}
```

```ts
const sourceId = url.searchParams.get('sourceId');
const conversationId = url.searchParams.get('conversationId');
const scope = parseIntentScopeFromUrl(url);
if (scope instanceof Response) return scope;

if (sourceType) filters.sourceType = sourceType;
if (sourceId) filters.sourceId = sourceId;
if (scope.scopeType === 'intent') {
  filters.scopeType = 'intent';
  filters.scopeId = scope.scopeId;
}
if (conversationId) filters.conversationId = conversationId;
```

### services/api/tests/questioner.adapter.spec.ts — MODIFY
Add adapter coverage for direct intent questions plus negotiation questions joined through scoped opportunities.
```ts
import { questions, opportunities } from '../src/schemas/database.schema';

const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';
const OTHER_INTENT_ID = '00000000-0000-4000-8000-00000000a222';
const SELECTED_OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000b111';
const OTHER_OPPORTUNITY_ID = '00000000-0000-4000-8000-00000000b222';

it('findPending filters by selected intent scope across direct intent and negotiation questions', async () => {
  await db.delete(questions).where(sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: 'test-user-2' }])}::jsonb`);
  await db.delete(opportunities).where(sql`${opportunities.id} IN (${SELECTED_OPPORTUNITY_ID}, ${OTHER_OPPORTUNITY_ID})`);

  await db.insert(opportunities).values([
    {
      id: SELECTED_OPPORTUNITY_ID,
      detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
      actors: [{ userId: 'test-user-2', role: 'peer', intent: SELECTED_INTENT_ID }],
      interpretation: { summary: 'Selected opportunity', reasoning: 'Selected intent match', confidence: 0.9, category: 'connection' },
      context: {},
      confidence: '0.9',
      status: 'pending',
    },
    {
      id: OTHER_OPPORTUNITY_ID,
      detection: { source: 'opportunity_graph', triggeredBy: OTHER_INTENT_ID, timestamp: new Date().toISOString() },
      actors: [{ userId: 'test-user-2', role: 'peer', intent: OTHER_INTENT_ID }],
      interpretation: { summary: 'Other opportunity', reasoning: 'Other intent match', confidence: 0.8, category: 'connection' },
      context: {},
      confidence: '0.8',
      status: 'pending',
    },
  ]).onConflictDoNothing();

  const insertedIds = await adapter.persist([
    makePersistable({
      detection: { mode: 'intent', sourceType: 'intent', sourceId: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
      actors: [{ userId: 'test-user-2', role: 'subject' as const }],
    }),
    makePersistable({
      detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: SELECTED_OPPORTUNITY_ID, timestamp: new Date().toISOString() },
      actors: [{ userId: 'test-user-2', role: 'subject' as const }],
    }),
    makePersistable({
      detection: { mode: 'negotiation', sourceType: 'opportunity', sourceId: OTHER_OPPORTUNITY_ID, timestamp: new Date().toISOString() },
      actors: [{ userId: 'test-user-2', role: 'subject' as const }],
    }),
  ]);

  const scoped = await adapter.findPending('test-user-2', { scopeType: 'intent', scopeId: SELECTED_INTENT_ID });
  const scopedIds = new Set(scoped.map((q) => q.id));
  expect(scopedIds.has(insertedIds[0])).toBe(true);
  expect(scopedIds.has(insertedIds[1])).toBe(true);
  expect(scopedIds.has(insertedIds[2])).toBe(false);
});
```

### services/api/src/services/tests/opportunity.service.startChat.spec.ts — MODIFY
Verify scoped start-chat skips sibling acceptance while unscoped behavior remains unchanged.
```ts
const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';
const OTHER_INTENT_ID = '00000000-0000-4000-8000-00000000a222';

it('scoped startChat accepts only the selected row and skips sibling acceptance', async () => {
  const opp = makeOpportunity({
    status: 'pending',
    detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
  });
  const { service, db } = makeServiceWithDb(opp);

  const result = await service.startChat(OPP_ID, VIEWER_ID, { scopeType: 'intent', scopeId: SELECTED_INTENT_ID });

  expect('error' in result).toBe(false);
  if ('error' in result) return;
  expect(result.conversationId).toBe(CONV_ID);
  expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(OPP_ID, VIEWER_ID, 'accepted', VIEWER_ID);
  expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
  expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
});

it('scoped startChat rejects a non-matching selected intent before mutation side effects', async () => {
  const opp = makeOpportunity({
    status: 'pending',
    detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
  });
  const { service, db } = makeServiceWithDb(opp);

  const result = await service.startChat(OPP_ID, VIEWER_ID, { scopeType: 'intent', scopeId: OTHER_INTENT_ID });

  expect(result).toMatchObject({ error: 'Opportunity not found', status: 404 });
  expect(db.getOrCreateDM).not.toHaveBeenCalled();
  expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
  expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
});
```

### services/api/tests/opportunity-service.self-accept-guard.spec.ts — MODIFY
Add scoped update-status coverage for row-only sibling behavior and non-matching intent guard.
```ts
const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';
const OTHER_INTENT_ID = '00000000-0000-4000-8000-00000000a222';

it('updateOpportunityStatus: scoped accept skips sibling acceptance but keeps direct side effects', async () => {
  const db = makeDb({
    detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
  });
  const svc = makeService(db);

  const result = await svc.updateOpportunityStatus(OPP_ID, 'accepted', COUNTERPART_ID, { scopeType: 'intent', scopeId: SELECTED_INTENT_ID });

  expect('opportunity' in result).toBe(true);
  expect(db.getOrCreateDM).toHaveBeenCalledWith(COUNTERPART_ID, SENDER_ID);
  expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(
    OPP_ID,
    COUNTERPART_ID,
    'accepted',
    COUNTERPART_ID,
  );
  expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
  expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
});

it('updateOpportunityStatus: scoped mutation rejects non-matching selected intent before side effects', async () => {
  const db = makeDb({
    detection: { source: 'opportunity_graph', triggeredBy: SELECTED_INTENT_ID, timestamp: new Date().toISOString() },
  });
  const svc = makeService(db);

  const result = await svc.updateOpportunityStatus(OPP_ID, 'accepted', COUNTERPART_ID, { scopeType: 'intent', scopeId: OTHER_INTENT_ID });

  expect(result).toMatchObject({ error: 'Opportunity not found', status: 404 });
  expect(db.getOrCreateDM).not.toHaveBeenCalled();
  expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
  expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
  expect(db.upsertContactMembership).not.toHaveBeenCalled();
});
```

### apps/mac/api/client.mjs — MODIFY
Add convenience forwarding for selected-intent list/home/questions/status/start-chat calls while preserving generic query/body methods.
```js
opportunities: {
  list: (query = {}, options = {}) => request(`/opportunities${toQueryString(query)}`, options),
  listForIntent: (intentId, query = {}, options = {}) => request(
    `/opportunities${toQueryString({ ...query, scopeType: 'intent', scopeId: intentId })}`,
    options,
  ),
  home: (query = {}, options = {}) => request(`/opportunities/home${toQueryString(query)}`, options),
  homeForIntent: (intentId, query = {}, options = {}) => request(
    `/opportunities/home${toQueryString({ ...query, scopeType: 'intent', scopeId: intentId })}`,
    options,
  ),
  chatContext: (peerUserId, options = {}) => request(
    `/opportunities/chat-context${toQueryString({ peerUserId })}`,
    options,
  ),
  get: (opportunityId, options = {}) => request(`/opportunities/${encodeURIComponent(opportunityId)}`, options),
  inviteMessage: (opportunityId, options = {}) => request(
    `/opportunities/${encodeURIComponent(opportunityId)}/invite-message`,
    options,
  ),
  updateStatus: (opportunityId, status, options = {}) => request(
    `/opportunities/${encodeURIComponent(opportunityId)}/status`,
    { ...options, method: 'PATCH', body: { status } },
  ),
  updateStatusForIntent: (opportunityId, status, intentId, options = {}) => request(
    `/opportunities/${encodeURIComponent(opportunityId)}/status`,
    { ...options, method: 'PATCH', body: { status, scopeType: 'intent', scopeId: intentId } },
  ),
  startChat: (opportunityId, options = {}) => request(
    `/opportunities/${encodeURIComponent(opportunityId)}/start-chat`,
    { ...options, method: 'POST', body: {} },
  ),
  startChatForIntent: (opportunityId, intentId, options = {}) => request(
    `/opportunities/${encodeURIComponent(opportunityId)}/start-chat`,
    { ...options, method: 'POST', body: { scopeType: 'intent', scopeId: intentId } },
  ),
},

questions: {
  pending: (filters = {}, options = {}) => request(
    `/questions${toQueryString({ status: 'pending', ...filters })}`,
    options,
  ),
  pendingForIntent: (intentId, filters = {}, options = {}) => request(
    `/questions${toQueryString({ status: 'pending', ...filters, scopeType: 'intent', scopeId: intentId })}`,
    options,
  ),
  answer: (questionId, body, options = {}) => request(
    `/questions/${encodeURIComponent(questionId)}/answer`,
    { ...options, method: 'POST', body },
  ),
  dismiss: (questionId, options = {}) => request(
    `/questions/${encodeURIComponent(questionId)}/dismiss`,
    { ...options, method: 'POST', body: {} },
  ),
},
```

### apps/mac/api/client.spec.mjs — MODIFY
Verify canonical `scopeType/scopeId` appears in relevant query strings/bodies.
```js
const SELECTED_INTENT_ID = '00000000-0000-4000-8000-00000000a111';

await expectCall(
  'opportunities.list scoped intent',
  (client) => client.opportunities.list({ status: 'pending', scopeType: 'intent', scopeId: SELECTED_INTENT_ID, limit: 10 }),
  { path: `/opportunities?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}&limit=10` },
);
await expectCall(
  'opportunities.listForIntent',
  (client) => client.opportunities.listForIntent(SELECTED_INTENT_ID, { status: 'pending', limit: 10 }),
  { path: `/opportunities?status=pending&limit=10&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` },
);
await expectCall(
  'opportunities.home scoped intent',
  (client) => client.opportunities.home({ scopeType: 'intent', scopeId: SELECTED_INTENT_ID, noCache: true }),
  { path: `/opportunities/home?scopeType=intent&scopeId=${SELECTED_INTENT_ID}&noCache=true` },
);
await expectCall(
  'opportunities.updateStatusForIntent',
  (client) => client.opportunities.updateStatusForIntent('opp/1', 'accepted', SELECTED_INTENT_ID),
  { path: '/opportunities/opp%2F1/status', method: 'PATCH', body: { status: 'accepted', scopeType: 'intent', scopeId: SELECTED_INTENT_ID } },
);
await expectCall(
  'opportunities.startChatForIntent',
  (client) => client.opportunities.startChatForIntent('opp/1', SELECTED_INTENT_ID),
  { path: '/opportunities/opp%2F1/start-chat', method: 'POST', body: { scopeType: 'intent', scopeId: SELECTED_INTENT_ID } },
);
await expectCall(
  'questions.pending scoped intent',
  (client) => client.questions.pending({ scopeType: 'intent', scopeId: SELECTED_INTENT_ID }),
  { path: `/questions?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` },
);
await expectCall(
  'questions.pendingForIntent',
  (client) => client.questions.pendingForIntent(SELECTED_INTENT_ID),
  { path: `/questions?status=pending&scopeType=intent&scopeId=${SELECTED_INTENT_ID}` },
);
```

### docs/specs/api-reference.md — MODIFY
Document canonical selected-intent scope parameters and the REST `intentId` alias.
```md
### GET /api/opportunities
- `scopeType` — Optional selected scope type. Use `intent` for selected-intent scope.
- `scopeId` — Required when `scopeType=intent`; selected intent UUID. Composes with `networkId`; it never broadens network visibility.
- `intentId` — Deprecated/convenience alias for `scopeType=intent&scopeId=<intentId>`.

### GET /api/opportunities/home
- `scopeType` — Optional selected scope type. Use `intent` for selected-intent scope.
- `scopeId` — Required when `scopeType=intent`; selected intent UUID. Applied before home visibility filtering, sorting, and counterpart dedupe.
- `intentId` — Deprecated/convenience alias for `scopeType=intent&scopeId=<intentId>`.

### PATCH /api/opportunities/:id/status
Body includes `status`, optional `scopeType: "intent"`, `scopeId`, and deprecated/convenience `intentId` alias. Scoped `accepted` updates affect only this opportunity row and do not accept same-counterpart sibling opportunities from other intents.

### POST /api/opportunities/:id/start-chat
Body includes optional `scopeType: "intent"`, `scopeId`, and deprecated/convenience `intentId` alias. When selected-intent scope is supplied, sibling acceptance is skipped; unscoped behavior preserves existing same-counterpart sibling acceptance.

Available Tools targeted row edits only:
| `list_opportunities` | Opportunity | List user's opportunities with optional `networkId` and selected-intent `scopeType: 'intent', scopeId` filters |
| `update_opportunity` | Opportunity | Accept or reject an opportunity. Optional selected-intent `scopeType/scopeId` narrows mutation before graph execution. Accepting returns a `conversationId` |

### GET /api/questions
`scopeType=intent&scopeId=<intentId>` returns direct intent questions plus negotiation questions whose source opportunity matches the selected-intent predicate. `intentId` is a deprecated/convenience alias.
```

## Slices
### Slice 1: Canonical intent scope envelope and opportunity predicate

**Files**: `packages/protocol/src/shared/agent/tool.scope.ts`, `packages/protocol/src/shared/agent/tool.helpers.ts`, `packages/protocol/src/shared/interfaces/database.interface.ts`, `services/api/src/adapters/opportunity.database.adapter.ts`, `services/api/src/services/opportunity.service.ts`, `services/api/src/services/tests/opportunity.service.listStatusFilter.spec.ts`

#### Automated Verification:
- [ ] Protocol scope primitives expose intent scope without breaking network scope helpers: `grep -n "ToolScopeType = 'network' | 'intent'\|focusedIntentId\|scopeFromIntentId" packages/protocol/src/shared/agent/tool.scope.ts`.
- [ ] Type checking accepts `OpportunityQueryOptions.scopeType/scopeId` as an optional selected-intent scope: `cd packages/protocol && bun run build`.
- [ ] Opportunity service pass-through preserves selected-intent scope with default statuses: `cd services/api && bun test src/services/tests/opportunity.service.listStatusFilter.spec.ts`.
- [ ] Adapter selected-intent predicate is SQL-side and composes with network/status conditions: `grep -n "scopeType === 'intent'\|actor->>'intent'" services/api/src/adapters/opportunity.database.adapter.ts` returns matches inside `getOpportunitiesForUser`.

#### Manual Verification:
- [ ] Confirm network helpers (`focusedNetworkId`, `deriveAllowedNetworkIds`, `deriveDiscoveryNetworkIds`) still only treat `scopeType === 'network'` as network scope.
- [ ] Confirm selected-intent scope uses `scopeType: 'intent', scopeId: <intentId>` rather than protocol-only `intentId`.
- [ ] Confirm the adapter predicate uses only `detection.triggeredBy` or the viewer actor's `intent`, not any counterpart actor's intent.
- [ ] Confirm no migration files are required for this slice.

### Slice 2: Read surface threading

**Files**: `services/api/src/services/opportunity.service.ts`, `services/api/src/controllers/opportunity.controller.ts`, `packages/protocol/src/opportunity/feed/feed.state.ts`, `packages/protocol/src/opportunity/feed/feed.graph.ts`, `packages/protocol/src/opportunity/tests/feed.graph.status-filter.spec.ts`, `packages/protocol/src/opportunity/opportunity.tools.ts`

#### Automated Verification:
- [ ] REST list/home controller normalizes `scopeType=intent&scopeId=...` and `intentId=...` alias into service scope: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/opportunity.controller.ts`.
- [ ] HomeGraph forwards intent scope before visibility filtering and dedupe: `cd packages/protocol && bun test src/opportunity/tests/feed.graph.status-filter.spec.ts`.
- [ ] Protocol `list_opportunities` consumes `focusedIntentId(context)` and optional explicit `scopeType/scopeId`: `grep -n "focusedIntentId\|scopeType\|scopeId" packages/protocol/src/opportunity/opportunity.tools.ts`.

#### Manual Verification:
- [ ] Confirm `scopeType/scopeId` are canonical on protocol/HomeGraph surfaces; `intentId` remains only a REST edge alias in this slice.
- [ ] Confirm existing network-scope guard still rejects mismatched `networkId` independently of intent scope.
- [ ] Confirm HomeGraph selected-intent narrowing occurs in the database load before `canUserSeeOpportunity`, `isActionableForViewer`, sorting, and counterpart dedupe.

### Slice 3: Selected-intent pending questions

**Files**: `packages/protocol/src/shared/interfaces/questioner.interface.ts`, `services/api/src/adapters/questioner.adapter.ts`, `services/api/src/services/question.service.ts`, `services/api/src/controllers/question.controller.ts`, `services/api/tests/questioner.adapter.spec.ts`

#### Automated Verification:
- [ ] Question controller normalizes `scopeType=intent&scopeId=...` and `intentId=...` alias into question filters: `grep -n "parseIntentScopeFromUrl\|scopeTypeQuerySchema\|scopeId" services/api/src/controllers/question.controller.ts`.
- [ ] Adapter returns direct intent questions and matching negotiation questions only for intent scope: `cd services/api && bun test tests/questioner.adapter.spec.ts`.
- [ ] Question filter contract includes selected-intent scope: `grep -n "scopeType\|scopeId" packages/protocol/src/shared/interfaces/questioner.interface.ts services/api/src/adapters/questioner.adapter.ts`.

#### Manual Verification:
- [ ] Confirm `/questions?scopeType=intent&scopeId=...` does not require the caller to know opportunity ids.
- [ ] Confirm `/questions?intentId=...` remains only an edge alias normalized into `{ scopeType: 'intent', scopeId }`.
- [ ] Confirm negotiation questions are included only when their source opportunity matches the canonical selected-intent opportunity predicate for the same viewer.
- [ ] Confirm ordinary `/questions` and existing `mode`/`sourceType`/`sourceId` filters remain unchanged when intent scope is absent.

### Slice 4: Scoped row-only mutations

**Files**: `services/api/src/services/opportunity.service.ts`, `services/api/src/controllers/opportunity.controller.ts`, `services/api/src/services/tests/opportunity.service.startChat.spec.ts`, `services/api/tests/opportunity-service.self-accept-guard.spec.ts`, `packages/protocol/src/opportunity/opportunity.tools.ts`

#### Automated Verification:
- [ ] Service scoped start-chat is row-only and rejects mismatches before side effects: `cd services/api && bun test src/services/tests/opportunity.service.startChat.spec.ts`.
- [ ] Service scoped status updates skip sibling acceptance and reject mismatches: `cd services/api && bun test tests/opportunity-service.self-accept-guard.spec.ts`.
- [ ] REST mutation surfaces normalize `scopeType/scopeId` and `intentId` alias: `grep -n "parseIntentScopeFromBody\|scopeType\|scopeId" services/api/src/controllers/opportunity.controller.ts`.
- [ ] Protocol `update_opportunity` uses `focusedIntentId(context)` and optional explicit `scopeType/scopeId` guard before graph mutation: `grep -n "focusedIntentId\|scopeType\|scopeId\|matchesSelectedIntentScope" packages/protocol/src/opportunity/opportunity.tools.ts`.

#### Manual Verification:
- [ ] Confirm scoped `PATCH /opportunities/:id/status` and `POST /opportunities/:id/start-chat` return not-found semantics when the opportunity does not match the selected intent scope.
- [ ] Confirm scoped accept/start-chat never calls `acceptSiblingOpportunities`.
- [ ] Confirm unscoped accept/start-chat still preserves existing sibling acceptance behavior.
- [ ] Confirm protocol `update_opportunity` preserves focused-network guard and adds selected-intent narrowing without changing graph mutation semantics.

### Slice 5: Consumer contract and API docs

**Files**: `apps/mac/api/client.mjs`, `apps/mac/api/client.spec.mjs`, `docs/specs/api-reference.md`

#### Automated Verification:
- [ ] Mac API client sends selected-intent scope query/body values without touching HaloApp UI bundles: `cd apps/mac && bun test api/client.spec.mjs`.
- [ ] API docs mention canonical `scopeType/scopeId` and alias `intentId` for opportunity list/home/status/start-chat and question list: `grep -n "scopeType\|scopeId\|intentId" docs/specs/api-reference.md`.
- [ ] Generated Mac bundles are untouched: `git diff --name-only -- apps/mac | grep -v '^apps/mac/api/'` prints no HaloApp `Resources/`, `dist/`, or app bundle paths.

#### Manual Verification:
- [ ] Confirm Mac changes are limited to `apps/mac/api/client.mjs` and `apps/mac/api/client.spec.mjs`.
- [ ] Confirm docs describe `scopeType/scopeId` as canonical selected-intent scope and `intentId` as only an alias.
- [ ] Confirm docs state scoped accept/start-chat skip sibling acceptance while unscoped behavior remains unchanged.
- [ ] Confirm docs update the two relevant Available Tools rows without deleting unrelated tool rows.

## Desired End State
```ts
// Canonical protocol/tool context: selected-intent focus
const context = {
  scopeType: 'intent',
  scopeId: '<intentId>',
};

// Protocol tool consumers inherit selected-intent scope from context.
list_opportunities({})
update_opportunity({ opportunityId, status: 'accepted' })

// Explicit tool override remains possible when no selected-intent context exists.
list_opportunities({ scopeType: 'intent', scopeId: '<intentId>' })
update_opportunity({ opportunityId, status: 'accepted', scopeType: 'intent', scopeId: '<intentId>' })
```

```ts
// Backend REST: canonical selected-intent scope query form
GET /api/opportunities?scopeType=intent&scopeId=<intentId>
GET /api/opportunities/home?scopeType=intent&scopeId=<intentId>&limit=20
GET /api/questions?status=pending&scopeType=intent&scopeId=<intentId>

// REST may retain intentId as a convenience alias normalized at the controller boundary.
GET /api/opportunities?intentId=<intentId>
GET /api/questions?status=pending&intentId=<intentId>

// Scoped row-only accept/start-chat guard
PATCH /api/opportunities/<opportunityId>/status
{ "status": "accepted", "scopeType": "intent", "scopeId": "<intentId>" }

POST /api/opportunities/<opportunityId>/start-chat
{ "scopeType": "intent", "scopeId": "<intentId>" }
```

## File Map
```text
packages/protocol/src/shared/agent/tool.scope.ts             # MODIFY — add intent scope type/helper
packages/protocol/src/shared/agent/tool.helpers.ts           # MODIFY — update tool context scope contract/comments
packages/protocol/src/shared/interfaces/database.interface.ts  # MODIFY — opportunity query contract
services/api/src/adapters/opportunity.database.adapter.ts      # MODIFY — SQL predicate
services/api/src/services/tests/opportunity.service.listStatusFilter.spec.ts # MODIFY — option pass-through tests
services/api/src/services/opportunity.service.ts              # MODIFY — list/home/mutation options
services/api/src/controllers/opportunity.controller.ts        # MODIFY — REST parsing/validation
packages/protocol/src/opportunity/feed/feed.state.ts          # MODIFY — home graph state channel
packages/protocol/src/opportunity/feed/feed.graph.ts          # MODIFY — home graph intent filter
packages/protocol/src/opportunity/tests/feed.graph.status-filter.spec.ts # MODIFY — home graph test
packages/protocol/src/opportunity/opportunity.tools.ts        # MODIFY — protocol tool schemas/guards
packages/protocol/src/shared/interfaces/questioner.interface.ts # MODIFY — question filter contract
services/api/src/adapters/questioner.adapter.ts               # MODIFY — selected-intent question join
services/api/src/services/question.service.ts                 # MODIFY — docs/types passthrough
services/api/src/controllers/question.controller.ts           # MODIFY — REST parsing/validation
services/api/tests/questioner.adapter.spec.ts                 # MODIFY — adapter join tests
services/api/src/services/tests/opportunity.service.startChat.spec.ts # MODIFY — scoped start-chat tests
services/api/tests/opportunity-service.self-accept-guard.spec.ts # MODIFY — scoped update tests
apps/mac/api/client.mjs                                       # MODIFY — consumer helper contract
apps/mac/api/client.spec.mjs                                  # MODIFY — endpoint contract tests
docs/specs/api-reference.md                                   # MODIFY — REST docs
```

## Ordering Constraints
- Slice 1 must land before any read, question, or mutation surface can safely consume selected-intent scope; it extends `ToolScopeType` and adds `focusedIntentId` so protocol tools do not invent a parallel `intentId` scope concept.
- Slice 2 and Slice 3 both depend on Slice 1 but are otherwise conceptually separable; this design keeps them sequential for review clarity.
- Slice 4 depends on Slice 1 and partly overlaps files from Slice 2; final code fences must merge `OpportunityService`, `OpportunityController`, and `opportunity.tools.ts` edits.
- Slice 5 is terminal because docs and Mac client contract should reflect the final public backend/protocol shape.

## Verification Notes
- Verify selected-intent filtering is SQL-side, not post-filtered in controllers or Mac code.
- Verify selected intent is represented canonically as `{ scopeType: 'intent', scopeId: <intentId> }` in protocol/tool contexts, with `intentId` only as an edge alias where retained for REST/Mac convenience.
- Verify intent scope is optional and composes with existing `networkId`/focused-network filters rather than broadening network visibility.
- Verify `/opportunities/home?intentId=...` applies narrowing before home counterpart dedupe.
- Verify `/questions?intentId=...` returns negotiation questions by joining their opportunity source ids to scoped opportunities.
- Verify scoped accept/start-chat does not call `acceptSiblingOpportunities`.
- Verify unscoped accept/start-chat still preserves existing sibling acceptance behavior.
- Verify negative case: same counterpart under another intent is excluded from scoped reads and not mutated by scoped accept.
- Verify no migrations are generated or required.
- Verify Mac generated bundles are not changed.

## Performance Considerations
- The selected-intent opportunity predicate is JSONB-based and added to an already-filtered actor/status query; keep it in SQL so limits and home fetch budgets apply after scoping.
- The selected-intent question query adds an `EXISTS` subquery against opportunities only for `intentId` requests; ordinary pending-question reads remain unchanged.
- HomeGraph already over-fetches up to 150 rows before dedupe; selected-intent filtering reduces the candidate set before presenter/cache work.
- Protocol `list_opportunities` continues to fetch `CHAT_FETCH_LIMIT` rows, now narrowed by `intentId` when provided.

## Migration Notes
No persisted schema change. Existing `opportunities.detection.triggeredBy` and `opportunities.actors[].intent` JSONB fields are used. Rollback is code-only: remove `intentId` query/body/tool support and predicates.

## Pattern References
- `packages/protocol/src/shared/agent/tool.scope.ts:1-45` — canonical `scopeType`/`scopeId` envelope and focused-scope helpers.
- `packages/protocol/src/shared/agent/tool.helpers.ts:65-70` — tool context carries the scope envelope.
- `services/api/src/controllers/question.controller.ts:43-91` — controller query parsing into typed filters.
- `services/api/src/adapters/questioner.adapter.ts:145-184` — SQL-side question filter enforcement.
- `services/api/src/controllers/opportunity.controller.ts:48-73` — opportunity list query parsing pattern.
- `services/api/src/services/opportunity.service.ts:284-303` — service-owned default status filter pattern.
- `services/api/src/adapters/opportunity.database.adapter.ts:73-157` — opportunity visibility/network/status SQL predicates.
- `packages/protocol/src/opportunity/feed/feed.graph.ts:198-236` — home load then visibility/dedupe flow.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1542-1620` — protocol list tool database-read boundary.
- `services/api/src/services/opportunity.service.ts:620-773` — failure-safe start-chat mutation ordering.
- `apps/mac/api/client.spec.mjs:5-35` — endpoint contract test style.

## Developer Context
**Q (`packages/protocol/src/opportunity/opportunity.graph.ts:2956-2962`, `services/api/src/adapters/opportunity.database.adapter.ts:413-432`): For selected-intent opportunity reads, which predicate should be canonical?**
A: Triggered + my actor.

**Q (`services/api/src/adapters/opportunity.database.adapter.ts:73-157`, `services/api/src/controllers/opportunity.controller.ts:48-73`, `services/api/src/services/opportunity.service.ts:219-238`, `packages/protocol/src/opportunity/opportunity.tools.ts:1542-1620`): Should this design expose selected-intent scoping across every backend/protocol read surface now, or only the raw REST list first?**
A: All read surfaces.

**Q (`services/api/src/controllers/question.controller.ts:43-91`, `services/api/src/adapters/questioner.adapter.ts:158-166`, `packages/protocol/src/negotiation/negotiation.graph.ts:415-421`): Where should the backend join direct intent questions with negotiation questions from scoped opportunities?**
A: Extend `/questions`.

**Q (`services/api/src/services/opportunity.service.ts:532-553`, `services/api/src/services/opportunity.service.ts:746-767`, `services/api/src/adapters/opportunity.database.adapter.ts:326-353`): For calls carrying `intentId`, should the backend skip sibling acceptance entirely or scope sibling acceptance to the same selected intent?**
A: Row only.

**Q (`services/api/src/events/handlers/question.answer.negotiation.ts:56-70`, `packages/protocol/src/negotiation/negotiation.graph.ts:108-116`): Should this selected-intent design change the backend lifecycle after a negotiation question is answered?**
A: Keep metadata only.

**Correction:** User asked to focus more on backend and protocol, less on Mac App. The design treats Mac as a consumer contract, not the primary implementation surface.

**Follow-up (`services/api/src/adapters/opportunity.database.adapter.ts:108-135`, `packages/protocol/src/opportunity/opportunity.tools.ts:1559-1580`): Also check that selected-intent scoping follows the network scope pattern and is optional.**
A: Initial answer treated `intentId` as a separate optional narrowing filter. User corrected that the protocol should extend the existing `scopeType`/`scopeId` model instead. Revised decision: `ToolScopeType` becomes `'network' | 'intent'`; selected intent is canonical as `{ scopeType: 'intent', scopeId: <intentId> }`; `intentId` may remain only as an edge alias normalized into the scope envelope.

**Micro-checkpoint (Slice 3: `packages/protocol/src/shared/interfaces/questioner.interface.ts`, `services/api/src/adapters/questioner.adapter.ts`, `services/api/src/controllers/question.controller.ts`): Selected-intent pending questions extend `/questions?intentId=...` with a SQL-side union of direct intent questions and negotiation questions joined through scoped opportunities.**
A: User said “continue”; treated as approval. Slice-verifier first caught UUID/text comparison in the opportunity join; code was corrected to compare `scoped_opp.id::text` to `questions.detection->>'sourceId'`, then reverified OK.

**Micro-checkpoint (Slice 4: `services/api/src/services/opportunity.service.ts`, `services/api/src/controllers/opportunity.controller.ts`, `packages/protocol/src/opportunity/opportunity.tools.ts`): Scoped row-only mutations add optional `intentId` to REST status/start-chat and protocol `update_opportunity`, verify the selected opportunity matches the canonical predicate, and skip sibling acceptance for scoped REST calls.**
A: Approved. Slice-verifier first caught non-copy-pasteable placeholder snippets; code was regenerated with full replacement method bodies and reverified OK.

## Design History
- Slice 1: Canonical intent scope envelope and opportunity predicate — revised after user correction to extend `ToolScopeType` with `'intent'`; verifier passed after full lockable `tool.scope.ts`, adapter method, and service signature snippets were generated
- Slice 2: Read surface threading — revised to consume `{ scopeType: 'intent', scopeId }` on protocol/HomeGraph surfaces and normalize REST `intentId` as an edge alias; verifier passed after preserving existing `getHomeView` `maintenanceTriggered` meta behavior
- Slice 3: Selected-intent pending questions — revised to use canonical `scopeType: 'intent', scopeId` question filters with REST `intentId` alias normalization; verifier passed with full direct-intent + negotiation-question adapter test setup
- Slice 4: Scoped row-only mutations — revised to use canonical `scopeType: 'intent', scopeId` guards on REST/service/protocol mutations; verifier passed after concrete full service/controller/protocol/test snippets replaced all placeholders, then reopened because mutation guards must consume selected-intent scope envelope rather than only `intentId`
- Slice 5: Consumer contract and API docs — revised to emit canonical `scopeType/scopeId` from Mac API helpers/tests and document `intentId` only as a REST convenience alias; verifier passed after endpoint/tool docs were expanded

## References
- `.rpiv/artifacts/research/2026-06-25_20-11-34_intent-scoping-mac.md`
- `.rpiv/artifacts/plans/2026-06-25_10-10-04_split-chat-scope-semantics.md`
- `.rpiv/artifacts/validation/2026-06-25_12-26-08_split-chat-scope-semantics.md`
- `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md`
- `.rpiv/artifacts/validation/2026-06-22_20-38-00_document-apps-mac.md`
