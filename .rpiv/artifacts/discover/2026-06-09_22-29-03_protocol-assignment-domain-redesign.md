---
date: 2026-06-09T22:29:03+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Protocol assignment domain redesign"
tags: [intent, frd, protocol, premises, intents, opportunities, networks]
status: ready
last_updated: 2026-06-09T22:29:03+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Protocol assignment domain redesign

## Summary
The protocol team wants a design/architecture-focused requirements baseline for finding redesign seams in how premises, profiles, intents, opportunities, and network settings relate. The settled feature concept is a unified assignment domain model: premises and intents should share network qualification semantics, profile-to-premise creation paths should share one lifecycle contract, and opportunity discovery should consume the premises/intents assigned to the network where the opportunity is found.

## Problem & Intent
Developer framing, verbatim:

> "Focus on more design and architecture."
>
> "Find redesign seams"

Initial prompt context:

> "protocol shortcomings. focus on premise-to-profile connections, premise-intent shapes, premise and intent to opportunity flows etc. Also focus on network settings and how they limit the premises and intents that are assigned to them."

The problem is not primarily a UI or prompt-tuning issue. It is that the protocol’s current domain seams make it hard to reason about which user facts and intents qualify for a network, which lifecycle creates those assigned resources, and which evidence opportunity discovery/evaluation is actually using.

## Goals
- Define a unified domain model for network-assigned resources: premises and intents should share assignment vocabulary, qualification semantics, lifecycle expectations, and explainability requirements.
- Identify redesign seams around premise-to-profile, premise-to-intent, and assigned-resource-to-opportunity flows.
- Make network `autoAssign` semantics explicit for both premises and intents, including how index prompts and member prompts participate.
- Require a single premise lifecycle contract so profile input, profile answers, enrichment, and other premise-creating paths produce equivalent analysis, embedding, network assignment, and profile regeneration outcomes.
- Require opportunity candidates to carry typed evidence bundles so premise-similarity, context-to-intent, profile, and intent matches can be evaluated and explained consistently.

## Non-Goals
- No source-code, schema, queue, graph, tool, or UI changes are made by this discover artifact.
- Do not decide exact numeric scoring thresholds in this FRD; research/design should compare the current premise and intent paths first.
- Do not make opportunity discovery scope equivalent to assignment scope. Discovery should depend on the premises and intents assigned to the network where the opportunity is found, not define assignment semantics itself.
- Do not focus on LLM prompt wording alone unless it expresses or enforces a domain invariant.

## Functional Requirements
1. The research/design output SHALL model premises and intents as network-assignable resources with a shared assignment contract.
2. The assignment contract SHALL define what `autoAssign` means for both premise assignment and intent assignment.
3. The assignment contract SHALL define how network prompt and member prompt inputs affect qualification for both premises and intents.
4. The assignment contract SHALL identify whether premise assignment should remain synchronous, move to an async seam, or otherwise align with the intent assignment lifecycle.
5. The assignment contract SHALL compare current premise, intent queue, and manual intent-index assignment behavior before recommending threshold or evaluator changes.
6. The premise lifecycle requirements SHALL state that every premise-creation path must satisfy an equivalent analyze/embed/index/profile-regeneration contract.
7. The opportunity discovery requirements SHALL state that discovery consumes resources assigned to target networks: assigned premises, assigned intents, and derived user contexts where applicable.
8. The opportunity candidate requirements SHALL define a typed evidence bundle that can represent premise, intent, profile, and context evidence without collapsing all matches into an implicit intent-like payload.
9. The redesign requirements SHALL preserve explainability: every assignment, exclusion, and opportunity candidate should be traceable to resource, network setting, score/evaluator, lifecycle path, and source evidence.
10. The downstream research SHALL cite current seams in the protocol package and backend adapter/queue/event implementations before proposing implementation phases.

## Non-Functional Requirements
- **Performance**: The redesign should not introduce broad synchronous fan-out for premise-rich users. Research should preserve the current concern that opportunity prep defers premise loading to avoid thousands of searches.
- **Security**: Network settings and scoped-agent boundaries must continue preventing cross-network leakage; any shared assignment contract must not broaden visibility or discovery beyond authorized network scope.
- **UX / Accessibility**: No direct UI/a11y requirement in this FRD. Downstream UX may be needed later for explaining assignment/exclusion decisions to operators or users.
- **Reliability**: Assignment and lifecycle behavior should be deterministic and observable across all premise and intent creation paths, including direct question-answer handlers and queue-driven intent processing.
- **Explainability**: Every assigned resource and opportunity candidate should be explainable from typed evidence rather than inferred from loosely shaped payloads.

## Constraints & Assumptions
- The protocol package must remain adapter-free; backend database/queue/event implementations are injected or structurally aligned rather than imported directly.
- Current storage has separate `premise_networks` and `intent_networks` join tables; whether to unify storage remains a research/design question, not a discover decision.
- Current assignment paths are split: premise assignment runs in `PremiseGraph.index`, intent auto-assignment runs through the intent HyDE queue, and manual intent-network assignment runs through the network indexer graph.
- Opportunity discovery should be analyzed as a consumer of assigned resources, not as the owner of assignment semantics.
- Network `autoAssign` is assumed to be the leading policy surface to clarify, because both `getUserIndexIds` and `getNetworkMemberContext` currently filter on it.

