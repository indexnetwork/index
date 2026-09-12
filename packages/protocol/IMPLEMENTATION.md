# @indexnetwork/protocol Implementation Guide

This guide covers the technical package surface for implementers embedding the canonical Index Network Protocol implementation. For the public protocol overview, see [README.md](./README.md).


## Stability & versioning

This package follows [Semantic Versioning](https://semver.org/). The **only**
supported entry point is the package root (`import { ... } from "@indexnetwork/protocol"`);
deep imports are not part of the contract. Every symbol is re-exported explicitly from
`src/index.ts` and tagged with a stability tier:

- **Stable** — interfaces, graph factories, agents, and shared schemas.
  Breaking changes require a major bump.
- **Experimental** (`@experimental`) — advanced graph-state types and internal
  helpers; may change in a minor release.

See [STABILITY.md](./STABILITY.md) for the full policy and the deprecation path,
and [CHANGELOG.md](./CHANGELOG.md) for release history.

Private source under `src/internal/` is domain-first: `agents`, `networks`,
`opportunities`, with `shared` for cross-cutting model and scope
helpers. The `intents` capability is
organized by function behind a single exported class, `Intents`: files sit flat
and named for what they do, with `graph/` the one multi-file stage
that keep a directory.

`Negotiations` is the autonomous participation capability. It observes current
state and returns protocol guidance, available actions, and block reasons. Its
execute path passes a pure protocol decision function into the host's transaction:
the host locks current membership, intent, and negotiation state, evaluates the
function, and atomically applies the turn and opportunity transition.
`openCounterparties` likewise receives the protocol's opening decision callback.
The protocol enforces 12 total turns, leaving exhausted matches undecided, and
A2A agreement only advances to pending owner review. `NegotiationContextDatabase`
continues to provide scoped turn logs for opportunity presentation.

Personal-agent reasoning and H2A communication live in the independent
`@indexnetwork/agent` package. The API imports both libraries and supplies
persistence, principal context, models, and events. The scenario TUI uses the same
protocol capability with memory storage. Neither library imports the other.

## Boundary model

The package is migrating incrementally to a protocol kernel. `protocol/`
contains portable, framework-free contracts and shared protocol instructions; `platform/` contains host-facing
ports and supported runtime hooks; and `capabilities/` exposes small named
behavior surfaces. Graphs, internal model prompts, retrieval, and agent helpers remain
private implementation. These are source boundaries only: import supported
symbols from `@indexnetwork/protocol`, not source subpaths. See
[docs/protocol-kernel.md](./docs/protocol-kernel.md) for migration status.

## Shared protocol instructions

[`src/protocol/protocol.prompt.ts`](./src/protocol/protocol.prompt.ts) owns shared
protocol instruction text in named constants. The module depends only
on the negotiation limits, with no models, hosts, environment variables, or
transport implementations.

| Prompt or content | Consumer |
|---|---|
| `NEGOTIATION_GUIDANCE` | `protocol/negotiation.rules.ts`: `observeNegotiation` returns it to negotiation hosts; also the canonical `negotiations` topic |
| `CANONICAL_GUIDANCE_SUMMARY`, `CANONICAL_GUIDANCE_TOPICS`, `CANONICAL_GUIDANCE_TOPICS_CONTENT` | The host's `GET /api/docs`: summary, topic metadata, and canonical sections |

The host picks the topic and shapes the response.
`negotiation.rules.ts` keeps validation and transitions. Guidance and enforcement
share limits from
[`src/protocol/negotiation.constants.ts`](./src/protocol/negotiation.constants.ts).
Internal model prompts and personal-agent prompt composition stay with their
existing owners.

These paths describe internal ownership, not new public APIs. The package root
continues to export `NEGOTIATION_GUIDANCE`, `NEGOTIATION_MAX_TURNS`, and
`NEGOTIATION_MESSAGE_LIMIT` directly from their owning modules.


## Install

```bash
npm install @indexnetwork/protocol
```

## Setup

### 1. Configure the LLM

The package reads `OPENROUTER_API_KEY` (required), `CHAT_MODEL`, and `CHAT_REASONING_EFFORT` from environment variables. No startup call is needed.

Environment variables are the supported way to configure models. `CHAT_MODEL` and `CHAT_REASONING_EFFORT` (`minimal | low | medium | high | xhigh`) drive the default model; every protocol agent — evaluators, generators, miners — reads `OPENROUTER_API_KEY` from the environment.

Programmatic model override is not part of the public contract — use the environment variables. If you need a typed override path, open an issue rather than reaching through a deep import.

### 2. Implement the adapters

The package defines interfaces — your application provides the concrete implementations.

**Required** (always needed by the graphs):

| Interface | Responsibility |
|---|---|
| `CompositeDatabase` | Core data access (users, intents, networks, opportunities) |
| `UserDatabase` / `SystemDatabase` | Context-bound databases built by `createUserDatabase` / `createSystemDatabase` |
| `Embedder` | Vector embeddings for semantic search |
| `Scraper` | Web content extraction |
| `Cache` / `OpportunityCache` | Presentation/result caching |
| `IntentFollowUp` | Lifecycle follow-up (`scoreIntent`, `onIntentSaved`, `onIntentArchived`, `onIntentResumed`) |
| `ProfileEnricher` | Enrich profiles from external sources |
| `NegotiationDatabase` | Current negotiation state and atomic commit with the supplied protocol decision function |
| `NegotiationContextDatabase` | Read-only negotiation turn log, for opportunity presentation (folded into `CompositeDatabase`) |

**Optional** (enable specific capabilities; omit to run without that feature):

| Interface | Responsibility |
|---|---|
| `AgentDatabase` | Agent registry CRUD (agents, permissions) |

All interfaces are exported from the package root — import them with `import type { ... } from "@indexnetwork/protocol"`.

### 3. Compile the graphs

Intent/network graph factories take the adapters above and return compiled LangGraphs.
Opportunity read and lifecycle operations are plain async functions. Optional capabilities default to a
degraded-but-functional mode when omitted.

## Graphs

A `*GraphFactory` class is exported for each workflow:

```typescript
import {
  RadarGraphFactory,
} from "@indexnetwork/protocol";
```

Each factory takes its typed dependencies in the constructor and exposes a
`.createGraph()` method that returns a compiled LangGraph ready for `.invoke()`.

The intent and community graphs are the exceptions: they are reached through the
`Intents` and `Networks` module classes rather than factories of their own (see
[Intents](#intents) and [Networks](#networks) below).

| Factory | Workflow |
|---|---|
| `RadarGraphFactory` | Build the radar view: flat presenter-card list, optionally intent-scoped |

## Post-intent discovery

`@indexnetwork/discovery` owns lens inference, source-frame extraction, HyDE
preparation/validation, candidate retrieval, ranking, and explanations. It has
no protocol, agent, or LangChain dependency. The API supplies its model,
embedding/search, artifact storage/cache, cancellation, and tracing ports.

`Discovery.discover()` returns potential intent pairs with network, intent,
user, score, reasoning, and evidence. The host assigns `pairKeyOf(...)` and calls
`openCounterparties(pairs, decideNegotiationOpening)`; protocol opening rules run
inside the existing host transaction. Network/broadcast scope remains a protocol
rule exposed through `resolveDiscoveryNetworkScope`, with context permissions
handled by `renderDiscoveryNetworkContext`.

`IntentFollowUp.onIntentSaved` schedules artifact preparation and matching;
`onIntentArchived` schedules artifact cleanup; `onIntentResumed` starts matching
again. Keep saved/archived follow-ups best-effort and preserve resume failure
compensation. `scoreIntent` remains independent metadata work.

## Intents

Signals are the protocol's base unit, and the whole capability ships as one
class. `Intents` covers the lifecycle graph, semantic verification, and payload
clarification.

```typescript
import { Intents } from "@indexnetwork/protocol";

const intents = new Intents({
  database,           // IntentGraphDatabase — required only by createGraph()
  embedder,           // EmbeddingGenerator
  followUp,           // IntentFollowUp
});
```

Every dependency is optional, so a host that only wants the model-backed
helpers can construct `new Intents()` with nothing. Collaborators are built on
first use, so an unused method costs nothing.

| Method | Purpose |
|---|---|
| `createGraph()` | Prepare and create exactly one new signal; explicitly read, update, archive, or transition existing signals. Requires `database` |
| `verifyIntent(content, profileContext)` | Felicity conditions, speech-act classification, semantic entropy, specificity |
| `clarify({ payload, answers? })` | Fold answers into the draft, then return `ready` with metadata or `needs_clarification` with feedback and questions; model failures throw for retry |
| `scoreIntent(content, profileContext?)` | Measure saved text without admission filters; a negative verdict still returns metadata |
| `Intents.normalizeDescription(description)` | Normalize an explicit update description; creation preserves text verbatim |

Creation with `inputContent` prepares the description once and persists that exact
text in a new record, even if a similar signal exists. Guided hosts call `clarify`
until it returns `ready`, then issue their own authenticated preparation receipt
bound to the owner and admitted draft. After authenticating the receipt, pass
`preparation: { metadata }` to `createGraph().invoke()` alongside the final
`inputContent`. If the user edited the text, pass `metadata: null`: permission to
create survives revisions, but the draft's scores do not describe the edited text.
Never accept this graph input directly from an untrusted client.

No inference, admission, or reconciliation runs on prepared creation. The graph
persists first and invokes `IntentFollowUp.scoreIntent` for revised text. Hosts
must run scoring as best-effort background work, apply only metadata while the
owner and payload still match, and leave the saved record usable on negative
verdicts or failures. Authentication, nonempty text, length limits, and network
membership remain the host's responsibility.

## Networks

Communities ship the same way: one class covering the community lifecycle graph,
the membership graph, and signal↔community assignment.

```typescript
import { Networks } from "@indexnetwork/protocol";

const networks = new Networks({
  database, // community, roster, and assignment persistence
});
```

The dependency is optional; each method names what it requires, so
construction never fails.

| Method | Purpose |
|---|---|
| `createGraph()` | Compile the community lifecycle graph — create, read, update, delete. Requires `database` |
| `createMembershipGraph()` | Compile the roster graph — add, list, remove members. Requires `database` |
| `createAssignmentGraph()` | Compile signal↔community assignment — link and unlink. Requires `database` |

Assignment applies no scoring policy: a link exists because the signal's owner
asked for it, so the row is written at score 1 with `mode: manual_override`.

## The REST API and the CLI

External agents use `@indexnetwork/cli` against the host's REST API. Every
capability is a named resource — `/api/intents`, `/api/networks`,
`/api/opportunities`, `/api/negotiations`, `/api/conversations`, `/api/scrape`,
`/api/docs` — and the user's single event stream is `GET /api/events`. Ownership
and network membership checks live in the host's controllers and services.

```bash
index --api-url https://protocol.index.network docs --json
index --api-url https://protocol.index.network docs workflows --json
index --api-url https://protocol.index.network intent list --json
```

`GET /api/docs` serves canonical protocol guidance, including the resource
routes and negotiation rules. Integrations read that guidance before writing.
Negotiation observation and turns use `/api/negotiations`; personal-agent
conversations require an intent scope and the current question ID when answering
a pending question.

## Publishing

Publishing is handled via CI:

```bash
# dev pushes publish an rc prerelease
git push <remote> dev

# main pushes publish the stable release if the package version is new
git push <remote> main
```

`dev` publishes prerelease versions derived from `package.json` using npm's `rc` tag, for example `3.6.3-rc.123.1`. `main` publishes the base version from `package.json` to `latest` only when that version is not already on npm.

Or publish manually from `packages/protocol/`:

```bash
npm publish --access public
```
