# Protocol Atlas Design

**Date:** 2026-08-07
**Status:** Approved amended design
**Target:** `packages/protocol` graphical documentation website

## Summary

Create a dependency-free static microsite under `docs/protocol-atlas/` that explains `packages/protocol` through a chapter-based, graphical Guided Atlas. The atlas serves a mixed audience: it begins with plain-language concepts and end-to-end flows, then progressively reveals protocol-package components, relationships, source files, and public package API details.

The visual direction is a **Technical Blueprint**: dark grid surfaces, monospaced technical labels, restrained luminous accents, typed connection lines, and high-contrast inspection panels. The primary success criterion is comprehension: after a short guided tour, a newcomer should be able to explain the path from signal to scoped discovery to opportunity to consent-gated connection.

The atlas has two explicit information layers:

1. **Protocol** — the normative, storage-independent concepts and invariants.
2. **Implementation** — the current TypeScript reference implementation in `packages/protocol`, including facades, tools, graphs, agents, ports, and the requirements those ports impose on a host.

This distinction prevents historical implementation vocabulary or current rollout details from being presented as universal protocol requirements.

Within Explore, a **Configuration Lab** provides counterfactual comparisons for reviewed, non-secret behavior gates owned by `packages/protocol`. It explains how package fallback behavior changes under selected `.env` assignments without reading or claiming to represent any local, test, development, Railway, or production environment.

## Goals

- Make the protocol's components, concepts, boundaries, and major flows legible to newcomers.
- Explain normative protocol concepts before exposing implementation machinery.
- Show how the reference implementation maps product and internal vocabulary to normative terms.
- Provide five guided, step-through flows with inspectable components.
- Let technical readers search, filter, deep-link, and reveal source evidence without overwhelming the main narrative.
- Keep editorial explanations curated while generating source-derived inventory data deterministically.
- Visually explain how reviewed protocol behavior gates activate, bypass, change, or leave unresolved parts of package behavior.
- Make configuration evidence drift fail deterministically when protocol slimming moves or removes an accessor, consumer, or affected component.
- Work offline from `file://` and from any ordinary static HTTP host.
- Require no runtime service, external network request, framework, or third-party client dependency.

## Non-goals

- Catalog every source file, test, eval suite, feature flag, or public export in the first release.
- Read, embed, or infer current environment values, secrets, deployment state, or runtime telemetry.
- Treat an omitted, disabled, bypassed, or unresolved configuration path as evidence that its capability is unused or removable.
- Replace `packages/protocol/README.md`, `IMPLEMENTATION.md`, `STABILITY.md`, domain docs, or architecture gates as authoritative references.
- Execute live protocol graphs, model calls, evaluations, or database queries.
- Visualize runtime telemetry or production state.
- Resolve architectural inconsistencies as part of the website implementation.
- Present internal candidate data, evaluator reasoning, embeddings, or identifiers as participant-facing protocol concepts.
- Turn the atlas into a customer-product route or a new deployable application.
- Explain `services/api`, its controllers, services, adapters, queues, routes, persistence, or deployment architecture.
- Generate nodes or edges from outside `packages/protocol`; external hosts appear only as requirement callouts derived from protocol-owned ports and composition contracts.

## Audience and success criterion

The primary audience is mixed:

- Product and protocol readers need a coherent narrative and vocabulary.
- Protocol developers need component boundaries, runtime relationships, and source navigation.
- External integrators need the stable root-package, MCP, authorization, and injected-port boundaries.

The first release succeeds when a newcomer can follow the primary tour and explain:

```text
Participant context + Signal
  → Effective scope
  → Internal candidates
  → Evaluation
  → Opportunity
  → Optional negotiation (normatively bounded; current external-agent exception noted)
  → Participant consent
  → Connection
```

Technical navigation and architecture-drift visibility support that outcome but do not supersede it.

## Authority hierarchy

The atlas must distinguish sources by what they are authoritative about.

