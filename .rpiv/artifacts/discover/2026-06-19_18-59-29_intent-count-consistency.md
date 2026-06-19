---
date: 2026-06-19T18:59:29+0300
author: Yanek Yuk
commit: 1fb525e730
branch: yanki/edg-53-fix-intent-count-consistency
repository: index
topic: "Intent count consistency across surfaces"
tags: [intent, frd, library, networks, mcp, hermes, edge-city, count-consistency]
status: ready
last_updated: 2026-06-19T18:59:29+0300
last_updated_by: Yanek Yuk
---

# FRD: Intent count consistency across surfaces

## Summary
Users see different intent counts depending on where they look — `/library`, `/networks`, the MCP tools, the Hermes/AgentVillage sidecar, and the backend each compute "a user's intents" with different filter sets, and Hermes never fetches it at all. This erodes trust and makes the product feel broken. The deliverable is to converge every surface on one canonical intent definition and have each surface properly *list* the underlying data: `/library` shows all intents with their network assignments and status, the `/networks` overview tab shows intents + premises + user_context per network, and MCP + Hermes report the same canonical count — with Hermes correctly reflecting its scoped-API-key view. Linear: EDG-53 (Urgent).

## Problem & Intent
The user's framing: this is a **user-facing trust / confusion** problem. End users see different intent counts across `/library`, MCP, and `/networks` (and Hermes vs Index), which erodes trust and makes the product feel broken. The goal is a single consistent number — and consistent underlying lists — everywhere a user looks. The user further clarified that the surfaces should not just show a matching integer but properly surface the data: "Library shows all intents, their assignments to networks, and their status (if applicable)" and the "Network overview tab should show intents and premises assigned to that network, and also the user_context."

A critical constraint: through AgentVillage/Hermes, Index is accessed via a **scoped API key**, so "the same count" for Hermes means the count correct *for that scoped-key view*, not the owner's full unscoped set.

## Goals
- Establish one canonical definition of "a user's intents" that all surfaces converge on.
- `/library` lists all intents with their network assignments and status, and its count reflects the canonical total (not a capped page length).
- `/networks` overview tab surfaces the intents + premises + user_context assigned to that network.
- MCP intent-listing/count tools report the canonical count consistent with `/library`.
- Hermes/AgentVillage reports an intent count (currently `null`) that is correct for its scoped-API-key view and consistent with the other surfaces under the same scope/identity.

## Non-Goals
- Changing the intent data model or introducing a new `status`-based filter is NOT assumed — the canonical filter set is deferred to research (see Open Questions), so this FRD does not pre-commit to excluding `PAUSED/FULFILLED/EXPIRED`.
- Redesigning the negotiation / opportunity surfaces (opportunity counts are already wired in Hermes and out of scope here).

## Functional Requirements
1. The system SHALL define a single canonical query/definition for "a user's intents" that all surfaces reuse (exact filter set to be settled in research).
2. `/library` SHALL list all of a user's intents and, for each, display its network assignments and its status (when applicable).
3. `/library`'s intent count SHALL reflect the canonical server-side total rather than the client-side length of a paginated, capped result set.
4. The `/networks` overview tab SHALL display the intents, premises, and user_context assigned to that network.
5. The MCP intent-read/count tooling SHALL return a count consistent with the canonical definition used by `/library`.
6. The Hermes/AgentVillage control-plane SHALL fetch and report an intent count (replacing the hard-coded `null`) that reflects what its scoped API key is authorized to see.
7. For a single identity/scope, all surfaces SHALL agree on the intent count.

## Non-Functional Requirements
- **Performance**: Count queries should avoid N+1 across surfaces; reuse the existing single-`count()`-with-shared-`where` pattern in the backend list query where possible. No hard latency target set.
- **Security**: The scoped API key used by AgentVillage/Hermes MUST NOT widen visibility — the canonical count for Hermes is bounded by what the scoped key authorizes, never the owner's full unscoped set.
- **UX / Accessibility**: Counts and lists must read as consistent across surfaces; no surface should silently truncate or mislabel (e.g., showing a capped page length as if it were the total).
- **Reliability**: Hermes must degrade gracefully if the intent fetch fails (it currently shows `—` for null); a fetch error should not break the rest of the stats payload.

## Constraints & Assumptions
- AgentVillage/Hermes accesses Index through a **scoped API key** — the canonical count rule must be evaluated under that scope.
- Canonical schema is `backend/src/schemas/database.schema.ts`; intents are soft-deleted via `archivedAt` (no `deletedAt`/`draft` column on `intents`).
- Multiple sibling queries already exist (`listIntents`, `getActiveIntents`, `getActiveIntentsAcrossIndexes`, `getIntentsInIndexForMember`, `searchOwnIntents`) — convergence likely means consolidating on a shared definition rather than adding a sixth.
- Assumption: "premises" and "user_context" map to existing entities/fields — to be traced in research before the `/networks` overview requirement is finalized.

## Acceptance Criteria
- [ ] For a test user, the integer intent count shown on `/library`, returned by the MCP read tool, and reported by Hermes (under its scoped key for that identity) are equal.
- [ ] `/library` renders, for each intent, its network assignment(s) and status, and the tab badge equals the server `totalCount` even when the user has more than 100 intents.
- [ ] The `/networks` overview tab renders the intents, premises, and user_context assigned to the selected network.
- [ ] The Hermes/AgentVillage admin stat for intents shows a real number (not `—`/`null`) sourced from a scoped-key fetch, and matches the canonical count for that scope.
- [ ] A documented single canonical intent definition exists and every surface references it (code review confirms no surface applies a divergent filter without justification).

