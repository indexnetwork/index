---
date: 2026-06-09T22:56:27+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Protocol assignment domain redesign"
tags: [research, codebase, protocol, premises, intents, opportunities, networks]
status: ready
last_updated: 2026-06-09T22:56:27+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Protocol assignment domain redesign

## Research Question
Research the protocol around a shared network-assignment contract for premises and intents, with opportunity discovery treated as a consumer of network-assigned resources. The design should specify a typed opportunity evidence bundle and one premise lifecycle contract before planning code changes.

Chained from discover artifact: `.rpiv/artifacts/discover/2026-06-09_22-29-03_protocol-assignment-domain-redesign.md`.

## Summary
Current assignment behavior is split across three live paths: premise auto-assignment runs synchronously in `PremiseGraph.index`, intent auto-assignment runs asynchronously in the intent HyDE queue, and explicit/manual intent-network assignment runs through `IntentNetworkGraphFactory`. These paths share policy lookup methods (`getUserIndexIds`, `getNetworkMemberContext`) and similar join-table storage, but they diverge on thresholds, score aggregation, no-prompt behavior, failure behavior, and what `autoAssign` means. Opportunity discovery is already mostly a consumer of assigned resources via `premise_networks`, `intent_networks`, and `user_contexts`, but its evaluator boundary collapses typed evidence before scoring. The strongest design seam is therefore a shared domain contract for assignable resources and evidence, not a change to opportunity discovery scope itself.

## Detailed Findings

### Assignment lifecycle divergence
- Premise creation/update graph edges enforce a synchronous lifecycle: analyze → embed → persist → index → END (`packages/protocol/src/premise/premise.graph.ts:203-206`).
- Premise indexing uses auto-assign networks from `getUserIndexIds`, fetches network/member prompt context, computes `Math.max(indexScore, memberScore)`, and assigns only when `score >= 0.5` (`packages/protocol/src/premise/premise.graph.ts:148-171`).
- Intent auto-assignment is queue-driven inside `handleGenerateHyde`: it loads eligible networks, optionally clamps by `networkScopeId`, assigns no-prompt indexes with score `1.0`, scores prompted indexes, and assigns every scored network without a threshold (`backend/src/queues/intent.queue.ts:196-265`).
- Queue-driven intent scoring uses `0.6 * indexScore + 0.4 * memberScore` when both prompts exist; null/failed indexer outcomes become score `1.0` (`backend/src/queues/intent.queue.ts:242-250`).
- Manual/evaluated intent assignment uses `QUALIFICATION_THRESHOLD = 0.7`, requires strict `>` comparisons, and when both prompts exist requires both scores to pass independently before using a weighted final score (`packages/protocol/src/network/indexer/indexer.graph.ts:19`, `packages/protocol/src/network/indexer/indexer.graph.ts:171-185`).
- The same `intent_networks` row can therefore mean manual assignment, no-prompt auto assignment, failed-indexer fallback, queue-weighted assignment, or evaluated strict qualification; storage records only `relevancyScore` (`backend/src/schemas/database.schema.ts:637-644`).

### Network policy and `autoAssign` are overloaded
- `networkMembers.autoAssign` is a per-membership boolean with default `false` (`backend/src/schemas/database.schema.ts:591-598`).
- `getUserIndexIds` treats `autoAssign=true` as automatic assignment eligibility and returns only those networks (`backend/src/adapters/database.adapter.ts:1528-1543`).
- `getNetworkMemberContext` also filters by `autoAssign=true`, so the same flag gates access to `indexPrompt` and `memberPrompt` (`backend/src/adapters/database.adapter.ts:1635-1654`).
- `networks.prompt` maps to `indexPrompt`, and `networkMembers.prompt` maps to `memberPrompt` in `getNetworkMemberContext` (`backend/src/adapters/database.adapter.ts:1639-1641`).
- Missing context is interpreted differently: premise indexing treats it as no member prompt while still requiring `network.prompt` (`packages/protocol/src/premise/premise.graph.ts:153-166`); intent queue treats it as no prompts and assigns `1.0` (`backend/src/queues/intent.queue.ts:214-226`); intent-network graph treats it as “auto-assign, no prompts” and assigns `1.0` after separate membership checks (`packages/protocol/src/network/indexer/indexer.graph.ts:99-107`).
- Developer checkpoint resolved that `autoAssign` semantics should remain open for design because current code uses it for both filtration and prompt-context access.