1. `packages/protocol/README.md` is the normative protocol model.
2. Current `packages/protocol/src/` source and architecture gates define the reference implementation.
3. `packages/protocol/src/index.ts`, `STABILITY.md`, and `architecture/exports.snapshot.json` define the supported package surface and stability tiers.
4. `docs/domain/product-language.md` defines current interactive product vocabulary.
5. Other domain and design docs provide context only where they agree with the higher-priority source and current implementation.

`services/api` and other consumers are explicitly outside the atlas's explanatory authority. The atlas may state that a host must supply a capability required by a protocol-owned port, but it must not inspect or explain how any host fulfills that requirement.

Generated implementation records must cite `packages/protocol` source paths and symbols rather than unstable line numbers. Curated content must not silently choose a side when sources disagree. A vocabulary legend or explicit gap note must make the distinction visible.

Known discrepancies that the atlas must not reproduce as fact include:

- historical synchronous-chat discovery examples versus current background-only opportunity creation;
- normative bounded negotiation versus currently uncapped external-agent-to-external-agent sessions;
- conflicting documentation about latent opportunity visibility;
- fragmented Draft/Sent/Connected versus latent/draft/negotiating/pending/accepted lifecycle names;
- Community in the normative model versus Network in current product language;
- legacy `intent`, `index`, and profile-oriented names that survive in implementation contracts.

## Experience model

### Guided Atlas

The site is a sequence of chapters rather than a freeform node canvas. A persistent left navigation shows chapter order and progress. The main panel teaches one concept or flow step at a time. Readers can select a node to open an inspector and reveal implementation details on demand.

Persistent global controls:

- Protocol / Implementation layer switch
- Search command
- Current chapter and step
- Filters when an implementation diagram is active

### Visual language

- Dark navy blueprint canvas with a subtle grid.
- Monospaced labels for component names, edge types, paths, and state.
- Sans-serif explanatory prose for readability.
- Restrained accents for component kinds and selected state.
- Solid lines for runtime invocation.
- Dashed lines for static imports.
- Dotted lines for injected ports.
- Pale labeled lines for conceptual relationships.
- Patterns and text labels accompany color so meaning never relies on color alone.
- Motion is limited to short step transitions and honors `prefers-reduced-motion`.

## Information architecture

### 00 / Orientation

Explain what the protocol is and is not. Introduce the Protocol / Implementation distinction and the three vocabularies:

- normative protocol vocabulary;
- current product vocabulary;
- historical/internal implementation vocabulary.

### 01 / Primitives

Introduce and relate:

- Participant
- Agent
- Signal
- Premise
- Context
- Community / Network
- Membership and agent permission
- Candidate
- Opportunity
- Negotiation
- Connection

The atlas must clarify that software **Agent** and the implementation's valency role `agent` are different concepts; the latter is labeled provider/helper in explanatory prose.

### 02 / Trust + Scope

Explain effective scope as the intersection of request scope, participant memberships, agent permissions, and applicable community policy. Cover attribution, privacy/minimization, incognito behavior, and the consent boundary.

### 03 / Discovery

Step through signal admission, scope resolution, HyDE and multi-strategy retrieval, evaluation, persistence admission, optional negotiation, and surfacing. Emphasize that retrieval candidates remain internal and do not become opportunities without evaluation and visibility checks.

### 04 / Consent

Explain role-aware visibility, negotiation outcomes, send/accept/decline transitions, bilateral action, and opening the participant conversation. Agent negotiation success must be labeled as a pending opportunity, never as human acceptance.

### 05 / Runtime

Show the drill-down hierarchy:

```text
Protocol entry surface
  → Runtime shell
  → Capability facade
  → Tool or graph factory
  → Graph node / structured agent
  → Domain state and schema
  → Injected port
  → Required host capability (boundary callout only)
```

Distinguish static imports from runtime and injected relationships. Show that `packages/protocol` is host-isolated. Stop at each injected boundary: describe the capability the protocol requires, but do not depict a concrete API service, adapter, queue, route, database, or deployment component.

### 06 / Explore

Provide search and filters over the generated core inventory. Results link back to the chapter and flow where a component matters, avoiding an isolated catalog experience.

