---
title: "Single-Path Opportunities"
type: design
tags: [opportunities, discovery, negotiation, floor-lab, deduplication]
created: 2026-08-26
updated: 2026-08-27
status: draft
---

# Single-Path Opportunities

Design spec to collapse opportunity creation to **one path** — intent-triggered bilateral discovery with create-at-kickoff — and **delete every other creation path and trace** of removed features. Companion implementation: Floor lab (`feat/floor-lab`) and follow-up production PRs.

Related: [Floor Lab two-intent discovery](floor-lab-two-intent-discovery.md) (when merged), [opportunity status lifecycle](opportunity-status-lifecycle.md).

## Problem

Today the product has **six ways** an `opportunities` row can be created. Only one is the core bilateral-intent model Floor lab exercises:

| # | Path | Trigger | Entry point |
|---|------|---------|-------------|
| 1 | **Intent discovery** | User confirms intent → HyDE → queue | `discovery.queue.ts` → OpportunityGraph `create` → `persistNode` |
| 2 | **Maintenance / rediscovery** | Intent created/archived, feed-health | `triggerMaintenance` → MaintenanceGraph → re-enqueue discovery |
| 3 | **Manual curator** | Network owner POSTs a match | `POST /networks/:networkId/opportunities` |
| 4 | **Introduction** | Chat/agent introduces two people | `createIntroduction` (`create_introduction` mode) |
| 5 | **Enrichment discovery** | Premise/context changes | Non-HyDE graph legs; folded into maintenance |
| 6 | **`discover_opportunities` tool** | Inline agent discovery | Removed from tool surface; references remain |

Path **#1** persists `latent` opportunities at discovery time, then PersonalAgent kickoff opens negotiation. That forces persist-time dedup (enricher, 30d window, same-intent-pair suppress, feed dedup, newborn stamping) for a problem that disappears if we **create the row only at kickoff**.

Paths **#2–#6** add blast radius, dead code, and lifecycle complexity (`latent`, `draft`, `introducer` actors, `send`, `connector-flow` radar) without serving the two-intent model.

## Goals

| Goal | Measure |
|------|---------|
| One creation path | Only intent confirm → HyDE → discovery → candidates → PA kickoff INSERTs opportunities |
| Create at open | Opportunity born in `createAndOpen` with status `negotiating` |
| Zero trace | Grep gate: zero hits for banned tokens in `packages/protocol/src`, `services/api/src`, `apps/web/src`, `docs/` |
| No legacy | No dual-read, no preserved enum values, no recycle archive — delete and migrate data |
| Pair idempotency | `pairKey = (networkId, min(intentA, intentB), max(intentA, intentB))` + advisory lock |

## Non-goals

- Multi-path convergence behind feature flags
- Preserving introducer, manual, or enrichment rows for read-only history
- Archive copies of deleted modules to `indexnetwork/recycle`
- Auditing whether `pending` survives post-negotiation (see §Open questions)

## Policy

- **No legacy.** Break old data shapes; migrate forward or delete rows.
- **No dead code.** Delete files, tests, docs, CLI scripts — do not deprecate.
- **Definition of done:** CI grep gate passes (see §Verification).

## Target architecture

```mermaid
flowchart LR
  confirm[Intent confirm] --> hyde[HyDE queue]
  hyde --> discovery[discovery queue]
  discovery --> graph[OpportunityGraph]
  graph --> emit[emitCandidates]
  emit --> ready[matches_ready, one per intent]
  ready --> pa[PersonalAgent turn]
  pa --> kickoff[runKickoff]
  kickoff --> createOpen["createAndOpen (advisory lock on pairKey)"]
  createOpen --> negotiate["negotiations.invoke"]
  negotiate --> accepted[Human accepted]
```

**Discovery never INSERTs `opportunities` rows.** The graph's `prep → scope → resolve → discovery → evaluation → ranking` stages are unchanged; only the terminal `persist` node is replaced. Ranked output lands in `discovery_match_candidates`. PersonalAgent kickoff calls `createAndOpen`: advisory lock on `pairKey` → check for an active opportunity on that pair → INSERT opportunity → mark candidate `opened`.

### Pair identity

```
pairKey = (networkId, min(intentA, intentB), max(intentA, intentB))
```

One candidate row per pair, unique on `pairKey`. Alice's discovery run and Bob's discovery run converge on the same row instead of producing two. **This constraint is the dedup** — it replaces the enricher, the 30-day window, same-intent-pair suppression and newborn stamping with a database invariant.

The race it guards is bilateral and real: both principals' PersonalAgents receive `matches_ready` for the same pair and both may kick off. A unique partial index on active opportunity rows plus an advisory lock means parallel kickoff returns `existing` or `raced`, never a second row.

### Match identity through the PA turn

`opportunityId` is currently the spine of a PersonalAgent turn: `kickoffTargets`, `knownMatchIds` (the end-of-turn new-arrival re-check), `resolvedHere` (promote/reject dedup), `threadByOpportunity`, `compensateFailedOpen`, the accumulator and the ledger all key on it. A match that has no row yet cannot carry it.