## Recommended Approach
Consolidate the divergent intent queries onto one canonical definition in the backend adapter/service layer, expose the canonical count through the existing `/intents/list` pagination payload and the MCP read path, fix `/library` to render `totalCount` plus per-intent network assignments and status, add an intent fetch (scoped-key aware) to the edge-city control-plane mirroring `fetchIndexOpportunityCount`, and extend the `/networks` overview tab to render network-scoped intents + premises + user_context. Exact canonical filter set and the premises/user_context mappings are to be settled in research before implementation.

## Decisions

### Primary pain is user-facing trust
**Question**: What's the actual pain here — who notices the inconsistent intent counts and what goes wrong for them?
**Recommended**: n/a — `intent` question
**Chosen**: User-facing trust / confusion — end users see different counts across surfaces, eroding trust; goal is one consistent number (and list) everywhere.
**Rationale**: Developer's own framing; drives all downstream requirements.

### Deliverable is full per-surface listing + consistency (all surfaces)
**Question**: Is the deliverable just to reconcile the count integer, or to properly surface the underlying intent data on each surface?
**Recommended**: Full per-surface listing + consistency (all surfaces)
**Chosen**: Full listing + consistency across all surfaces, including Hermes — with the explicit note that AgentVillage/Hermes uses a scoped API key.
**Rationale**: Developer chose option (1) twice and added the scoped-key constraint; consistency should fall out of a shared canonical query layer.

### Scoped-key view is the canonical count for Hermes
**Question**: How should the scoped API key AgentVillage uses affect the canonical count?
**Recommended**: Scoped-key view IS the canonical count for Hermes
**Chosen**: The count Hermes reports must reflect exactly what the scoped API key is authorized to see; "consistency" means surfaces agree for the same identity/scope.
**Rationale**: Security boundary — a scoped key must not be normalized up to the owner's full set; `evidence: packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:321` (intents currently `null`, never fetched).

### `/library` should show all intents + assignments + status
**Question**: (Captured via developer free-text during scope confirmation.)
**Recommended**: Use server `totalCount`, render network assignments and status per intent.
**Chosen**: "Library shows all intents, their assignments to networks, and their status (if applicable)."
**Rationale**: Developer's explicit statement; `evidence: frontend/src/app/library/page.tsx:103-104,223-224` (currently displays `intents.length` of a 100-capped page, no assignments/status badges).

### `/networks` overview tab should show intents + premises + user_context
**Question**: What does the ticket's "/networks should list proper intents and counts" refer to? (probe found no intent count on `/networks` pages)
**Recommended**: Network detail should show a per-network intent count.
**Chosen**: "Network overview tab should show intents and premises assigned to that network, and also the user_context."
**Rationale**: Developer clarified the intended surface; `evidence: frontend/src/app/networks/page.tsx`, `frontend/src/app/networks/[id]/page.tsx` render only `_count.members` today.

### Canonical filter definition — deferred to research
**Question**: What is the single canonical definition of "a user's intent count" that every surface should converge on?
**Recommended**: Backend `listIntents` filter as-is (userId + `archivedAt IS NULL`, no status filter)
**Chosen**: Defer — decide during research.
**Rationale**: Developer deferred; the per-surface divergence (status enum vs `archivedAt`, network-membership joins, dedup) needs full tracing before fixing the canonical rule.

## Open Questions
- Exact canonical intent filter set — userId + `archivedAt IS NULL` only, vs. also excluding `PAUSED/FULFILLED/EXPIRED` (status enum is currently never filtered; all surfaces key off `archivedAt`). Deferred to research.
- What "premises" maps to in the data model (a column, an MCP concept, or a derived field), and what "user_context" refers to for the `/networks` overview tab. Deferred to research to trace.
- How the AgentVillage/Hermes scoped API key resolves to intent scoping at the backend/MCP boundary — needed to define the canonical count "under scope."

## Suggested Follow-ups
- The intent `status` enum (`ACTIVE/PAUSED/FULFILLED/EXPIRED`) is selected but never used as a filter on any surface — `backend/src/schemas/database.schema.ts:10,562`. If status-based counting is desired later, it's a separate decision.
- `getActiveIntentsAcrossIndexes` dedups via `selectDistinctOn([intents.id])` while other community-browse paths may not — `backend/src/adapters/database.adapter.ts:817-841`. Worth auditing for multi-network inflation independent of this ticket.
- Hermes' `summarize-negotiations.ts` re-filters `i.status === "active"` client-side after an MCP `read_intents` (limit 20) call — yet another count basis — `packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts:294-309`.

## References
- Linear EDG-53 — "Fix intent count consistency" (Urgent): https://linear.app/edge-city/issue/EDG-53/fix-intent-count-consistency
- `backend/src/adapters/database.adapter.ts:512-553` (`listIntents`, canonical list+count), `:310-328` (`getActiveIntents`, MCP path), `:817-841` (`getActiveIntentsAcrossIndexes`)
- `backend/src/controllers/intent.controller.ts:29-51`, `backend/src/services/intent.service.ts:91-118`
- `frontend/src/app/library/page.tsx:103-104,223-224`; `frontend/src/services/intents.ts:6-15`
- `frontend/src/app/networks/page.tsx`, `frontend/src/app/networks/[id]/page.tsx`
- `packages/protocol/src/intent/intent.tools.ts:75-202` (`read_intents`), `intent.graph.ts:683-837`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:321,509`, `index-network.js:54-66`