Explore also contains the Configuration Lab. It remains a subsection—not an eighth chapter or sixth guided flow—so the approved teaching structure stays at exactly seven chapters and five flows.

## First-release guided flows

### A. Build trusted context

```text
Approved material
  → Identity enrichment
  → Atomic premises
  → Embedding and network assignment
  → Global and per-network context
  → Refreshed discovery representations
```

Include contact-data minimization and context freshness invariants.

### B. Express a signal

```text
Participant input
  → Infer actionable speech act
  → Verify / clarify
  → Reconcile create or refinement
  → Assign eligible networks
  → Persist
  → Enqueue background representation and discovery work
```

Explain semantic entropy, felicity conditions, and referential anchors as reference-implementation techniques, not normative protocol primitives.

### C. Discover an opportunity

```text
Persisted signal or context
  → Resolve effective scope
  → Generate internal candidates
  → Evaluate role fit and constraints
  → Recheck persistence admission
  → Negotiate when useful
  → Surface a role-appropriate opportunity
```

Show current retrieval paths—signal/HyDE, premise-to-premise, context-to-intent, and context-to-context—without asserting that all are normative requirements.

### D. Consent and connect

```text
Actionable opportunity
  → First participant sends
  → Counterparty reviews
  → Counterparty accepts or declines
  → Human conversation opens on acceptance
```

Include the introducer variant and distinguish agent negotiation from participant consent.

### E. External agent via MCP

```text
Caller credential input
  → Host-provided McpAuthResolver requirement
  → Protocol principal and capability policy
  → Authorized protocol tool registry
  → Shared invocation runtime
  → Scoped protocol capability
```

Explain that MCP is a protocol-package interoperability surface and cannot bypass effective scope or consent. The host resolver is shown only as a required contract; no concrete authentication route or host implementation is explained.

## Configuration Lab

### Purpose and safety boundary

The lab is an explanatory simulator for `packages/protocol`, not an environment viewer. Every comparison starts from the package's source-defined fallback and applies one reviewed alternative mode. The UI permanently states:

> This compares documented `packages/protocol` behavior against package fallbacks. It does not show any deployed environment and is not evidence that a capability is unused or removable.

The lab never reads `.env` files in the browser, emits active values during generation, contacts Railway, stores overrides, invokes protocol code, or performs telemetry. A host activation requirement may be shown only when it is derived from a protocol-owned port or composition contract; the atlas neither inspects nor describes concrete host wiring.

### Included configuration

The first release covers non-secret settings read under `packages/protocol` whose values change a visible protocol branch, policy, representation, admission rule, or capability requirement. Reviewed experiments are grouped around:

- discovery corpus, source selection, evaluation, and admission;
- premise deduplication and constrained HyDE representations;
- introducer eligibility;
- negotiation context, protocol version, turn policy, screening, stance, consultation, and deadlock behavior;
- Questioner uptake and its master prerequisite;
- Radar ranking adjustments.

Credentials, provider/model selection, generic retries, ordinary request timeouts, output limits, and pure throughput tuning are excluded. A concurrency setting is included only when it changes failure isolation or persisted results. Accessor-only or configured-but-unresolved settings appear with an explicit `? unresolved` result; the atlas must not invent a behavior delta or silently classify them as deprecated. A visible coverage note lists excluded and unresolved categories so omission cannot be mistaken for a safety decision.

The first-release experiment IDs, settings, and required modes are locked as follows. A mode ID denotes a reviewed bundle of exact assignments; the curated manifest supplies those assignments and explanations.