### Storage and explainability seam
- Premise assignment storage is `premise_networks(premise_id, network_id, relevancy_score, created_at)` with composite primary key (`backend/src/schemas/database.schema.ts:345-352`).
- Intent assignment storage is `intent_networks(intent_id, network_id, relevancy_score, created_at)` with the same structural pattern (`backend/src/schemas/database.schema.ts:637-644`).
- `assignPremiseToNetwork` requires a numeric score and upserts only `relevancyScore` (`backend/src/adapters/database.adapter.ts:4079-4090`).
- `assignIntentToNetwork` accepts an optional score/null and upserts only `relevancyScore` (`backend/src/adapters/database.adapter.ts:1670-1676`).
- Readback methods expose only network ID and score for premise and intent assignments (`backend/src/adapters/database.adapter.ts:4093-4104`, `backend/src/adapters/database.adapter.ts:1679-1690`).
- No storage/API surface records assignment source, evaluator, prompt inputs, raw index/member scores, threshold used, failure fallback, or reasoning; explainability is mostly transient in graph state/logs.

### Premise lifecycle split
- Profile input can route through `ProfileGraph.decomposePremises` when a premise graph is injected (`packages/protocol/src/profile/profile.graph.ts:861-869`).
- `decomposePremisesNode` invokes `PremiseDecomposer`, then invokes the compiled premise graph with `{ operationMode: 'create' }` for every decomposed premise (`packages/protocol/src/profile/profile.graph.ts:748-782`).
- That path runs the full premise lifecycle: `PremiseAnalyzer`, embedding, persistence with analysis, and `PremiseIndexer` network assignment (`packages/protocol/src/premise/premise.graph.ts:47-179`).
- Profile graph then routes to aggregate profile regeneration inline after decomposition (`packages/protocol/src/profile/profile.graph.ts:805-810`, `packages/protocol/src/profile/profile.graph.ts:920-983`).
- Profile question answers use `createPremiseFromAnswerFactory`, build one assertion string, embed directly, call `createPremise`, and emit `PremiseEvents.onCreated` (`backend/src/events/handlers/question.answer.profile.ts:36-90`).
- Production wiring maps that direct factory to `chatDatabaseAdapter.createPremise`, `embedderAdapter.generate`, and `PremiseEvents.onCreated` (`backend/src/main.ts:184-190`).
- Direct answer premises store no `analysis` unless supplied externally; the adapter writes `analysis: input.analysis ?? null` (`backend/src/adapters/database.adapter.ts:3906-3917`).
- Direct answer creation triggers profile regeneration via event/queue, but it does not run `PremiseAnalyzer` or `PremiseIndexer`, so it satisfies embed/persist/profile-regeneration but not analyze/index (`backend/src/main.ts:153-156`, `backend/src/queues/premise.queue.ts:375-405`).

### Opportunity discovery consumes assigned resources
- Opportunity prep intentionally uses `getNetworkMemberships` rather than `getUserIndexIds` because the latter is auto-assign-specific and intended for assignment (`packages/protocol/src/opportunity/opportunity.graph.ts:291-293`).
- Scope then narrows target networks by explicit `networkId`, `indexScope ∩ memberships`, or all memberships (`packages/protocol/src/opportunity/opportunity.graph.ts:375-403`).
- Premise discovery loads source premises assigned to target networks via optional `getPremisesForUserInNetworks`, falling back only for older/test adapters (`packages/protocol/src/opportunity/opportunity.graph.ts:969-971`, `packages/protocol/src/shared/interfaces/database.interface.ts:1459-1464`).
- Backend `getPremisesForUserInNetworks` joins `premises` to `premise_networks`, filters `pn.network_id` to target networks, requires embedded/non-deleted premises, and orders by assignment relevancy and recency (`backend/src/adapters/database.adapter.ts:5409-5440`).
- Premise similarity search joins candidate premises to `premise_networks`, filters candidate network IDs, excludes the discoverer, and returns source/candidate premise IDs plus similarity (`backend/src/adapters/database.adapter.ts:5532-5592`).
- Intent HyDE search relies on `intent_networks` scope in the embedder adapter, and raw context-to-intent search joins intents to `intent_networks` (`backend/src/adapters/embedder.adapter.ts:237-269`, `backend/src/adapters/database.adapter.ts:4248-4257`).
- User contexts are network-scoped resources with one row per user/network, and opportunity prep/context discovery filters them to memberships/target networks (`backend/src/schemas/database.schema.ts:357-367`, `packages/protocol/src/opportunity/opportunity.graph.ts:330-339`, `packages/protocol/src/opportunity/opportunity.graph.ts:1057-1097`).