## Acceptance Criteria
- [ ] Running `test -f .rpiv/artifacts/discover/2026-06-09_22-29-03_protocol-assignment-domain-redesign.md` exits 0.
- [ ] Reading this FRD shows a `## Decisions` section with at least 8 recorded developer decisions and rationale clauses beyond `agreed`.
- [ ] Reading this FRD shows functional requirements that separately cover shared assignment contract, premise lifecycle, opportunity candidate evidence, network `autoAssign`, and explainability.
- [ ] Running `/skill:research .rpiv/artifacts/discover/2026-06-09_22-29-03_protocol-assignment-domain-redesign.md` has a concrete research topic and open question to investigate.
- [ ] A reviewer can locate cited evidence for the current seams in `packages/protocol/src/premise/premise.graph.ts`, `backend/src/queues/intent.queue.ts`, `packages/protocol/src/network/indexer/indexer.graph.ts`, `backend/src/events/handlers/question.answer.profile.ts`, and `packages/protocol/src/opportunity/opportunity.state.ts`.

## Recommended Approach
Research the protocol around a shared network-assignment contract for premises and intents, with opportunity discovery treated as a consumer of network-assigned resources. The design should specify a typed opportunity evidence bundle and one premise lifecycle contract before planning code changes.

## Decisions

### Foundational intent
**Question**: For these protocol shortcomings, what problem are you solving first and who feels the pain when premise/profile/intent/opportunity/network assignment is wrong?
**Recommended**: n/a — `intent` question
**Chosen**: "Focus on more design and architecture."
**Rationale**: Developer framed the work as architecture/design discovery rather than end-user feature implementation.

### Success outcome
**Question**: What should the design/architecture outcome make possible for the protocol team?
**Recommended**: n/a — sharpening `intent` question
**Chosen**: "Find redesign seams"
**Rationale**: Developer wants this FRD to feed research/design by exposing architectural seams, not to prescribe immediate implementation.

### Assignment versus discovery scope
**Question**: From the probe I inferred that premise assignment scope and opportunity discovery scope are intentionally different today: premise assignment uses auto-assign indexes, while opportunity discovery searches all memberships or the explicit index scope. Keep this as a redesign seam to examine, or change the feature toward unifying them?
**Recommended**: Keep this as an architectural seam to investigate.
**Chosen**: "They are kind of irrelevant. Premise assignment should maybe align with intent assignment, not opportunity discovery. Opportunity discovery depends on what premises and intents are assigned to a network in which we find the opportunity."
**Rationale**: Correction accepted. Assignment semantics belong with premise/intent network assignment; opportunity discovery should consume assigned resources. Evidence: `backend/src/adapters/database.adapter.ts:1528-1541`, `packages/protocol/src/opportunity/opportunity.graph.ts:277`, `packages/protocol/src/opportunity/opportunity.graph.ts:969-976`.

### Premise and intent qualification divergence
**Question**: From the probe I inferred that premise and intent network assignment use separate evaluators and thresholds. Should the FRD treat that divergence as a design shortcoming to resolve?
**Recommended**: Yes, resolve it.
**Chosen**: Yes, resolve it.
**Rationale**: Premises assign with `PremiseIndexer` and `score >= 0.5`, while evaluated intent assignment uses `QUALIFICATION_THRESHOLD = 0.7`, and queue-based intent auto-assignment has different behavior. Evidence: `packages/protocol/src/premise/premise.graph.ts:145-168`, `packages/protocol/src/network/indexer/indexer.graph.ts:18-19`, `packages/protocol/src/network/indexer/indexer.graph.ts:166-185`, `backend/src/queues/intent.queue.ts:222-243`.

### Profile-to-premise source of truth
**Question**: From the probe I inferred that profile source-of-truth is split: profile input can decompose through PremiseGraph, while profile question answers create premises directly and emit events. Should that be in scope?
**Recommended**: Yes, in scope.
**Chosen**: Yes, in scope.
**Rationale**: Direct premise creation from profile answers can bypass the same graph lifecycle that analyzes, embeds, indexes, and records assignment outcomes. Evidence: `backend/src/events/handlers/question.answer.profile.ts:70-84`, `packages/protocol/src/profile/profile.graph.ts:727-843`, `packages/protocol/src/premise/premise.graph.ts:145-168`.

### Opportunity candidate/evaluator contract
**Question**: From the probe I inferred that opportunity discovery accepts premise/context/intent candidates, but evaluation and persistence still look mostly user/profile/intent-shaped. Should the FRD require a clearer candidate/evaluator contract?
**Recommended**: Yes, clarify.
**Chosen**: Yes, clarify.
**Rationale**: Candidate state supports `candidateIntentId`, `candidatePremiseId`, `candidatePayload`, and `discoverySource`, but downstream evaluation needs an explicit evidence contract rather than implicit payload interpretation. Evidence: `packages/protocol/src/opportunity/opportunity.state.ts:43-60`, `packages/protocol/src/opportunity/opportunity.graph.ts:1467-1471`.