| Experiment ID | Protocol setting keys | Required mode IDs |
| --- | --- | --- |
| `discovery-corpus` | `DISCOVERY_ALLOWED_TYPES`, `DISCOVERY_PROFILE_SOURCE`, `DISCOVERY_CONTEXT_TO_INTENT` | `fallback`, `intent-only`, `premise-profile`, `context-profile`, `context-cross-match` |
| `discovery-premise-limit` | `DISCOVERY_SOURCE_PREMISE_LIMIT` | `fallback-40`, `disabled-0`, `expanded-100` |
| `discovery-rejection-cooldown` | `DISCOVERY_REJECTION_COOLDOWN_DAYS` | `fallback-7d`, `short-1d`, `long-30d` |
| `discovery-evaluation-topology` | `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` | `bundled`, `pairwise` |
| `hyde-frame-constraints` | `HYDE_FRAME_CONSTRAINTS_ENABLED` | `legacy`, `frame-v1` |
| `premise-deduplication` | `PREMISE_DEDUP_SIMILARITY` | `fallback-0.93`, `broad-0.85`, `strict-0.98` |
| `introducer-discovery` | `INTRODUCER_DISCOVERY_ENABLED` | `off`, `on` |
| `negotiation-context` | `NEGOTIATION_INCLUDE_OTHER_INTENTS` | `include-active`, `exact-only` |
| `negotiation-turn-caps` | `NEGOTIATION_MAX_TURNS_CHAT`, `NEGOTIATION_MAX_TURNS_AMBIENT` | `fallback-4-6`, `short-2-3`, `extended-8-12` |
| `negotiation-protocol` | `NEGOTIATION_PROTOCOL_VERSION` | `v1`, `v2` |
| `negotiation-screen` | `NEGOTIATION_SCREEN_MODE` | `off`, `shadow`, `enforce` |
| `negotiation-stance` | `NEGOTIATOR_STANCE` | `advocate`, `evaluator`, `skeptic` |
| `negotiation-consultation` | `NEGOTIATION_PROTOCOL_VERSION`, `NEGOTIATION_ASK_USER_ENABLED`, `NEGOTIATION_ASK_USER_WINDOW_MS`, `NEGOTIATION_CONSULTATION_POLICY_MODE` | `off`, `shadow`, `v2-on`, `v2-short-window` |
| `negotiation-deadlock` | `NEGOTIATION_PROTOCOL_VERSION`, `NEGOTIATION_DEADLOCK_SHIFT_ENABLED`, `NEGOTIATION_DEADLOCK_THRESHOLD`, `NEGOTIATOR_STANCE` | `off`, `v2-threshold-4`, `v2-fast-2`, `v2-skeptic` |
| `questioner-uptake` | `QUESTIONER_ENABLED`, `QUESTIONER_UPTAKE_ENABLED`, `QUESTIONER_UPTAKE_AUTHORITY_THRESHOLD` | `off`, `on-threshold-70`, `on-threshold-90` |
| `questioner-discovery-contract` | `QUESTIONER_ENABLED`, `QUESTIONER_DISCOVERY_ENABLED`, `QUESTIONER_DISCOVERY_INPUT_MODE` | `off`, `transcripts-unresolved`, `insights-unresolved` |
| `pool-question-contract` | `POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_VISIT_TRIGGER`, `POOL_QUESTIONS_STAMP_NEWBORN` | `off`, `shadow-mining`, `on-pull`, `on-push`, `on-visit`, `on-newborn` |
| `pool-ranking` | `POOL_QUESTIONS_RANKING` | `off`, `on` |
| `negotiation-evidence-contract` | `NEGOTIATION_EVIDENCE_QUESTIONS_MODE` | `off`, `shadow`, `on-alias` |
| `outcome-questions-contract` | `OUTCOME_QUESTIONS_MODE` | `off`, `shadow`, `on-alias` |

`questioner-discovery-contract`, the host-activation portions of `pool-question-contract`, `negotiation-evidence-contract`, and `outcome-questions-contract` may only claim unresolved or protocol-boundary effects until a direct `packages/protocol` consumer proves more. The `on-alias` modes explicitly explain when the current package resolves `on` to behavior equivalent to `shadow`.

### Experiment model

Readers choose one reviewed experiment at a time. An experiment may coordinate several interdependent keys, but offers only named, source-supported modes—no arbitrary text input and no unrestricted cross-family composition. Numeric settings use representative, validated modes rather than accepting free-form numbers. Each mode shows:

- exact non-secret assignment or `unset`;
- source-derived resolved value and package fallback;
- prerequisite settings or injected capabilities;
- affected chapters, guided steps, nodes, and edges;
- a concise behavioral explanation and protocol-only source evidence;
- caveats such as history pinning, module-load capture, or a currently unresolved consumer.