### Opportunity evidence collapses before evaluation
- `CandidateMatch` can represent an intent, premise, network, lens, similarity, payload/summary, discovery source, and matched strategies (`packages/protocol/src/opportunity/opportunity.state.ts:43-57`).
- Premise discovery converts database matches into candidates with `candidatePremiseId`, `candidatePayload = assertionText`, `lens = 'premise_match'`, and `discoverySource = 'premise-similarity'` (`packages/protocol/src/opportunity/opportunity.graph.ts:1008-1017`).
- Context-to-intent discovery preserves candidate intent/network/similarity/lens/source, but does not preserve the originating context ID or context text (`packages/protocol/src/opportunity/opportunity.graph.ts:1059-1108`).
- Batched premise search returns `sourcePremiseId`, but `runPremiseDiscovery` does not copy it into `CandidateMatch` (`packages/protocol/src/shared/interfaces/database.interface.ts:1487-1495`, `packages/protocol/src/opportunity/opportunity.graph.ts:1008-1017`).
- `mergeStrategyCandidates` tracks `matchedStrategies`, but later evaluator construction does not pass `matchedStrategies` or `discoverySource` (`packages/protocol/src/opportunity/opportunity.graph.ts:1137-1158`, `packages/protocol/src/opportunity/opportunity.graph.ts:1488-1518`).
- Evaluation deduplicates by `candidateUserId` only, so multiple matches for the same user across intents/premises/contexts/networks collapse before entity construction (`packages/protocol/src/opportunity/opportunity.graph.ts:1408-1423`).
- `EvaluatorEntity` carries user/profile, optional intents, network ID, rag score, and matchedVia, but no premise ID, source premise ID, context ID, discovery source, or evidence bundle (`packages/protocol/src/opportunity/opportunity.evaluator.ts:175-191`).
- Premise-only candidates become profile-only evaluator entities because `intents` is only included when `candidateIntentId` exists (`packages/protocol/src/opportunity/opportunity.graph.ts:1508-1512`).