### Redesign anchor
**Question**: Which architectural seam should the later redesign anchor on for aligning premises and intents with network settings?
**Recommended**: Shared assignment contract.
**Chosen**: Shared assignment contract.
**Rationale**: This optimizes consistent network qualification semantics for premises and intents, while acknowledging refactor cost across premise graph, intent queue, and intent-index graph. Evidence: `packages/protocol/src/premise/premise.graph.ts:145-168`, `backend/src/queues/intent.queue.ts:185-243`, `packages/protocol/src/network/indexer/indexer.graph.ts:43-86`.

### Primary goal
**Question**: What is the primary goal this FRD should express for the redesign research?
**Recommended**: Unified domain model.
**Chosen**: Unified domain model.
**Rationale**: A shared vocabulary for assignable resources, network qualification, scoped assignment, assigned-resource discovery, and lifecycle invariants best matches the developer’s architecture-focused intent.

### Non-goal clarification
**Question**: What should this FRD explicitly keep out of scope so research stays on architecture rather than implementation cleanup?
**Recommended**: No source edits.
**Chosen**: No explicit option selected.
**Rationale**: Treat as no additional developer-selected non-goal beyond the skill boundary; this FRD still records that discover produces requirements only and exact thresholds remain open.

### Network setting semantics
**Question**: Which network setting semantics most need to be specified in the FRD?
**Recommended**: Auto-assign meaning.
**Chosen**: Auto-assign meaning.
**Rationale**: `autoAssign` is the observed gate in current user index lookup and member context lookup; research should define what it means for both premises and intents. Evidence: `backend/src/adapters/database.adapter.ts:1528-1541`, `backend/src/adapters/database.adapter.ts:1635-1653`.

### Premise lifecycle invariant
**Question**: For profile-to-premise flows, what lifecycle invariant should the FRD require?
**Recommended**: One premise lifecycle.
**Chosen**: One premise lifecycle.
**Rationale**: Every premise creation path should satisfy an equivalent analyze/embed/index/profile-regeneration contract even if implementation paths remain separate. Evidence: `backend/src/events/handlers/question.answer.profile.ts:70-84`, `packages/protocol/src/premise/premise.graph.ts:145-168`.

### Candidate evidence shape
**Question**: How explicit should the opportunity candidate/evaluator contract become in the requirements?
**Recommended**: Typed evidence bundle.
**Chosen**: Typed evidence bundle.
**Rationale**: Typed evidence optimizes evaluator clarity and explainability across premise, intent, profile, and context matches. Evidence: `packages/protocol/src/opportunity/opportunity.state.ts:43-60`.

### Discover acceptance
**Question**: What should count as acceptance for the discover FRD before it chains into research?
**Recommended**: Research-ready seams.
**Chosen**: Research-ready seams.
**Rationale**: The next useful artifact is research grounded in concrete architectural seams, cited evidence, decisions, and an explicit research command.

### Primary non-functional requirement
**Question**: Which non-functional requirement matters most for the redesign?
**Recommended**: Explainability.
**Chosen**: Explainability.
**Rationale**: The domain model should make assignments, exclusions, and opportunity candidates inspectable from resources, network settings, scores, and lifecycle paths.

### Deferred threshold decision
**Question**: Which area should remain explicitly open for research rather than decided in this FRD?
**Recommended**: Exact thresholds.
**Chosen**: Exact thresholds.
**Rationale**: Numeric threshold choices should follow evidence from current premise and intent assignment behavior rather than be decided during discover.

## Open Questions
- What exact threshold and score-combination semantics should shared premise/intent network assignment use after research compares current premise, intent queue, and manual intent-index behavior?

## Suggested Follow-ups
- Research whether storage should remain separate (`premise_networks`, `intent_networks`) or move toward a shared assignment representation; current schema uses separate join tables (`backend/src/schemas/database.schema.ts:345-353`, `backend/src/schemas/database.schema.ts:637-645`).
- Research whether premise assignment should remain synchronous in `PremiseGraph.index` or move closer to the async intent assignment seam (`packages/protocol/src/premise/premise.graph.ts:145-168`, `backend/src/queues/intent.queue.ts:185-243`).
- Research how network-scoped agent constraints should clamp premise assignment, since the current correction focused on premise/intent alignment rather than scoped-agent implementation details.

## References
- User input: `protocol shortcomings. focus on premise-to-profile connections, premise-intent shapes, premise and intent to opportunity flows etc. Also focus on network settings and how they limit the premises and intents that are assigned to them.`
- `packages/protocol/src/opportunity/opportunity.state.ts`
- `packages/protocol/src/opportunity/opportunity.graph.ts`
- `packages/protocol/src/premise/premise.graph.ts`
- `packages/protocol/src/network/indexer/indexer.graph.ts`
- `packages/protocol/src/profile/profile.graph.ts`
- `backend/src/queues/intent.queue.ts`
- `backend/src/events/handlers/question.answer.profile.ts`
- `backend/src/adapters/database.adapter.ts`