Switching experiments resets the prior experiment to its package fallback. This keeps comparisons reviewable and prevents the atlas from pretending to execute the full configuration state space.

### Curated authority and generated evidence

`atlas-content.js` is the authoritative, hand-reviewed manifest for experiment IDs, settings, named modes, assignment literals, explanations, prerequisites, delta semantics, and caveats. The generator never discovers, adds, removes, or semantically infers experiments from environment reads. It joins that curated manifest to source-derived evidence and emits a validated, normalized copy in `protocol.generated.js` for runtime use.

Each curated setting declares every package-owned read site, its entry accessor symbol, and—when accessors wrap one another—an explicit accessor closure. The closure lists only package configuration helpers reachable from the entry accessor; generation verifies every internal helper reference and then treats the first runtime reference from outside that closure as a behavior consumer. Every definitive `activated`, `bypassed`, or `changed` delta declares a package-owned consumer path and symbol plus an explicit, ordered import/reference chain from the read or accessor closure to that consumer. The generator uses the same syntax-aware module and symbol-reference machinery as the implementation inventory to verify every hop, verifies the consumer's target node/edge/step association, and fails the whole build if any definitive delta cannot be proven. Semantic meaning remains human-authored; targeted behavior tests cited by the manifest protect claims that syntax alone cannot prove.

An `unresolved` delta is deliberately consumerless. It declares package-owned read/accessor-closure evidence plus a `noDirectProtocolConsumer` assertion. Generation performs reverse-reference analysis over production modules in `packages/protocol`, excluding only the declared accessor closure, declaration-only exports, and barrels, and fails if a runtime reference escapes that closure. This makes newly wired behavior force reclassification without inventing a consumer or requiring a nonexistent behavior test.

The 20 experiment IDs and required mode IDs above are asserted exactly by content-schema tests. They cannot be auto-pruned during generation. Changing an ID, dropping an experiment, or dropping a required mode is an explicit design change, not artifact regeneration.

### Visual delta semantics

The focused diagram retains topology and overlays deterministic, non-color-only delta marks:

- `+ activated` — a reviewed path becomes eligible relative to fallback;
- `− bypassed` — a reviewed path becomes ineligible but remains visible and dimmed;
- `~ changed` — the component remains involved but its policy, representation, or routing changes;
- `? unresolved` — declared configuration intent exists, but current package evidence does not support a definitive effect.

Patterned strokes, text badges, and a textual delta list carry the same meaning. Unaffected topology remains inspectable but visually secondary. A live region announces the experiment, mode, and counts by delta kind.

### Slimming alignment

Configuration experiments are evidence-checked against the current `packages/protocol` tree. A protocol slimming change that moves or removes an accessor, key read, consumer, node, edge, or flow association makes `--check` fail until the experiment is reviewed. The lab does not consume the slimming preflight's local or deployed values and cannot authorize deletion; configured or externally reachable behavior remains governed by the slimming design's fail-closed evidence process.

## Progressive disclosure

Each primary diagram starts with plain-language concepts. Selecting a node opens an inspector containing:

- concise definition;
- role in the current step;
- relationships and dependency direction;
- relevant invariant;
- vocabulary mapping;
- component kind and capability;
- source path and symbol when in the Implementation layer;
- stability tier where the symbol is part of the public root surface.

A collapsed **Show code** area reveals source evidence and related components. The atlas shows paths and symbols, not embedded source-code bodies, keeping content current and focused.

## Static site architecture

The site uses classic scripts and static assets so relative resources load from both `file://` and HTTP.

```text
docs/protocol-atlas/
├── index.html
├── atlas.css
├── atlas-core.js
├── atlas.js
├── atlas-content.js
└── protocol.generated.js

scripts/
├── build-protocol-atlas.ts
└── tests/
    ├── build-protocol-atlas.spec.ts
    └── protocol-atlas-core.spec.ts
```

Responsibilities:

- `index.html` — semantic document shell, landmark regions, fallback content, and script/style references.
- `atlas.css` — Technical Blueprint visual system, responsive behavior, focus states, and reduced-motion rules.
- `atlas-core.js` — environment-neutral pure functions for validation, routing, search, filtering, and selection state; exposes one global namespace usable by the browser and Bun tests.
- `atlas.js` — DOM rendering and event binding for chapters, diagrams, inspectors, search, filters, and history state.
- `atlas-content.js` — hand-authored chapters, explanations, flows, invariants, vocabulary translations, and curated concept relationships.
- `protocol.generated.js` — committed deterministic inventory generated from source.
- `build-protocol-atlas.ts` — `packages/protocol`-only source scanner, normalizer, artifact writer, and check-mode validator.

## Curated data model

Curated content owns teaching order and meaning. Records use stable semantic IDs, for example:

```js
{
  id: "flow.discovery.evaluate",
  chapterId: "discovery",
  title: "Evaluate candidate fit",
  summary: "Retrieval produces candidates; evaluation admits opportunities.",
  nodeIds: ["concept.candidate", "component.opportunity-evaluator"],
  invariantIds: ["invariant.candidate-remains-private"],
  previous: "flow.discovery.retrieve",
  next: "flow.discovery.persist"
}
```

Curated flow records may reference generated component IDs. The generator validates every cross-reference before writing output.

## Generated data model

The generated artifact uses a versioned envelope:

```js
{
  schemaVersion: 2,
  nodes: [],
  edges: [],
  configurationExperiments: []
}
```

The generated inventory is intentionally core-sized. It includes selected public and architectural components, not every implementation file.

Node fields:

- stable ID;
- display label;
- kind: facade, tool family, graph factory, agent, port, runtime shell, host requirement, or public symbol;
- layer and capability;
- canonical source path and symbol;
- stability tier where applicable;
- short generated or curated summary;
- chapter and flow associations.

Edge fields:

- source ID and target ID;
- kind: `static`, `runtime`, `injected`, or `conceptual`;
- direction;
- evidence path and symbol;
- optional label.

The curated configuration manifest and its generated evidence join contain:

- stable experiment ID, title, summary, capability, and package-fallback mode;
- one or more settings with key, all package-owned read sites, entry accessor symbol, optional verified accessor closure, accepted values, and read timing;
- sorted named modes containing explicit non-secret assignments and resolved values;
- prerequisite settings or injected capabilities;
- delta targets for nodes, edges, and guided steps with `activated`, `bypassed`, `changed`, or `unresolved` effects;
- for definitive deltas: package-owned consumer path and symbol, ordered read/accessor-to-consumer reference chain, and behavior-test citation;
- for unresolved deltas: package-owned read/accessor-closure evidence and a validated `noDirectProtocolConsumer` assertion, with no invented consumer or behavior-test citation;
- caveats and coverage classification.

Compatibility and legacy directories normalize to their canonical capability. Type-only references are not presented as runtime edges. Every generated source path must remain inside `packages/protocol`; a protocol port may produce a synthetic host-requirement callout, but never a node for a concrete external implementation. The generator reuses the package's architecture metadata and module-reference semantics rather than inventing competing classification rules.

## Build and freshness contract

The generator:

- produces deterministic, sorted output;
- emits no timestamps, machine-specific paths, or volatile line numbers;
- validates duplicate IDs, record shape, edge endpoints, source paths, curated references, and the `packages/protocol` source boundary;
- validates each configuration key against a syntax-aware package source read, each accessor symbol against its file, every declared definitive reference-chain hop, each definitive consumer symbol, and every delta target against a generated node, edge, or curated step;
- validates unresolved records by proving their package-owned read/accessor evidence and absence of direct production consumers; a newly found consumer fails generation and requires reclassification;
- asserts the exact locked experiment and required-mode inventory before generation and fails rather than dropping an invalid record;
- rejects secret-shaped keys, timestamps, unrestricted assignments, and configuration evidence from outside `packages/protocol`;
- accepts no environment-derived input: generation never reads `process.env` for content, never loads `.env` files, and produces byte-identical output under differing sentinel environment values;
- rejects generated source evidence from `services/api`, applications, or other host implementations;
- supports write mode and `--check` mode;
- fails when a curated reference cannot be resolved;
- reuses the existing export inventory, capability mapping, and runtime-module-edge semantics;
- writes the artifact atomically;
- keeps generated records reviewable in Git.