## Code References
- `packages/protocol/src/premise/premise.graph.ts:47-179` — PremiseGraph analyze/embed/persist/index lifecycle.
- `packages/protocol/src/premise/premise.graph.ts:148-171` — Premise assignment uses auto-assign index IDs, prompt context, max score, and `>= 0.5` threshold.
- `packages/protocol/src/premise/premise.indexer.ts:35-39` — PremiseIndexer output shape: index score, member score, reasoning.
- `backend/src/queues/intent.queue.ts:181-343` — Intent HyDE queue performs auto-assignment, HyDE generation, and from-intent discovery enqueue.
- `backend/src/queues/intent.queue.ts:196-265` — Queue intent assignment: eligibility, scoped filter, no-prompt default, scored assignment, failure fallback.
- `packages/protocol/src/network/indexer/indexer.graph.ts:19` — Intent evaluated assignment threshold constant.
- `packages/protocol/src/network/indexer/indexer.graph.ts:84-117` — Manual/direct assignment and no-context/no-prompt default assignment.
- `packages/protocol/src/network/indexer/indexer.graph.ts:141-192` — Evaluated intent assignment using IntentIndexer and strict threshold logic.
- `packages/protocol/src/intent/intent.indexer.ts:12-17` — IntentIndexer output shape.
- `backend/src/schemas/database.schema.ts:345-352` — `premise_networks` assignment table.
- `backend/src/schemas/database.schema.ts:591-598` — `network_members` prompt and `auto_assign` membership policy fields.
- `backend/src/schemas/database.schema.ts:637-644` — `intent_networks` assignment table.
- `backend/src/adapters/database.adapter.ts:1528-1543` — `getUserIndexIds` filters by `autoAssign=true`.
- `backend/src/adapters/database.adapter.ts:1635-1654` — `getNetworkMemberContext` maps prompts and filters by `autoAssign=true`.
- `backend/src/adapters/database.adapter.ts:4079-4090` — Premise assignment upsert stores only relevancy score.
- `backend/src/adapters/database.adapter.ts:1670-1676` — Intent assignment upsert stores optional relevancy score.
- `packages/protocol/src/profile/profile.graph.ts:720-810` — Profile-input premise decomposition and premise graph invocation.
- `backend/src/events/handlers/question.answer.profile.ts:36-90` — Profile answer direct premise creation bypasses analyzer/indexer.
- `backend/src/queues/premise.queue.ts:375-405` — Premise event profile regeneration path.
- `packages/protocol/src/opportunity/opportunity.state.ts:43-57` — Discovery candidate shape.
- `packages/protocol/src/opportunity/opportunity.graph.ts:280-403` — Opportunity prep/scope treats discovery as membership-scoped consumer.
- `packages/protocol/src/opportunity/opportunity.graph.ts:959-1027` — Premise discovery consumes assigned source/candidate premises.
- `packages/protocol/src/opportunity/opportunity.graph.ts:1043-1118` — Context-to-intent discovery consumes network-scoped contexts and intent assignments.
- `packages/protocol/src/opportunity/opportunity.graph.ts:1137-1158` — Strategy merge tracks `matchedStrategies` but only on candidate objects.
- `packages/protocol/src/opportunity/opportunity.graph.ts:1408-1423` — Evaluation deduplicates candidates by user, collapsing per-resource evidence.
- `packages/protocol/src/opportunity/opportunity.graph.ts:1488-1518` — Candidate-to-evaluator entity construction drops premise/context/source evidence.
- `packages/protocol/src/opportunity/opportunity.evaluator.ts:175-191` — EvaluatorEntity lacks typed evidence fields.

## Integration Points

### Inbound References
- `packages/protocol/src/profile/profile.graph.ts:777-782` — Profile graph invokes the premise graph for decomposed profile input.
- `backend/src/events/handlers/question.answer.handler.ts:69-77` — Question answer dispatcher routes profile answers into direct premise creation.
- `backend/src/main.ts:184-190` — Production wires direct profile-answer premise creation dependencies.
- `backend/src/main.ts:153-156` — Production wires `PremiseEvents.onCreated` to profile regeneration queue.
- `backend/src/queues/intent.queue.ts:75-76` — Intent creation/update producers enqueue HyDE jobs that perform intent assignment.
- `backend/src/queues/opportunity/from-intent.queue.ts:95-104` — Intent HyDE queue passes scoped network IDs into from-intent opportunity discovery.

### Outbound Dependencies
- `packages/protocol/src/premise/premise.graph.ts:55-56` — Premise graph depends on `PremiseAnalyzer` for analysis.
- `packages/protocol/src/premise/premise.graph.ts:85` — Premise graph depends on injected embedder for embeddings.
- `packages/protocol/src/premise/premise.graph.ts:159-164` — Premise graph depends on `PremiseIndexer` for network qualification.
- `backend/src/queues/intent.queue.ts:237-250` — Intent queue depends on `IntentIndexer` but treats failures/nulls as default positive assignment.
- `packages/protocol/src/network/indexer/indexer.graph.ts:141-151` — Manual/evaluated intent graph depends on `IntentIndexer.evaluate` and rendered network context.
- `packages/protocol/src/opportunity/opportunity.graph.ts:989-1004` — Premise discovery depends on optional batched premise vector search, with fallback to per-source search.
- `packages/protocol/src/opportunity/opportunity.graph.ts:1059-1097` — Context discovery depends on context HyDE docs or raw context embedding search.