Adding an optional `candidateId?` alongside it would make `opportunityId` optional in practice and grow a nullable branch at each of those sites — two code paths where there is one today. Instead `PersonalAgentMatch` carries a **discriminated ref**, so there is still exactly one identifier per match:

```ts
interface PersonalAgentMatch {
  ref: { kind: 'candidate'; id: string }
     | { kind: 'opportunity'; id: string };
  label: string;
  status: string;
}
```

Every dedup and re-check site keeps its shape, reading `match.ref.id`. Exactly one place branches — `runKickoff`, at the moment of open:

```ts
const opportunityId = match.ref.kind === 'candidate'
  ? await deps.opportunities.createAndOpen(match.ref.id)
  : match.ref.id;
```

### `createAndOpen` returns, never throws

`runKickoff` bumps the negotiation round before opening, and below that bump **nothing throws** (D54): the turn has already written a principal-visible strategy message and opened a round, so a retry would duplicate both. `createAndOpen` sits below the bump, so it returns a result:

```
{ status: 'created' | 'existing' | 'raced' | 'failed', opportunityId?, reason? }
```

`failed` routes into `compensateFailedOpen`, which gains one new case: a row created whose negotiation open did not succeed.

### Opportunity lifecycle (after)

| Status | When |
|--------|------|
| `negotiating` | Born at kickoff |
| `pending` | Post-negotiation human gate (unchanged in this program) |
| `accepted` / `rejected` / `expired` / `stalled` | Unchanged terminal semantics |

**Removed statuses:** `latent`, `draft` — opportunities do not exist before kickoff.

**Removed actor role:** `introducer` — bilateral `party` actors only (plus negotiation roles `agent` / `patient` / `peer`).

**Removed detection sources:** `manual`, `enrichment`, `introducer_discovery`.

**Removed discovery sources:** `premise-similarity`, `context-similarity`, `context-to-intent` — HyDE `query` only.

## What gets deleted

### Creation paths (#2–#6)

