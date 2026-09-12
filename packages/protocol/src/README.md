# Index Network Protocol

This package implements the Index Network protocol. Its supported consumer
import is the package root; source directories below are package-private.

`protocol/` contains portable contracts and shared protocol instructions, `platform/` contains host ports only,
`capabilities/` contains named executable behavior, and `internal/` contains all
graphs, internal model prompts, agents, retrieval, and implementation helpers. See
[`../docs/protocol-kernel.md`](../docs/protocol-kernel.md).

## Directory Structure

```
packages/protocol/src/
  protocol/         Stable, framework-free protocol concepts, rules, and shared instructions
  capabilities/     Small host-facing entry points for supported behaviors
  platform/         Host-supplied port contracts, grouped by concern
  internal/         Graphs, internal model prompts, agents, retrieval, tests, and implementation helpers
  index.ts           Curated package API only
```

The existing domain-first implementation tree now lives under `internal/`.
`Intents`, `Networks`, and `Negotiations` are executable capability modules;
consumers continue to import only from the package root. `platform/`
defines TypeScript ports for a host to implement; it contains no adapter,
controller, web, database, queue, cache, or dependency-wiring implementation.
Those belong in the consuming host.

Shared protocol instructions and their composition live in
[`protocol/protocol.prompt.ts`](./protocol/protocol.prompt.ts). See the
[consumer map](../IMPLEMENTATION.md#shared-protocol-instructions) for negotiation and
guidance callers.

Hosts provide request-context storage with `setRequestContextStore()` and log
output with `setLoggerFactory()`. The package does not implement
`AsyncLocalStorage`, console logging, or any other host runtime adapter.


## Graphs

| Graph | File | Purpose |
|-------|------|---------|
| Intent | `internal/intents/graph/intent.graph.ts` | Clarify, infer, verify felicity conditions, reconcile, and persist intents |
| Network | `internal/networks/network.graph.ts` | Manage network CRUD |
| Network Membership | `internal/networks/membership.graph.ts` | Manage network member join/leave |
| Intent Indexer | `internal/networks/indexer.graph.ts` | Assign and unassign intents to networks at the owner's request |
| Radar | `internal/opportunities/radar/radar.graph.ts` | Build the radar view: flat presenter-card list, optionally intent-scoped |

## Agents

| Agent | File | Used By |
|-------|------|---------|
| Intent Clarifier | `internal/intents/verification/intent.clarifier.ts` | Intent capability — checks specificity (entropy threshold) before persisting |
| Intent Inferrer | `internal/intents/inference/intent.inferrer.ts` | Intent graph — extracts structured intents from free text |
| Intent Verifier | `internal/intents/verification/intent.verifier.ts` | Intent graph — classifies speech act type; scores felicity conditions and semantic entropy |
| Network Recommender | `internal/networks/network.recommender.ts` | Network flows — ranks networks against a user's synthesized context |
| Opportunity Presenter | `internal/opportunities/opportunity.presenter.ts` | Radar graph, opportunity presentation — generates role-appropriate descriptions (Grice's Maxim of Relation) |

## Core Concepts

The system models human collaboration through a linguistic and information-theoretic framework. Terminology follows Speech Act Theory (Searle), Hypothetical Document Embeddings (Gao et al.), Valency theory (Hanks), and Gricean pragmatics.

| Concept | Description |
|---------|-------------|
| **User** | Session-authenticated identity with many intents and network memberships. Presentation identity lives on `users`; semantic discovery uses intents and user contexts. |
| **Intent** | A **commissive** or **directive speech act** — what the user is seeking or offering. Modelled as a Specific Indefinite: a future state uniquely satisfiable by a matching candidate. Each intent carries a **semantic entropy** score (constraint density), a **referential anchor** (Donnellan referential/attributive mode), and **felicity condition** scores (preparatory/authority and sincerity). |
| **Network** | A community scoped to a purpose. Has members with roles, an optional prompt for LLM-based evaluation, and a join policy. Discovery is network-scoped — opportunities only arise between intents that share a network. |
| **Opportunity** | A persisted intent pair admitted by protocol negotiation rules. The host receives candidate pairs from matchmaking, commits them atomically, and uses protocol lifecycle and presentation functions to serve them. |
| **HyDE** | Query-side retrieval artifacts owned by `@indexnetwork/matchmaking`. Source frames constrain generation; validation controls which documents can be persisted. Candidate retrieval searches real intent embeddings. |
| **Felicity Conditions** | Scores evaluating whether an intent is valid: **preparatory condition** (does the user have the authority/skills for this act?) and **sincerity condition** (is the commitment genuine?). Intents that fail these are classified as *misfired* or *void*. |
| **Semantic Entropy** | Constraint density of an intent (0.0 = maximally constrained, 1.0 = trivially satisfiable). High-entropy intents ("I want a job") trigger an **elaboration loop** — a request for missing constraints before persistence. |
| **Semantic Governance** | The full pipeline that ensures only actionable, felicitous, sufficiently clear intents enter the graph. Referential breadth is retained as warning metadata on the persisted signal rather than acting as a universal write prohibition. Implemented by the Intent Verifier and Intent Clarifier agents. |

## Opportunity Lifecycle and Role-Based Visibility

The package predicates are `canUserSeeOpportunity` and `isActionableForViewer` in `internal/opportunities/opportunity.utils.ts`; keep their source comments aligned with that reference when either changes.

## How a Request Flows Through the System

The host resolves the authenticated principal in a REST controller, calls its
service, and the service invokes the capability graphs.

### Post-intent matching

After protocol persists an intent, the host's `onIntentSaved` hook schedules
`@indexnetwork/matchmaking`. That independent library prepares source-grounded
retrieval artifacts and returns potential intent pairs. The API commits them
through `openCounterparties` using protocol pair identity and opening rules.
The personal agent owns subsequent negotiation behavior; protocol still owns
negotiation rules and opportunity lifecycle/presentation.

## Business Logic Flows

### Intent Lifecycle

Handled by the **Intent Graph**:
1. **Clarification** (pre-graph): `IntentClarifier` checks semantic entropy — if the utterance is underspecified (high entropy, trivially satisfiable), it returns an elaboration request rather than persisting.
2. **Inference**: `IntentInferrer` extracts structured intents (propositional content) from free text. Can produce multiple intents from a single input.
3. **Semantic Verification**: `IntentVerifier` classifies the speech act type (commissive, directive, assertive) and scores felicity conditions — preparatory (authority) and sincerity. Assigns `felicitous`, `misfired`, or `void` status.
4. **Reconciliation**: For creation, `IntentReconciler` applies Donnellan's distinction — referential intents (user has a specific target in mind) update an existing record; attributive intents (any member of a class) create a new one if sufficiently different. Explicit updates bypass that create-versus-update choice and bind the single verified candidate to the supplied active owned intent ID.
5. **Persistence**: Executor writes the intent with `semanticEntropy`, `referentialAnchor`, `speechActType`, and `felicityScores` fields.

### Matchmaking boundary

Lens inference, frame extraction, HyDE validation/cache identity, retrieval,
ranking, and explanations live in `packages/matchmaking`. Real active intent
embeddings form the candidate corpus; hypothetical documents stay on the query
side. The host implements protocol-authorized network scope and rechecks
membership and broadcast eligibility when atomically opening each pair.

## Key Invariants

- **Network-scoped discovery**: Opportunities only arise between intents sharing a network
- **Specific Indefinites only**: Underspecified (high-entropy) intents do not enter the graph — they trigger elaboration
- **Felicity-gated persistence**: Only intents classified as `felicitous` are persisted as active
- **Dual synthesis**: Each opportunity has descriptions framed for both actors (Grice's Maxim of Relation)
- **Role-based visibility**: the actors on a pairing may read it
- **Retrieval grounding**: only validated frame-v1 artifacts are cached or persisted, and all hypothetical documents stay on the query side

## Shared Infrastructure

| File | Purpose |
|------|---------|
| `internal/shared/observability/protocol.logger.ts` | Protocol-layer logging with call-scoped tracing |
| `internal/shared/agent/model.config.ts` | Centralized model and OpenRouter configuration |
| `internal/shared/agent/model-signal.ts` | Abort-signal-aware model invocation helper |
| `internal/shared/agent/scope.ts` | Derives the network scope a request may read and discover across |
| `internal/shared/assignment/network-assignment.policy.ts` | Row metadata for a manual network assignment |
| `internal/shared/network/metadata.renderer.ts` | Renders network metadata into prompt context |
| `internal/opportunities/opportunity.presentation.ts` | Pure card text generation for opportunity display |
| `internal/opportunities/opportunity.enricher.ts` | Enrich opportunity records with presentation identity data |
| `internal/opportunities/opportunity.utils.ts` | Opportunity visibility and radar composition helpers |
| `internal/opportunities/radar/radar.health.ts` | Radar health metrics computation |
| `internal/opportunities/opportunity.labels.ts` | Opportunity status and role label constants |

## Data Model

This package is adapter-free and owns **no** schema — it accesses data only through the
interfaces in `platform/`. The canonical Drizzle schema lives in the backend at
`services/api/src/schemas/database.schema.ts`.

Core tables the protocol interfaces read/write:

- **Identity**: `users` (name/bio/location), `user_socials`
- **Intents & networks**: `intents`, `networks`, `network_members`, `intent_networks`
- **Opportunities**: `opportunities`, `enrichment_tool_runs`
- **Agents**: `agents`, `apikey`