### Infrastructure Wiring
- `packages/protocol/src/shared/interfaces/database.interface.ts:1459-1495` — Protocol database interface defines assigned-premise lookup and similarity search ports.
- `packages/protocol/src/shared/interfaces/database.interface.ts:1968-2026` — Composite database picks expose premise and intent assignment methods to protocol graphs.
- `packages/protocol/src/shared/interfaces/database.interface.ts:2330-2346` — Intent network graph database pick exposes intent indexing and assignment methods.
- `backend/src/adapters/database.adapter.ts:5409-5440` — Backend adapter implements assigned source premise lookup with `premise_networks`.
- `backend/src/adapters/database.adapter.ts:5532-5592` — Backend adapter implements batched premise similarity scoped by `premise_networks.network_id`.
- `backend/src/adapters/database.adapter.ts:4248-4257` — Backend adapter implements context-to-intent search scoped by `intent_networks.network_id`.
- `backend/src/schemas/database.schema.ts:357-367` — `user_contexts` stores per-user/per-network derived context used by context-to-intent discovery.

## Architecture Insights
- The likely unifying abstraction is not “opportunity discovery scope”; it is “network assignment of a resource” with clear policy, evaluator, threshold, lifecycle, and explanation fields.
- `autoAssign` cannot safely remain a vague umbrella term in design. It currently controls automatic candidate selection and prompt-context availability, and intent paths also interpret missing context as default assignment.
- Premise and intent assignment already share enough storage/interface shape to define a common protocol-domain contract, but not enough persisted metadata to explain how a row was produced.
- The one-premise-lifecycle contract should be stated in outcomes, not necessarily a single code path: every creator must satisfy analysis, embedding, indexing/assignment, provenance, and profile/context regeneration invariants.
- Opportunity discovery already acts as a consumer of assigned resources; the more urgent opportunity seam is evidence preservation from discovery through evaluator/persistence.
- Typed evidence bundles should preserve source premise ID, candidate premise ID, candidate intent ID, source context ID, discovery source, matched strategies, payload/summary/assertion text, network ID, and similarity until evaluation/persistence decisions are made.
- Any design that changes assignment must account for the protocol/backend boundary: protocol interfaces expose narrow assignment methods, while backend adapter/schema own storage details.
- Prior changes in this area repeatedly needed follow-up fixes for adapter placement, test mocks, scope leakage, SQL binding, feature-flag gating, and fan-out caps.

## Precedents & Lessons
4 similar past change clusters analyzed.

### Precedent: Premise network assignment infrastructure
**Commit(s)**: `567e6f753d` — "feat(schema): add premises and premise_networks tables (IND-321)" (2026-05-24); `5bc4a21b10` — "feat(protocol): add premise indexer (network relevancy scoring)" (2026-05-24); `ee793ea839` — "feat(protocol): add PremiseGraphFactory with create/update/query modes" (2026-05-24)

**Blast radius**: 7 files across 3 layers
  database/ — premises + premise_networks schema/migration
  protocol/premise/ — PremiseIndexer and PremiseGraph lifecycle
  protocol/shared/ — model config touched

**Follow-up fixes**:
- `5c85d9b851` — "fix(backend): move premise methods to ChatDatabaseAdapter, simplify service" (2026-05-24) — premise CRUD landed in wrong adapter/service seam.
- `6ef3b8bc6a` — "fix: add premise graph to test mock, filter deletedAt in updatePremise" (2026-05-25) — test wiring and soft-delete filtering missed.
- `400e2d431e` — "fix(protocol): address review feedback on premise tools" (2026-05-25) — premise tool behavior needed cleanup.

**Takeaway**: Treat assignment as a first-class contract across schema, protocol interfaces, backend adapter, tests, and tool/factory wiring in one slice.

### Precedent: Profile/question answers creating premises
**Commit(s)**: `77d19dec04` — "feat(backend): implement profile-mode answer handler (premise creation)" (2026-05-25); `950b64595d` — "feat(protocol): route chat and scraping input through premises first" (2026-05-25)

**Blast radius**: 11 files across 4 layers
  backend/events/ — profile answer handler creates premises
  protocol/profile/ — profile graph routes input through premise decomposition
  protocol/premise/ — decomposer added
  protocol/tooling/ — tool factory/model config wiring

**Follow-up fixes**:
- `c0a9d76459` — "fix: guard against empty answer content in profile and intent handlers" (2026-05-25) — handler accepted empty answers.
- `c74e696327` — "fix: third-round review — conditional aggregate edge, premise dedup key, adapter corpus type" (2026-05-25) — aggregate/premise dedup semantics needed correction.
- `026b373f1e` — "fix(protocol): address review feedback on premise discovery and aggregate profile" (2026-05-25) — premise discovery/profile aggregation needed cleanup.