`--check` generates in memory and compares with the committed artifact. A mismatch fails targeted validation and instructs the developer to regenerate it.

## Interaction behavior

### Navigation and URL state

The URL hash encodes:

- chapter;
- flow step;
- Protocol or Implementation layer;
- selected node;
- active filters;
- the selected configuration experiment and named mode.

Reload and browser back/forward restore the same view. Invalid state falls back to Orientation and shows a concise recovery notice. Configuration experiment and mode must appear as a valid pair. Selecting an experiment moves to Explore / Implementation; leaving Explore or switching to Protocol clears the comparison. General Explore filters remain stored but inactive while a focused comparison is displayed.

### Step-through flows

Previous/Next controls, chapter navigation, arrow keys where appropriate, and direct step selection all update one state model. The layer switch preserves chapter and flow position.

### Concept drill-down

Selecting a concept or component opens the inspector. On wide layouts it appears beside the diagram. On narrow layouts it stacks below and receives focus without trapping normal page navigation.

### Search and filters

Search covers concepts and generated core components. Filters include layer, capability, component kind, and edge kind. Empty results provide clear reset suggestions rather than an empty canvas.

### Source navigation

Source references display repository-relative paths and symbols with a copy-path action. The first release does not synthesize branch-specific GitHub URLs; the repository-relative path is the durable contract.

### Configuration controls

A semantic fieldset lists reviewed experiments and their named modes. Radio controls compare the selected mode with the package fallback. Focus returns to the replacement control after rendering, and Back, Forward, reload, and canonical hash normalization restore the exact comparison. A reset action returns to package fallback without clearing ordinary Explore filters.

## Responsive and accessible behavior

- Semantic headings, landmarks, buttons, lists, and disclosure controls.
- Complete keyboard navigation and visible focus indicators.
- SVG diagrams include titles and descriptions.
- Text and interactive controls meet WCAG 2.2 AA contrast targets.
- Edge meaning always has pattern and text, not color alone.
- Reduced-motion mode removes animated transitions.
- Desktop uses sidebar, canvas, and inspector columns.
- Tablet collapses the inspector to a drawer or stacked panel.
- Mobile uses chapter navigation above a horizontally safe or vertically rearranged diagram; content remains readable without precision dragging.
- A `<noscript>` fallback links to the normative README and implementation guide and explains that diagram interaction requires JavaScript.

## Failure handling

### Build time

Generation fails closed on:

- duplicate or malformed IDs;
- invalid node or edge kinds;
- unresolved edge endpoints;
- missing curated references;
- missing evidence paths;
- unsupported capability classifications;
- non-deterministic output drift in check mode.

Errors identify the record and source path without dumping generated output.

### Runtime

The atlas has no server or API failure mode. If generated data is missing or invalid:

- curated chapters remain readable;
- the technical explorer and affected code drawers are disabled;
- a concise banner explains that generated implementation data is unavailable;
- detailed validation information is logged to the developer console.

Missing source evidence is shown as unavailable; the renderer never fabricates an edge. Invalid URL state recovers to Orientation. Empty searches retain controls and offer reset actions.

A missing schema-2 configuration section leaves the ordinary atlas and explorer available and shows “Configuration Lab unavailable for this artifact.” One malformed experiment is omitted with a concise banner and console detail rather than disabling unrelated inventory. A mode with no valid reviewed deltas renders an explicit unresolved or empty state; it never invents a visual change.

## Verification strategy

### Generator and data tests

`bun test scripts/tests/build-protocol-atlas.spec.ts` covers:

- deterministic output and stable sorting;
- canonical capability normalization;
- type-only versus runtime edge classification;
- node and edge schema validation;
- duplicate and unresolved-reference failures;
- generated/curated cross-reference validation;
- check-mode stale-artifact detection;
- deterministic configuration experiment sorting and serialization;
- exact seven-chapter, five-flow, 20-experiment, and required-mode inventories;
- configuration key/read-site/accessor validation, definitive reference-chain/consumer validation, and unresolved no-consumer validation;
- failure when a consumer is removed from a definitive delta or added to an unresolved delta;
- duplicate experiment, mode, assignment, and delta failures;
- unknown node, edge, or step targets;
- rejection of host paths, credentials, timestamps, and malformed prerequisites;
- subprocess generation under differing sentinel environment values, asserting byte-identical output and absence of both sentinels.

### Interaction-core tests

`bun test scripts/tests/protocol-atlas-core.spec.ts` covers:

- URL parsing and serialization;
- invalid-state fallback;
- layer switching while preserving position;
- search ranking and empty results;
- filter composition;
- node selection and inspector state;
- graceful generated-data failure;
- configuration experiment/mode URL round-trips and invalid-pair recovery;
- experiment selection and reset transitions;
- pure delta derivation and prerequisite handling;
- filter preservation while a focused comparison is active;
- focus-restoration and announcement intents returned by pure transitions;
- malformed-experiment isolation.

Renderer DOM tests and manual browser acceptance separately verify actual focus continuity, semantic fieldsets/radio controls, live-region announcements, Back/Forward behavior, and keyboard operation.

### Targeted checks

- `bun scripts/build-protocol-atlas.ts --check`
- `bun test scripts/tests/build-protocol-atlas.spec.ts scripts/tests/protocol-atlas-core.spec.ts`
- existing protocol architecture checks affected by any reused or extracted architecture helper;
- targeted ESLint on changed TypeScript and JavaScript;
- static asset/reference validation.

### Manual browser acceptance

Verify:

1. all seven chapters and five guided flows;
2. mouse and keyboard behavior;
3. deep links, reload, and back/forward restoration;
4. Protocol / Implementation distinction;
5. search and filter behavior;
6. inspector and Show code disclosures;
7. desktop and narrow mobile layouts;
8. reduced-motion and visible-focus states;
9. loading from `file://` and a static HTTP server;
10. no console errors or external network requests;
11. Configuration Lab fallback-versus-mode comparison, reset, deep link, keyboard operation, and non-color delta cues;
12. simulator disclaimer, unresolved-state language, and absence of active environment values.

## Acceptance criteria

- The atlas contains all seven approved chapters.
- The five approved guided flows are implemented and linked to relevant concepts and components.
- Normative, product, and implementation vocabularies are explicitly translated.
- Protocol and Implementation layers are visually and semantically distinct.
- Candidate generation is never depicted as participant-facing surfacing.
- Agent negotiation is never depicted as human consent.
- The generated core inventory is deterministic, committed, freshness-checked, and sourced only from `packages/protocol`.
- External hosts are represented only by protocol-derived requirement callouts; no API component or implementation detail appears in the atlas.
- Search, filters, deep links, inspector selection, and Show code work without a server.
- Failure of generated data does not erase curated educational content.
- The Configuration Lab remains inside Explore, preserves exactly seven chapters and five flows, and works from both `file://` and static HTTP.
- Every configuration claim is backed by reviewed `packages/protocol` evidence and exposes only named non-secret assignments.
- The lab clearly distinguishes activated, bypassed, changed, and unresolved effects without removing topology or implying deprecation.
- Protocol slimming causes stale configuration evidence to fail deterministic validation rather than silently disappearing.
- The site is keyboard-accessible, responsive, reduced-motion aware, and usable without color-only cues.
- Automated targeted checks and manual browser acceptance pass.

## Implementation boundary

The implementation should remain a focused `packages/protocol` documentation feature. It may extract reusable protocol-architecture metadata or helpers where necessary, but it must not inspect or explain API implementation, refactor protocol runtime code, repair unrelated documentation contradictions, or expand into a full package catalog. When protocol behavior depends on a host, the atlas states the required port or callback contract and stops at that boundary. Any source-derived claim that cannot be classified confidently is omitted or explicitly curated rather than guessed.