| Path | Delete |
|------|--------|
| Maintenance (#2) | `MaintenanceGraph` module, `triggerMaintenance`, intent event hooks |
| Manual curator (#3) | `POST /networks/:networkId/opportunities`, `createManualOpportunity` |
| Introduction (#4) | `createIntroduction`, `approveIntroduction`, intro graph modes, persist branch, introducer UI |
| Enrichment (#5) | Non-HyDE discovery legs, `opportunity.enricher.ts`, enrichment detection source |
| discover tool (#6) | Stale docs, MCP/UI/test references (`discover_opportunities`, `get_discovery_run`, `cancel_discovery_run`) |

A previous cleanup already collapsed the nine `operationMode` graph nodes into plain functions in `opportunity.graph.modes.ts` — "only the discovery pipeline still needs a graph." So `send`, `approve_introduction` and the introduction path are functions to delete, not graph surgery.

### Lifecycle and radar traces

| Remove | Notes |
|--------|-------|
| `send` operation mode, `sendOpportunity` | No latent → pending promote |
| `approve_introduction` | Introducer approval gate |
| `connector-flow` radar category | Radar is connection-only |
| Introducer branches in `opportunity.utils`, radar graph, notifications | Zero introducer logic |
| Introducer filtering in `matchesReadyNode` and `readSignalMatches` | Both branches disappear with the role |

### Discovery dedup

Dead the moment discovery stops persisting, so deleted in the same PR — not deferred:

| Module | Action |
|--------|--------|
| `opportunity.enricher.ts` | Delete |
| `opportunity.graph.persist-node.ts` `suppress*` helpers | Delete with the node |
| `opportunity.newborn-stamping.ts` | Delete |
| `DEDUP_WINDOW_MS` persist dedup | Delete |
| Feed dedup for multi-latent rows | Delete — no multi-latent rows exist |

### Docs to delete (not edit)

- `docs/handoffs/refactor-discover-opportunities-rename.md`
- `docs/specs/2026-05-12-discover-opportunities-rename-design.md`
- `docs/specs/2026-05-06-expose-introducer-opportunities-to-pollers-design.md`
- `docs/rollout/background-only-discovery-release-1.md` (if only about removed paths)
- `docs/superpowers/specs/2026-07-29-background-only-discovery-design.md` (if superseded)

Rewrite `docs/domain/opportunities.md` Discovery Triggers to intent-only. `docs/domain/radar-and-maintenance.md` loses its maintenance half.

## Data migration

Single Drizzle migration in the purge PR:

1. `CREATE TABLE discovery_match_candidates` with the unique `pairKey` index
2. `DELETE` opportunities with `introducer` actors, `latent`/`draft` status, or `detection.source` in (`manual`, `enrichment`, `introducer_discovery`)
3. Alter `opportunity_status` enum: drop `latent`, `draft`
4. Alter actor role constraint: drop `introducer`
5. Drop `approved` on `opportunity_actors` if present
6. Unique partial index on active opportunity rows keyed by pair

## Trace audit (Phase 0)

Ripgrep banned tokens across `packages/protocol/src`, `services/api/src`, `apps/web/src`, `docs`:

```
createManualOpportunity | createIntroduction | approveIntroduction | approve_introduction
create_introduction | triggerMaintenance | MaintenanceGraph | maintenanceGraph
discover_opportunities | get_discovery_run | cancel_discovery_run
introducer_discovery | connector-flow | sendOpportunity | sendOpportunityLifecycle
role === 'introducer' | role: 'introducer' | viewerRole.*introducer
premise-similarity | context-similarity | context-to-intent
detection.*manual | source: 'manual' | source: 'enrichment'
from-enrichment | from-introducer | rediscovery
```

**158 unique files** as of 2026-08-27, not the ~320 first estimated:

| Area | Files |
|------|-------|
| `packages/protocol/src` | 66 |
| `services/api/src` | 50 |
| `apps/web/src` | 6 |
| `docs/` | ~22 |

Roughly 102 of those hit only on the bare token `introducer`, so the substantive surface is narrower than the count suggests.

## Implementation order

Phases 1–3 land as **one PR**. The original A/B/C split had each PR marked "deploy with the other two", which is not three PRs — merging the purge alone leaves `dev` with discovery no longer creating opportunities and kickoff not yet creating them either.

Core first, purge second: once opportunities are born at kickoff, most of the purge is dead code that deletes cleanly rather than needing careful rewiring.

### Phase 2 — Match candidates

- New table `discovery_match_candidates` (`pairKey` unique, evaluator fields, `status`: `pending` | `opened` | `superseded` | `expired`)
- `emitCandidatesNode` replaces `persistNode`; the graph's earlier stages are untouched
- `matchesReadyNode` derives its intent set from candidates, not from opportunity actors
- discovery queue tests: zero `createOpportunity` calls

### Phase 3 — createAndOpen at PA kickoff

- Protocol port method `createAndOpen` on `PersonalAgentOpportunityPort`
- `PersonalAgentMatch.ref` discriminated union; update every reader
- `readSignalMatches`: union of pending candidates + open opportunities, still oldest-first so the prompt's numbering contract holds
- `runKickoff`: resolve ref → `negotiations.invoke`
- `compensateFailedOpen`: handle created-but-not-opened

### Phase 1 — Purge (#2–#6) + DB migration + protocol major

Key files: `opportunity.controller.ts`, `opportunity.service.ts`, `opportunity.graph.modes.ts`, `opportunity.graph.persist-node.ts`, `opportunity.lifecycle.ts`, `opportunity.utils.ts`, `radar/radar.graph.ts`, `packages/protocol/src/internal/maintenance/`, `main.ts`, `intent.event.ts`, web `OpportunityCardInChat.tsx`, `useOpportunityActions.tsx`, notification services, CLI seeds.

### Phase 5 — Grep gate (CI)

```bash
rg -n '<banned-pattern>' packages/protocol/src services/api/src apps/web/src docs \
  --glob '!CHANGELOG.md' && exit 1 || exit 0
```

### Phase 6 — Floor lab alignment

1. Async HyDE (`addGenerateHydeJob`, parallel seats) — may already ship on `feat/floor-lab`
2. Wire floor lab to the production candidate → kickoff path

## PR sequence

| PR | Content | Deploy |
|----|---------|--------|
| **A** | Phases 2, 3, 1 + dedup delete + migration + protocol major | One deploy |
| **B** | Grep gate + floor lab alignment | After soak |

## Breaking changes

- Data migration deletes/updates introducer, latent, draft, manual, enrichment rows
- Removed REST route, graph modes, actor roles, status enum values, MCP tool references
- Background discovery no longer creates feed-visible cards before kickoff
- `PersonalAgentMatch.opportunityId` replaced by `ref`
- Protocol major bump: removed `MaintenanceGraphFactory`, `createIntroduction`, `sendOpportunity`, `approveIntroduction`, `StampNewbornOpportunitiesFn`

## Verification

| Check | Pass condition |
|-------|----------------|
| Grep gate | Zero hits for all banned tokens |
| Discovery trigger | Only intent confirm → discovery |
| Queue handler | 0 opportunity INSERTs; N candidate rows |
| PA kickoff | Candidate-only `matches_ready` → one opp + one task |
| Concurrency | Parallel kickoff on one pair → one row (`existing`/`raced`) |
| Post-bump safety | `createAndOpen` failure is compensated, never thrown |
| File names | No `*introducer*`, `*maintenance*`, `*rediscovery*` in src/tests (unless unrelated domain) |

## Open questions

- **`pending` after negotiation:** whether the `update_opportunity` `pending` transition is still needed post-negotiation. Explicitly out of scope here — opportunities are born `negotiating` either way, so this is a separate audit.
- **Edge-city skill docs:** `packages/edge-city/agentvillage/skills/` references to `discover_opportunities` — purge in this program or follow-up PR.