**Takeaway**: Do not let direct event handlers create assignment resources unless they share the same lifecycle contract as graph-driven creation.

### Precedent: Premise/context evidence added to opportunity discovery
**Commit(s)**: `76a18b9abd` — "feat(protocol): add premise-to-premise discovery path and persist tracking" (2026-05-25); `7e8d8a661a` — "feat(protocol,backend): add premise HyDE search path and wire into discovery" (2026-05-25); `52a0260082` — "feat: add context-to-intent discovery strategy to opportunity graph" (2026-05-27)

**Blast radius**: 10 files across 4 layers
  protocol/opportunity/ — graph/state added premise/context candidates
  protocol/interfaces/ — discovery database contracts expanded
  backend/adapter/ — premise/context search implemented
  backend/embedder/ — HyDE embedding path added

**Follow-up fixes**:
- `94e408d769` — "fix: wire context-to-intent discovery into all discovery paths" (2026-05-27) — new discovery strategy was not applied everywhere.
- `2ca055c09a` — "fix: gate getUserContexts call behind feature flag in prepNode" (2026-05-27) — prep path needed runtime gating.
- `cdfc78ba93` — "fix(discovery): bind network-id arrays as proper SQL arrays in premise/context discovery" (2026-05-28) — SQL network-scope binding broke.
- `a838a53e0d` — "fix(protocol): honor multi-index scope in opportunity discovery" (2026-05-29) — discovery ignored multi-network scope.
- `f13a88aef6` — "fix(protocol): cap premise discovery fan-out (#888)" (2026-06-03) — premise discovery fanned out too broadly.

**Takeaway**: New opportunity evidence sources must define scope, fan-out limits, and typed evaluator input before graph wiring.

### Precedent: Intent/network scope and qualification context
**Commit(s)**: `302a8054c1` — "feat(db): add getActiveIntentsAcrossIndexes for scope-aware reads" (2026-05-19); `b362725c6c` — "feat(protocol): inject network type context into intent indexer and opportunity evaluator" (2026-05-23); `3ebdad9246` — "feat(experiment): enforce indexScope on HyDE job for scoped agents" (2026-05-09)

**Blast radius**: 8 files across 4 layers
  backend/adapter/ — scope-aware intent reads
  backend/queue/ — HyDE job scope enforcement
  protocol/intent/ — intent indexer receives network context
  protocol/network-indexer/ — manual intent assignment context changed

**Follow-up fixes**:
- `8beea61ab9` — "fix(review): address Copilot feedback on PR #762" (2026-05-09) — scoped HyDE review cleanup.
- `98ae0fe533` — "fix(backend): scope ambient discovery to the agent's bound network" (2026-05-29) — ambient discovery could exceed bound network.
- `58145358e1` — "fix(backend): scope opportunity reads to opps wholly within the network" (2026-05-29) — opportunity reads needed stricter network containment.

**Takeaway**: Shared assignment redesign must fail closed on network scope and define `autoAssign` before changing queue/indexer behavior.

### Composite Lessons
- Contract drift is the recurring failure: schema, graph, queue, adapter, factory, and tests must change together.
- Scope bugs recur after discovery/assignment changes; clamp by network early and fail closed.
- Discovery expansions need fan-out caps and typed evidence before evaluator/persistence wiring.
- Direct premise creation paths need one lifecycle invariant, not parallel shortcuts.
- Do not choose thresholds until premise assignment, intent queue assignment, and manual indexer assignment are compared.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-09_22-29-03_protocol-assignment-domain-redesign.md` — source FRD for this research.
- `.rpiv/artifacts/designs/2026-06-09_11-18-44_protocol-package-violations.md` — prior design touching protocol interface/factory boundary issues.
- `.rpiv/artifacts/research/2026-06-09_10-42-15_protocol-package-violations.md` — prior research on protocol package contract violations.

## Developer Context
**Q (discover: Foundational intent): For these protocol shortcomings, what problem are you solving first and who feels the pain when premise/profile/intent/opportunity/network assignment is wrong?**
A: "Focus on more design and architecture."

**Q (discover: Success outcome): What should the design/architecture outcome make possible for the protocol team?**
A: "Find redesign seams"

**Q (discover: Assignment versus discovery scope): From the probe I inferred that premise assignment scope and opportunity discovery scope are intentionally different today: premise assignment uses auto-assign indexes, while opportunity discovery searches all memberships or the explicit index scope. Keep this as a redesign seam to examine, or change the feature toward unifying them?**
A: "They are kind of irrelevant. Premise assignment should maybe align with intent assignment, not opportunity discovery. Opportunity discovery depends on what premises and intents are assigned to a network in which we find the opportunity."

**Q (discover: Premise and intent qualification divergence): From the probe I inferred that premise and intent network assignment use separate evaluators and thresholds. Should the FRD treat that divergence as a design shortcoming to resolve?**
A: Yes, resolve it.

**Q (discover: Profile-to-premise source of truth): From the probe I inferred that profile source-of-truth is split: profile input can decompose through PremiseGraph, while profile question answers create premises directly and emit events. Should that be in scope?**
A: Yes, in scope.

**Q (discover: Opportunity candidate/evaluator contract): From the probe I inferred that opportunity discovery accepts premise/context/intent candidates, but evaluation and persistence still look mostly user/profile/intent-shaped. Should the FRD require a clearer candidate/evaluator contract?**
A: Yes, clarify.

**Q (discover: Redesign anchor): Which architectural seam should the later redesign anchor on for aligning premises and intents with network settings?**
A: Shared assignment contract.

**Q (discover: Primary goal): What is the primary goal this FRD should express for the redesign research?**
A: Unified domain model.

**Q (discover: Non-goal clarification): What should this FRD explicitly keep out of scope so research stays on architecture rather than implementation cleanup?**
A: No explicit option selected.

**Q (discover: Network setting semantics): Which network setting semantics most need to be specified in the FRD?**
A: Auto-assign meaning.

**Q (discover: Premise lifecycle invariant): For profile-to-premise flows, what lifecycle invariant should the FRD require?**
A: One premise lifecycle.

**Q (discover: Candidate evidence shape): How explicit should the opportunity candidate/evaluator contract become in the requirements?**
A: Typed evidence bundle.

**Q (discover: Discover acceptance): What should count as acceptance for the discover FRD before it chains into research?**
A: Research-ready seams.

**Q (discover: Primary non-functional requirement): Which non-functional requirement matters most for the redesign?**
A: Explainability.

**Q (discover: Deferred threshold decision): Which area should remain explicitly open for research rather than decided in this FRD?**
A: Exact thresholds.

**Q (`packages/protocol/src/network/indexer/indexer.graph.ts:99-107`, `backend/src/adapters/database.adapter.ts:1635-1654`): In the redesign, what should manual/evaluated intent assignment do when membership exists but `autoAssign` is disabled?**
A: Developer asked what `autoAssign` does and whether it is for skipping intent/premise filtration. This is recorded as evidence that current semantics are unclear.

**Q (`backend/src/adapters/database.adapter.ts:1528-1541`, `backend/src/adapters/database.adapter.ts:1635-1654`): Given code uses `autoAssign` for candidate network filtration and prompt-context access, how should the research doc frame `autoAssign` for design?**
A: Leave open. Current behavior is overloaded and should be designed before implementation.

**Q: Scan complete — write the doc, or adjust first?**
A: Write the doc.

## Related Research
- `.rpiv/artifacts/research/2026-06-09_10-42-15_protocol-package-violations.md`

## Open Questions
- What exact threshold and score-combination semantics should shared premise/intent network assignment use after research compares current premise, intent queue, and manual intent-index behavior?
- What should `autoAssign` mean in the new domain model: automatic assignment eligibility, prompt-context access, manual override policy, or separate policy fields?
- Should the shared assignment contract remain a protocol/domain abstraction over separate `premise_networks` and `intent_networks`, or should storage eventually move toward a shared assignment representation?
- Should premise assignment remain synchronous in `PremiseGraph.index`, move closer to an async queue seam, or support both through a shared lifecycle contract?
- What evidence fields should be persisted versus only carried through evaluator input for opportunity typed evidence bundles?
