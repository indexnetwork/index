# Changelog

All notable changes to `@indexnetwork/protocol` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
See [STABILITY.md](./STABILITY.md) for the public-contract and tier definitions.

> History before `2.0.0` was reconstructed from git and is summarized rather than
> itemized. From `2.0.0` onward, keep this file updated as part of every release
> (bump `package.json` and the `[Unreleased]` section before promoting to `main`).

## Release model

Every push to `dev` publishes `<package.json version>-rc.<run>.<attempt>` under
the npm `rc` tag; `latest` moves only when `main` is promoted, and only if that
exact version is not already on npm. **Stable releases are therefore sparse and
skip versions on purpose** — most versions only ever exist as an `rc`. `latest`
went 6.7.1 → 8.0.2 with no 7.x in between because the whole 7.x line shipped as
prereleases between the two promotions. To track every change, read `rc`; to
pin a supported release, use `latest`.

## 14.3.0 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.2.

### Changed

- Promoted `shared/hyde/` to a `discovery/` capability — 9 source files and 7
  specs. HyDE owns a graph, a generator, a lens inferrer, and a validator; that
  is discovery machinery, not shared infrastructure. It lived under `shared/`
  because two capabilities needed it, which had made `shared/` the default home
  for anything with more than one consumer.

  `discovery/index.ts` is its sole cross-capability surface, carrying the 41
  symbols that actually cross the boundary. `contexts` and `opportunities` now
  reach it through that barrel; the tool composition root keeps its direct leaf
  imports, as it is exempt by design and as a barrel import there is what caused
  the runtime cycle in 14.2.0.

- `HydeGraphFactory`, `HydeGenerator`, and `LensInferrer` are re-exported from
  the root barrel via `discovery/index.js` rather than `contexts/index.js`, and
  the `contexts` barrel no longer carries them. The exported names are
  unchanged; only the internal path moved.

- Declared the directions this makes explicit: `contexts → discovery`,
  `opportunities → discovery`, and `discovery → agents` (HyDE stamps a
  debug-metadata type onto its graph state). 25 named directions became 29.

### Note

The rest of the `shared/` rehoming was considered and rejected on evidence.
`shared/assignment/` is used by `networks` *and* `premises`, and
`shared/network/metadata.renderer` by `networks` *and* `opportunities` — so
moving either into `networks/` would create `contexts → networks` and
`opportunities → networks`, neither of which is an allowed direction. They are
in `shared/` precisely because two capabilities need them and neither owns them;
moving them would add edges to the capability graph rather than remove them.

`shared/agent/` mixes the composition root with model primitives and is a
genuine split candidate, but it has 140 importers across 15 capabilities and
`tool.factory` is the module that produced the 14.2.0 cycle. Left alone
deliberately. What remains under `shared/` — `interfaces/`, `observability/`,
`schemas/`, `utils/`, and `agent/` — spans 5 to 15 capabilities each and is
correctly neutral.

## 14.2.2 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.1.
Test layout only; no test changed meaning.

### Changed

- One `tests/` directory per capability. Six directories nested a level deeper
  (`intents/application/tests`, `opportunities/{discriminator,outcome,negotiation-evidence}/tests`,
  `questions/{domain,ports}/tests`) merged into their capability's own, taking
  the nested count from 13 to 7 and the total from 27 to 21.

  The seven that remain are all under `shared/`, which has no capability root —
  merging them would produce a single 40-file directory mixing model config,
  HyDE, schemas, and observability. One `tests/` per shared module is the
  consistent reading of the same rule there.

- Moved the two specs that sat outside any `tests/` directory
  (`opportunities/delivery-card.cache.spec.ts`, `shared/agent/model-signal.spec.ts`)
  into their module's `tests/`.

- Renamed the four `.test.ts` files to `.spec.ts`, against 211 already using
  that suffix. The runner still discovers both, so this is convention only.

### Removed

- All 12 test `tsconfig.json` files. They were **not** load-bearing: 9 of the 21
  `tests/` directories never had one, and the build, the isolated test runner,
  and `tsc` all pass without them — the build excludes tests by both
  `**/tests/**` and `**/*.spec.ts`, and Bun does not read them.

  `networks/tests/tsconfig.json` had been extending `../../tsconfig.json`, which
  resolves to `src/tsconfig.json` and does not exist — `tsc` reports TS5083 and
  silently falls back to defaults, dropping `esModuleInterop`. It had been
  broken with nothing to notice.

### Note

Colocating every spec beside its subject was considered and rejected on
evidence: only 155 of 215 specs (72%) name a single source module. The other 60
are cross-module behaviour tests — `negotiation.continuation.spec.ts`,
`introducer-gating-lifecycle.spec.ts`, `negotiation.seat-rules.spec.ts` — and
filing those next to one arbitrary module they partly exercise would be worse
than leaving them grouped.

## 14.2.1 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.0.
Directory names only.

### Changed

- Renamed capability directories so each one is named for what the code inside
  it actually says. `Intent*` appears 2,624 times in `src/` against 494 for
  `Signal*` — and roughly half of those are `AbortSignal` — while `Network*`
  appears 1,988 times against 23 for `Communit*`. Every load-bearing surface
  already used intent/network: MCP tool names (`create_intent`, `read_networks`),
  database tables (`intents`, `networks`, `intent_networks`), and exported
  symbols (`IntentGraphFactory`, `NetworkGraphDatabase`). The folders were the
  outlier.

  | before | after |
  |---|---|
  | `signals/` | `intents/` |
  | `communities/` | `networks/` |
  | `opportunity/` | `opportunities/` |
  | `negotiation/` | `negotiations/` |
  | `premise/` | `premises/` |
  | `participant-agents/` | `agents/` |
  | `participant-context/` + `context/` | `contexts/` |

  Capability directories are now uniformly plural, and each one's file prefix
  matches its folder (`intents/application/intent.graph.ts`).

- The capability identifiers in `scripts/architecture/capability-model.ts`
  follow: the 25 named directions now read `intents → questions`,
  `opportunities → negotiations`, and so on. Dead alias entries for directories
  that no longer exist were removed.

### Removed

- The six orphaned test directories, which held tests whose subjects had moved
  away in earlier phases: `intent/` (13 files), `questioner/` (6), `network/`
  (6), `contact/` (4), `agent/` (2), `integration/` (1). Each is absorbed into
  its capability's own `tests/`, along with the redundant per-directory
  `tsconfig.json` files that duplicated one already present.

## 14.2.0 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.1.0.
This is internal structure only.

### Removed

- Removed `src/capabilities/` — 24 files. Twenty-one were `*.facade.ts`
  re-export shims (several two lines long, one with a single caller) and three
  were `*.tools.port.ts` port definitions misfiled into a facade directory. The
  ports moved into their capability's `ports/`.
- Removed the nine per-capability `public/index.ts` barrels. Three of them
  (`signals`, `communities`, `opportunity`) already had zero importers.

### Changed

- **Each capability's `index.ts` is now its sole cross-capability surface.**
  What used to be three hops — `capabilities/X.facade.ts` → `X/public/index.ts`
  → `X/{domain,application,ports}` — is now one. The barrels carry the union of
  the facades they replace, so the contract is unchanged.
- The boundary rule collapses to one sentence: *a capability may reach another
  capability only through that capability's `index.ts`*. `capability-boundaries.ts`
  checks it from the import path alone; `barrelCapabilityForSourcePath` replaces
  `facadeCapabilityForSourcePath`, and `CAPABILITY_BARREL_DIRECTORIES` names the
  one directory that owns each capability's barrel.
- Replaced `architecture/tests/capability-facades.spec.ts` with
  `capability-barrels.spec.ts`, which asserts one barrel per capability, no
  `export *`, and that the facade layer does not return.

### Fixed

- Broke a runtime import cycle the barrels would otherwise have introduced.
  `shared/agent/tool.factory.ts` reached `createAgentTools` through
  `participant-agents/index.ts`, which re-exports the chat personas, which
  import the tool factory back. The composition root is exempt from the barrel
  rule precisely because it must reach everything, so it now imports the leaf
  directly. Verified: zero runtime cycles, matching `dev`.
- Moved two leaf contracts out of the capabilities that happened to host them,
  into the neutral layer both sides already depend on:
  - `opportunity/domain/opportunity.claim-safety.ts` → `shared/utils/claim-safety.ts`
    (three pure text predicates, no imports of its own). `negotiation` and
    `contacts` needed it and were pulling the whole opportunity capability.
  - `UnderspecificationTypeSchema` → `shared/schemas/underspecification.schema.ts`.
    The signals clarifier was importing the entire questions capability — LLM
    agents and tools included — to reach a three-value enum.

- `CAPABILITY_DIRECTORIES` mapped `questioner` but not `questions`, so every
  file under `src/questions/` was skipped by the capability boundary checker
  entirely. Adding the mapping surfaced six real violations that had been
  invisible: five imports reaching `questions/domain/question.schema.js`
  directly, and an undeclared `participant-agents → questions` dependency
  (`chat/` uses the question schemas). The imports now go through
  `questions/index.ts` and the direction is declared — 24 named directions
  became 25.

## 14.1.0 - 2026-08-16

### Added

- `intentQuestionDailyCap()` env accessor plus the `INTENT_QUESTION_DAILY_CAP_DEFAULT`
  (2) and `INTENT_QUESTION_DAILY_WINDOW_HOURS` (24) constants, exported from the
  questions capability. These express a per-intent budget for background
  refinement questions over a rolling 24 hours, spanning the recovery and
  pool-discovery families combined.

  Zero is a meaningful setting — it disables background refinement without
  touching `QUESTIONER_ENABLED` — so the accessor deliberately does not reuse
  `positiveIntEnv`. Configured by `QUESTIONER_INTENT_DAILY_CAP`.

## 13.2.1 - 2026-08-16

No public API change: all 441 exported symbols are byte-identical to 13.2.0, and
`src/index.ts` is untouched. This is internal structure only.

### Removed

- Removed the IND-543 outer shells — `src/public/`, `src/platform/`,
  `src/runtime/foreground/`, and `src/runtime/background/`. All four were
  declaration-only placeholders with zero inbound imports; `runtime/background`
  and `public` consisted of nothing but a header comment. The only thing
  referencing them was a spec asserting that they existed.
- Removed eight unused capability barrels (`signals/index.ts`,
  `communities/index.ts`, `contacts/index.ts`, `questions/index.ts`,
  `opportunity/index.ts`, `negotiation/index.ts`, `integrations/index.ts`,
  `participant-agents/index.ts`). Each was `export * from "./public/index.js"`
  with no importers — every real consumer already went to `public/` directly.
- Removed `src/shared/ui/`, which contained no source, only a `tests/tsconfig.json`.
- Removed the `ambient-background`, `neutral-platform`, and
  `public-compatibility` capability classifications, which existed solely to
  describe the deleted shells.

### Changed

- Resolved the tool-composition shim inversion. `tool.registry.ts` and
  `tool.factory.ts` were implemented in `runtime/foreground/composition/` and
  re-exported from `shared/agent/` through modules marked `@deprecated` — but
  all 25 importers used the deprecated path. The implementations now live at
  `shared/agent/tool.registry.ts` and `shared/agent/tool.factory.ts`, and the
  indirection is gone. `mcp.server.ts` was the one direct consumer of the old
  location and now resolves to the same single home.
- `signals/application/intent.tools.ts` is imported directly by the tool
  factory; the `runtime/foreground/signals/intent.tools.ts` pass-through
  re-export that sat between them is removed.
- Replaced `architecture/tests/runtime-shells.spec.ts` with
  `architecture/tests/package-entry.spec.ts`, which asserts the invariants that
  outlived the shells: `src/index.ts` is the sole `package.json` export, and the
  tool composition root has exactly one implementation.

## 13.2.0 - 2026-08-16

### Added

- `retired_mode` to `QuestionVoidedReasonSchema`, marking rows whose generating
  mode was removed. Written only by the one-time
  `0127_dismiss_retired_discovery_questions` migration — no runtime path emits
  it, since a retired mode produces nothing by definition. The marker makes the
  cleanup auditable and exactly reversible.

## 13.0.0 - 2026-08-13

### Removed

- **BREAKING**: removed the `discovery` and `enrichment` question modes from
  `QuestionModeSchema`. Neither had a reachable producer — the inline
  `questionGenerator.generate()` call site did not exist anywhere in the
  repository, and `EnrichmentGraphFactory` accepted a `questionerEnqueue`
  dependency it never invoked. Production confirms both stopped emitting
  (newest `discovery` row 2026-07-09, newest `enrichment` row 2026-06-15).
- **BREAKING**: removed the `QuestionGeneratorReader` port,
  `question.generator.port.ts`, `question.discovery.prompt.ts`, the
  `DiscoveryQuestionInput` composite type, and the `DiscoveryContext` /
  `ProfileContext` questioner contexts.
- **BREAKING**: removed the `questionGenerator` dependency from
  `ToolRegistryCompositionDeps` and `OpportunityToolDeps`.
- Removed the `QUESTIONER_DISCOVERY_ENABLED`, `QUESTIONER_DISCOVERY_INPUT_MODE`,
  and `QUESTIONER_DISCOVERY_TIMEOUT_MS` env accessors.
- Dropped the unused `questionerEnqueue` constructor parameter from
  `EnrichmentGraphFactory` (positional — callers passing it must drop the arg).

### Changed

- `SELF_OWNED_MODES` narrows from `["enrichment", "intent", "discovery"]` to
  `["intent"]`, which also narrows the reporter persona's
  `read_pending_questions` mode filter.
- `QUESTION_MODE_TO_DOMAIN` deliberately **retains** its `enrichment` and
  `discovery` entries. Rows created before this release remain readable and
  answerable, and dropping the mapping would fall back to the `chat` domain and
  change which permission an agent needs to answer a pre-existing row.

## 11.2.1 - 2026-08-11

### Added

- Added the guarded historical-quality runtime for single-configuration,
  dual-trigger shared-pool evaluation.

### Fixed

- Hardened historical-quality readiness with attested database credentials,
  frozen embedding requests, and fail-closed protected-base refresh gating.

## 10.2.0 - 2026-08-10

### Changed

- Refined the canonical V2 historical-quality artifact contract so execution
  completeness is independent of verdict availability: complete filtered
  case/trigger selections are valid descriptive evidence with
  `completeness.complete: true` and
  `measurement.qualityVerdictAvailable: false`; only complete full-corpus,
  full-trigger selections may publish a quality verdict. Legacy and canonical
  parser selection remain unchanged.

## 10.1.0 - 2026-08-07

### Added

- Added the independently reviewed 25-participant historical shared-pool contract, single-configuration dual-trigger pilot planner, descriptive stage-funnel metrics, and strict execution-completeness artifact schema for IND-638A.

## [Unreleased]

### Changed
- Move the opportunity-presentation review checklist into `src/opportunity/AGENTS.md` and repoint the `opportunity.safe-presentation.ts` and `discriminator.adjustments.ts` comments at it. Comment-only; no runtime change.

### Removed

- **Breaking (14.0.0):** remove the `orchestrator` chat persona. `ORCHESTRATOR_PERSONA_ID` and `ORCHESTRATOR_PERSONA` are gone from the public API, and the orchestrator system prompt (`buildSystemContent`) and its conditional prompt-module registry are deleted. `ChatPersonaLoopBehaviors.hallucinationRecovery` is retained — it is opted into by the onboarding, signal and negotiator personas, not just the removed one.
- Remove the never-emitted `question_generator_start` / `question_generator_end` stream events and the `DebugMetaDiscoveryQuestions` debug payload, which had no producer.

### Changed

- **Breaking:** `ChatGraphFactory` and `ChatAgent.create()` now require a `ChatPersonaConfig`. There is no default persona; callers name the persona they drive.
- `DebugMetaOrchestratorNegotiations` keeps its name and wire key deliberately. It is read back out of persisted message debug metadata, so renaming it would drop the negotiation pointer for every historical message. It is populated for every persona whose tools can start a negotiation, not only the persona it is named after.

### Changed

- The eval ops sign-in callback accepts only the `api_key` field (protocol
  12.1.0); the legacy `session_token` fallback name was removed together with
  the web cli-auth v1 contract.
- Keep canonical `get_enrichment_run` and `cancel_enrichment_run` in the fast
  runtime timeout class after retiring their profile-run aliases.

### Removed

- Remove the seven deprecated REST/chat `*_user_profile` and `*_profile_run`
  tool aliases. Canonical `*_user_context` and `*_enrichment_run` tools remain;
  the aliases were already absent from MCP, and current first-party clients use
  the canonical names. This is a breaking direct Tool API change and is recorded
  as protocol 12.0.0.

### Added
- Full standalone Hermes capability policy (11.2.0): the `hermes-agent` principal has an explicit six-action MCP/REST policy while the existing `hermes-negotiator` principal remains restricted to its four scheduled negotiation handlers. Both policies default deny and preserve one-shot, generation-fenced negotiation authority.

### Security
- The Hermes policy never exposes owner credentials, account-security, credential/permission/agent administration, billing, or unclassified tools; connector and owner-native callers receive only nonsecret response projections.

### Removed
- Remove six unsupported shared interface/schema forwarding shims after migrating repository consumers to capability-owned domain and port modules; stable package-root exports remain unchanged.
- Remove six unsupported tool-port forwarding shims and the deprecated unused discovery-question mapper; stable package-root exports remain unchanged.
- Remove the onboarding privacy-consent layer (10.0.0). The
  `record_onboarding_privacy_consent` tool is gone from the tool registry, the
  onboarding persona/prompt, the MCP authorization matrix and onboarding
  allowlist, and the MCP onboarding-gate instructions. `preview_user_context`
  no longer gates EdgeOS/event data on recorded consent, and staged profile
  seeds are used without an import-consent check. The
  `OnboardingPrivacyState` / `PrivacyConsentDecision` / `PrivacyConsentSource`
  types and the `onboarding.privacy` field are removed from the database
  interface; leftover `privacy` values in stored onboarding JSON are ignored.
  Major bump: removes a public tool and exported types. Enrichment opt-in/opt-out
  moves to a separate service, defined per implementation/application.
- Remove public profile lookup from `preview_user_context` (10.0.0). The
  `allowPublicLookup` parameter, the `publicLookup` identity-check block, and
  the `edgeosProfileText` pass-through parameter are gone; the preview draft is
  built only from explicit text, server-staged signup/import seeds, and
  user-provided social URLs. Public profile lookup moves to the separate
  enrichment service. `create_user_context` (legacy) and background member
  enrichment are unchanged.

### Added
- Add the Personal Agent Hermes negotiation-runtime contract (11.1.0). The public negotiation facade now exports `configuredAskUserEnabled` and `askUserAnswerWindowMs` for host-side owner-consultation admission, with regenerated consumer/export inventories. The generated Hermes negotiator skill receives a privacy-minimal structural envelope: server-provided seat, protocol version, deadlines, closed allowed actions, consultation eligibility, opportunity identifiers/status, and message-free history. Owner memory, private context, consultation text, evaluator reasoning, actor prose, and shared-message prose are excluded; each scheduled pass permits at most one response or owner consultation and treats all pickup prose as untrusted data.
- Add a live answer-first signal-intake eval with unrelated, relevant, and no-bridge profile cases plus provider-free corpus, runner, and scorer checks.
- Add the protocol-only Guided Atlas, deterministic architecture inventory
  generator, and source-evidenced Configuration Lab. The atlas explains
  normative concepts, the current `packages/protocol` reference implementation,
  and counterfactual behavior-gate changes, while live environment values and
  concrete API or host implementations remain outside its scope. Tooling-only
  public-package change; no root export or runtime behavior changes.
- Deterministic fast signal intake (#1307; 8.1.0). `SignalIntakePackGenerator`
  precomputes a per-user intake brief plus round-1 question, and
  `SignalIntakeOrchestrator` drives the funnel as a deterministic state machine
  on flash instead of sequential pro turns, with synthesis speculated during a
  deterministic community picker. New stable exports from the `signals` facade:
  `SignalIntakePackGenerator`, `normalizeIntakePack`, `SignalIntakeOrchestrator`,
  `answerLabel`, `FALLBACK_WHO_QUESTION`, `FALLBACK_BRING_QUESTION`, and the
  `IntakePack` / `IntakePackInput` / `IntakePackQuestion` /
  `IntakePackQuestionOption` / `IntakeAnswer` / `SynthesisInput` /
  `SynthesisResult` types. Minor bump: additive surface only.

### Changed
- Make fast signal-intake follow-ups answer-first with a two-stage model boundary: an answer-only core call chooses the missing axis and supplies two or three concrete domain options, then an isolated bridge call may append at most one premise-derived profile option so an existing profile theme cannot dominate or reorder a newly stated intent.
- Remove unsupported deprecated source/deep forwarding shims after migrating repository consumers to canonical modules; stable package-root exports are unchanged.
- Add a fail-closed isolated provider-free test gate (10.1.1). Tooling-only
  safety foundation; no runtime or public API behavior changes.
- For the planned 10.2.0 release, refine the canonical V2 historical-quality
  artifact contract so execution completeness is independent of verdict
  availability: complete filtered case/trigger selections are valid descriptive
  evidence with `completeness.complete: true` and
  `measurement.qualityVerdictAvailable: false`; only complete full-corpus,
  full-trigger selections may publish a quality verdict. Legacy and canonical
  parser selection remain unchanged.
- Share capability classification metadata between the existing architecture
  boundary gate and the protocol atlas generator; allowed dependency directions
  are unchanged.

### Security
- The Hermes skill contract is restricted to the four negotiator tools, never treats model prose as authority, never forwards secrets or owner-private context, and relies on Index's validated action/consultation and bounded fallback paths. **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, Developer ID hardened-runtime signing and notarization are complete, and the credential TTL/revocation checklist is verified.**

### Fixed
- Add an independent complete-payload golden digest and stronger audit/report leak
  sentinels for the historical discovery seed serializer, and clarify the H4 review
  checkpoint chronology (IND-637; 10.0.3).
- Repair the audited five-case historical evaluation corpus (IND-637; 10.0.2):
  replace H1 with the approved Ted Nierenberg → Jens Quistgaard collaboration,
  reverse H5 to the required Drew Weissman → Katalin Karikó direction, migrate
  all cases to event-relative admission boundaries, reject approved cases with
  high recognizability, and cover the exact model-safe matching and discovery
  seed serializers with provider-free tests.
- Harden the audited five-case historical evaluation corpus (IND-637; 10.0.1):
  preserve audit metadata outside direct model-safe and matching projections,
  enforce fixture-v2 participant, citation, and authored-negative provenance
  invariants, and reuse the same audited cases in the discovery matrix.
- `architecture:cycles` graphs runtime edges only (8.0.3). It counted `import
  type` / `export type` edges, which TypeScript erases, so it reported a
  7-module negotiation/questions cycle that no runtime can observe — penalizing
  the capability-facade pattern of depending on a port *type* instead of an
  implementation. Tooling only; no source or public-surface change. The full
  `architecture:check` suite now passes and runs in CI.

## [8.0.2] — 2026-07-30

Promoted to npm `latest` on 2026-07-30, carrying the whole 7.6.0 → 8.0.2 line.
Those intermediate versions were published as `-rc` prereleases from `dev`
only, so `latest` moved 6.7.1 → 8.0.2 in one step; see **Release model**
above. Entries below keep the version they were developed under.

### Added
- Configurable negotiator stance `NEGOTIATOR_STANCE` (IND-611; 7.11.0), shipped
  dark. `advocate` (default) | `evaluator` | `skeptic`, resolved by the new
  domain contract `configuredNegotiatorStance()`
  (`negotiation/domain/negotiation.stance.contracts.ts`, mirroring
  `configuredScreenMode()`); unset or unrecognized falls back to `advocate`.
  `evaluator` adds an opportunity-cost value bar, asks the agent to assess
  before advocating, and makes discovery-query satisfaction a precondition for
  continuing to evaluate rather than a mandate to connect; `skeptic` adds the
  prior that most candidate matches are not worth making and resolves a
  detected deadlock as a stalemate instead of by concessions.
  **Prompt-only** — seat vocabularies (`allowedActionsFor`), turn schemas, and
  graph routing (including the continuation-screen bypass) are identical under
  all three stances. **`advocate` renders byte-identical prompts** to 7.10.1,
  pinned by an external golden fixture in
  `negotiation/tests/negotiation.stance.spec.ts`. New live eval harness
  `bun run eval:stance` measures decline rate on low-value versus high-value
  fixtures per stance.

### Removed
- **BREAKING:** `DiscoveryRunInput` and `DiscoveryRunRecord` (8.0.0). Background-only
  opportunity matching (#1301) deleted `shared/interfaces/discovery-run.interface.ts`
  along with the discovery-run queue, adapter, and coalescing domain, so the two
  stable types are no longer part of the public surface. The major bump shipped
  with that change; this entry and the regenerated export inventory record it.

### Fixed
- Stop force-rewriting an opening-move refusal (IND-611 prerequisite; 7.11.0):
  `negotiation.graph.ts` ran the turn-0 opening force *before* the IND-564
  opening-withdraw guard, so a v2 initiator that judged a match not worth making
  had its `withdraw` rewritten to `outreach` while its reasoning survived —
  sending the counterparty an outreach that argued against the match — and made
  the guard below it dead code on turn 0. The guard now runs first: a turn-0
  refusal stands and flows into the existing quiet `screened_out` outcome with
  no message persisted, while a genuinely malformed turn-0 opening (e.g.
  `counter`) is still coerced to the opening action.
- Attribute `outcome.reasoning` to whoever actually decided (IND-611; 7.11.1):
  `screened_out` now has two routes — the screen node, and an opening-turn
  refusal. The finalize node preferred `screenDecision.reasoning` for both,
  which is wrong on the new route when the gate returned `reach_out`: the
  outcome would carry the screen's argument *for* the match as the reason the
  agent did *not* reach out (and IND-610 renders that string in the owner-only
  gate-decision card). An opening-turn refusal now reports the withdrawing
  turn's own reasoning; a genuine screen-node block is unchanged.
- Add canonical shared guidance source and unified MCP_INSTRUCTIONS/read_docs
  (IND-602/603; 7.10.0): The single normative `CANONICAL_GUIDANCE_SUMMARY`
  (1,555 chars, under the 4,500-char MCP context budget) covers Index Network
  entity model (identity/context, premises, signals, communities/networks,
  opportunities), negotiation semantics with the critical distinction
  **"A2A acceptance is not owner approval"** (separate gates), H2A/A2A
  workflows, and the boundary **"H2H (human-to-human) never exposed; escalation
  to native surfaces (web, Telegram) is outside MCP scope."** Seven detailed
  canonical topics (identity-context, premises, signals, communities-networks,
  opportunities, negotiations, workflows) are published via read_docs on both
  MCP and REST/chat surfaces. MCP surface read_docs serves canonical guidance
  only; REST/chat retains legacy supplemental topics for backwards compatibility.
  New internal shared constants (packages/protocol/src/shared/agent/canonical-guidance.ts):
  `CANONICAL_GUIDANCE_SUMMARY`, `CANONICAL_GUIDANCE_TOPICS` (const array),
  `CANONICAL_GUIDANCE_TOPICS_CONTENT` (record). Not public root protocol exports.
  MCP_INSTRUCTIONS now delegates entity/lifecycle details to read_docs, dropping
  verbose inline model. Published MCP guidance/read_docs contract now includes
  canonical seven-topic structure and H2A/A2A/owner-approval semantics. No data,
  migration, capability, permission, or runtime behavior changes.

- Add a host-injected MCP authorization-observability seam (IND-581; 7.8.0):
  `McpAuthorizationObserver`, the secret-free `McpAuthorizationDenialEvent`, and
  the central `buildMcpAuthorizationDenialEvent` constructor, plus an optional
  fifth `authorizationObserver` parameter on `createMcpServer`. Every
  `tools/call` capability denial (preliminary and resolved stages) emits one
  structured event carrying ONLY the caller profile, tool name, decision
  reason/reach, required permissions, and opaque `userId`/`agentId`/
  `networkScopeId` — never a token, API key, bearer credential, raw header, or
  tool-argument payload. The seam is fail-closed: an observer that throws is
  swallowed and never alters the denial. Denials remain freshly resolved per
  reconnect/session because the static tool-metadata cache holds
  principal-independent registration data only; the per-principal decision is
  recomputed on every fresh server resolution.

- Add the canonical `read_own_agent` MCP tool: a registered active agent's
  self-read of its OWN sanitized registration record (IND-599; 7.7.0). The input
  schema is empty — there is no target selector, so a caller can never name
  another agent — and the handler resolves strictly the authenticated
  `context.agentId` with an owner match, so a forged target argument is stripped
  by the schema and never queried. The tool is classified `agent_admin` in the
  canonical capability matrix and registered in the shared factory (`fast`
  runtime class).

### Changed
- Pin the generic MCP conversation surface to H2A-only in the published
  contract (IND-600; 7.9.0). This is a distinct public-contract release above
  the integrated 7.8.0 floor (IND-581): the `list_conversations` /
  `get_conversation` descriptions now state explicitly that they expose ONLY
  the caller's H2A chats with the Index agent (orchestrator-persona sessions
  with the system agent as a participant): human-to-human (H2H) DMs are NEVER
  exposed through these tools — including via schema-valid forged `tools/call`
  requests — and A2A negotiation conversations are reachable only through the
  negotiation tools (`list_negotiations` / `get_negotiation` /
  `respond_to_negotiation`), which retain their `manage:negotiations`
  permission, exact-participation, and bound-network-scope checks. The public
  `ChatSessionReader` port contract gains the same category rule: non-H2A
  session IDs behave exactly like nonexistent ones. Runtime enforcement is
  unchanged — the `human_only` capability classification still denies every
  non-session principal before any context DB read, scoped-deps creation, or
  chat-adapter work — so this is a published contract/description
  clarification on public tools, hence the minor bump.
- Split the `agent_admin` capability family by principal kind (IND-599; 7.7.0).
  Registered agent principals (global/network/delivery) may now see and call
  ONLY `read_own_agent` on the admin surface — `list_agents` is no longer
  visible or callable by an agent (previously it was the sole agent-visible
  admin tool), and every admin mutation remains denied (`agent_admin_denied`).
  Session/onboarding humans retain the full owned-agent administration surface
  (`register_agent`, `list_agents`, `update_agent`, `delete_agent`,
  `grant_agent_permission`, `revoke_agent_permission`) but are denied the
  agent-only `read_own_agent` with the new dedicated decision reason
  `human_read_own_agent_denied`. Enrollment-capable unregistered keys remain
  single-purpose `register_agent`-only across the entire registry, and plain
  unregistered keys remain fail-closed. The `agent_admin` decision is made
  BEFORE the session-human blanket allow, and denials fire before any context
  DB read or scoped-deps creation. Domain, informational (`read_docs`),
  permission/network-scope, and delivery capabilities for registered agents are
  unchanged. Behavior tightening on published MCP tools plus a new public tool
  name, hence the minor bump.
- Redact private transport connection material from every agent record
  projected by the participant-agent tools (IND-599; 7.7.0).
  `sanitizeAgentForOutput` now empties each transport's `config` (endpoint
  secrets, auth headers/tokens) while preserving the safe response shape
  (id/channel/priority/active/failureCount and permissions), covering
  `read_own_agent`, `register_agent`, `list_agents`, and `update_agent` outputs.
- Require explicit owner authorization for every owner-gated `update_opportunity`
  transition (send/accept/reject) at a new protocol-owned authoritative boundary
  (IND-593; 7.6.0). The `OpportunityOwnerApprovalAuthority` port is injected by
  the host: registered MCP agents must present an owner-issued, fresh, atomically
  single-use proof bound to the exact opportunity, action, owner principal, acting
  agent, and server-derived interaction — missing/stale/generic/forged/wrong-binding/
  replayed proofs fail closed with stable reasons BEFORE the mutation graph runs,
  and a proof-less agent call returns a fresh interaction challenge. The optional
  `ownerApprovalProof` field is added to the public `update_opportunity` schema.
  Non-agent calls traverse the same boundary via host attestation of typed, trusted,
  server-derived interaction/surface provenance (`OpportunityOwnerInteractionProvenance`):
  only a genuine direct authenticated owner session (REST or MCP) attests; chat/CLI/
  H2A/A2A/mediated surfaces and caller-supplied identity, binding, or provenance
  fields can never mint or attest owner authority (`untrusted_provenance`). A2A
  negotiation approvals, uptake acknowledgements, agent self-acknowledgement, and
  server advisory/challenge values are explicitly non-substitutable. System `expired`
  transitions remain ungated. Behavior tightening on a published MCP tool plus new
  public port types, hence the minor bump. No data action, migration, or deployment
  change ships with this entry.

## [7.5.0] — 2026-07-25

### Changed
- Partition async discovery-run ownership by the exact calling MCP principal, not
  only by user (IND-592). `get_discovery_run` and `cancel_discovery_run` now
  reject a run whose recorded principal (session-human vs a specific agent id)
  differs from the caller's, even within the same user, returning the opaque
  "Discovery run not found." and never attempting cancellation. `discover_opportunities`
  MCP coalescing is likewise partitioned by principal, so an agent-initiated
  request never coalesces onto — and is never handed — the owner's (or another
  agent's) in-flight run id or its status/results. The store lookup remains
  user-scoped; this is an additional in-handler/domain narrowing with no host
  interface change. Behavior tightening on published MCP tools, hence the minor bump.

## [7.4.0] — 2026-07-25

### Changed
- Make the public participant-agent permission INPUT schemas canonical-only:
  `register_agent.permissions` and `grant_agent_permission.actions` are now a
  `z.enum` of the six canonical `manage:*` actions instead of `z.array(z.string())`.
  Retired `manage:profile` / `manage:contacts` strings are rejected at the schema
  seam (the handler's `isValidAction` check is retained as defense in depth). This
  narrows the published tool input schemas exposed via `tools/list`, hence the
  minor bump. No change to the temporary stored-row compatibility projection,
  which still interprets residual legacy STORED rows.

## [7.3.0] — 2026-07-25

### Added
- Add the injected `IntentProposalStore` host boundary so web proposal cards are
  emitted only after the normalized description, optional network scope, and
  complete verifier output have been durably bound to their owner.
- Add `projectStoredPermissionActions` at the MCP capability-loading boundary:
  temporary rolling-data compatibility that interprets residual **stored** legacy
  grant rows during a mixed-version deploy (`manage:profile` →
  `manage:identity` + `manage:premises`; `manage:contacts` → no capability;
  owner/scope preserved; unknown actions fail closed). Not a public alias — legacy
  names remain rejected as input and absent from `tools/list`/docs. Removed only
  after the post-drain final sweep and compatibility gate (see the IND-609
  rollout doc).

### Changed
- **MCP permission migration (IND-606/607).** Retire issuance of the legacy
  `manage:profile` and `manage:contacts` grant actions in favor of
  `manage:identity` and `manage:premises`. Issuers, defaults, validation, and the
  capability policy emit/accept only the canonical action set; the durable data
  migration (`services/api/drizzle/0109_migrate_agent_permission_actions.sql`)
  converges existing grants (`manage:profile` → `manage:identity` + `manage:premises`;
  `manage:contacts` removed). No public protocol type changes.
- **Exact question affected-domain inheritance (IND-608).** `read_pending_questions`
  and `answer_pending_question` now enforce each question's exact affected-domain
  permission at the handler, not merely the union that admits the tool. A global
  `manage:intents` agent can no longer read or answer negotiation/enrichment/
  discovery questions it does not manage; the owning human is unaffected.
- **Corrected `QUESTION_MODE_TO_DOMAIN` mapping.** `enrichment` now maps to the
  `premises` domain (`manage:premises`), matching the enrichment answer pipeline
  that runs the PremiseGraph lifecycle. Previously mapped to `identity`. This
  changes the exported constant's `enrichment` value and the
  `read_activity_summary` projection of enrichment question counts from the
  identity domain to the premises domain — the deliberate public-constant change
  motivating this minor bump from the 7.2.0 floor.

## [7.2.0] — 2026-07-25

### Added
- Add `read_activity_summary` as the single public name for grounded,
  aggregate-only agent activity reporting (IND-605). The MCP capability matrix
  admits any caller holding at least one activity-domain permission
  (`manage:identity`/`manage:premises`/`manage:intents`/`manage:opportunities`/
  `manage:negotiations`); the handler then passes the typed resolved MCP caller
  context into one centralized permission projection, so global agents receive
  only the domains their permissions authorize while session humans receive the
  full owner view. Signal IDs/titles (`opportunitiesBySignal`) are exposed only
  with `manage:intents`, and question counts are meta-network — never network
  filtered — while each count inherits the permission of the domain the
  question affects: the adapter groups pending/answered counts by question
  mode and the projection releases only the affected-domain counts
  (identity/premises/intents/opportunities/negotiations) the caller is
  authorized for, with conversational `chat`-mode and unrecognized modes
  human-owner-only. There is deliberately no any-of all-question count
  shortcut. A network agent's network-bound aggregates (opportunity and
  negotiation counts) are narrowed to its bound community inside the
  query/adapter layer via the new optional `getAgentActivitySummary`
  `networkId` input — never by transport-local JSON filtering. The response
  never contains counterparty identities, chats, turns, transcripts, or
  private content, and validates against the new strict
  `ActivitySummaryResponseSchema`.
- Export the centralized activity-projection contract
  (`READ_ACTIVITY_SUMMARY_TOOL_NAME`, `McpActivityCallerSchema`,
  `ActivitySummaryDomainSchema`, `ActivitySummaryResponseSchema`,
  `ActivityQuestionDomainSchema`, `ActivityQuestionCountsSchema`,
  `QUESTION_MODE_TO_DOMAIN`, `resolveMcpActivityCaller`,
  `resolveActivitySummaryDomains`, `activitySummaryNetworkId`,
  `projectActivitySummary`, and their types) for host and capability
  composition.

### Changed
- The internal reporter persona now consumes the canonical
  `read_activity_summary` as the same tool (no persona-specific fork);
  unrelated REST/chat behavior is unchanged.
- SemVer rationale: on MCP this release is purely additive —
  `report_agent_activity` was already denied as `removed` since 7.0.0, so no
  working MCP integration can break. The REST/chat tool rename retires a
  same-cycle (7.0.0-era) surface with no alias by deliberate product decision,
  so a minor bump records the change without a major. Recorded here for
  integration-owner reconciliation.

### Removed
- `report_agent_activity` is retired on every surface with no hidden legacy
  alias. It is no longer registered in either tool-registry profile and
  carries no canonical access rule, so a forged MCP `tools/call` under the old
  name is rejected as an unknown tool before any authorization, database, or
  graph work. The `'removed'` access classification remains available in the
  extension contract but no canonical tool uses it.

## [7.1.0] — 2026-07-25

### Changed
- Complete the MCP legacy-surface removal declared in 7.0.0 (IND-596/597/598).
  `createToolRegistry` is now surface-aware: the default `'rest'` profile (direct
  HTTP Tool API + chat) retains contact/Gmail-import tools, `scrape_url`, and the
  deprecated `*_user_profile` / `*_profile_run` compatibility aliases, while the
  restricted `'mcp'` profile omits all of them. The MCP server builds both its
  `tools/list` metadata and its `tools/call` lookup from the `'mcp'` profile, so
  the removed names are no longer registered on the MCP surface — a direct
  `tools/call` for any of them now fails as an unknown tool before any work.
- MCP `read_docs` guidance is sanitized by the MCP surface profile (never by
  `CONTACTS_ENABLED`) so it no longer advertises the removed contact/Gmail
  workflows; REST/chat `read_docs` retains the full guidance.
- `CONTACTS_ENABLED` no longer shapes the MCP registry or its metadata cache key.

### Removed
- The `add_contact`, `import_contacts`, `import_gmail_contacts`, `list_contacts`,
  `remove_contact`, `search_contacts`, `scrape_url`, `read_user_profiles`,
  `create_user_profile`, `update_user_profile`, `confirm_user_profile`,
  `preview_user_profile`, `get_profile_run`, and `cancel_profile_run` entries are
  removed from the canonical MCP capability matrix; the tools are omitted from the
  MCP registry rather than classified. Their non-MCP implementations (REST Tool
  API, dedicated contact REST endpoints, chat agent, shared runtime
  classifications) are unchanged.

## [7.0.0] — 2026-07-25

### Breaking
- MCP capability discovery is now principal-aware. `tools/list` advertises only
  the tools available to the resolved human, onboarding, enrollment-key,
  registered-agent, network-agent, or delivery-agent profile; `tools/call`
  repeats the same authorization before scoped database and handler work.
- Replace the agent permission actions `manage:profile` and `manage:contacts`
  with the canonical `manage:identity` and `manage:premises` actions. The full
  MCP permission vocabulary is now `manage:identity`, `manage:premises`,
  `manage:intents`, `manage:networks`, `manage:opportunities`, and
  `manage:negotiations`.
- Contact tools, Gmail contact import, `scrape_url`, `report_agent_activity`,
  and deprecated profile/profile-run aliases are explicitly unavailable
  through MCP. Their non-MCP implementations remain intact.
- Agent-administration mutations are session-human-only. Enrollment keys may
  call `register_agent` only when explicitly enrollment-capable; registered
  agents may list only their own sanitized registration. Opportunity delivery
  confirmation is exposed only to designated delivery agents.

### Added
- Export a runtime-validated canonical MCP tool access matrix, permission/reach
  extension contracts, principal schemas, and reusable capability-policy
  implementation for host and capability composition.

## [6.14.0] — 2026-07-25

### Added
- Add `NEGOTIATION_INCLUDE_OTHER_INTENTS` (IND-571), a strict boolean
  deployment policy for autonomous opportunity negotiation. The default
  preserves exact-first bounded active-intent context; `false` isolates each
  participant to its exact opportunity-bound intent across fresh and
  continuation negotiation contexts.

## [6.13.22] — 2026-07-25

### Added
- Establish `contacts/` domain-first module spine (IND-549).
  New directories: `contacts/domain/`, `contacts/application/`,
  `contacts/ports/`, `contacts/public/`, plus `contacts/index.ts` barrel.
  Canonical home for contact management (import, list, add, remove, search)
  and the invite message generator, retaining participant reachability
  semantics. Port types: `ContactServiceAdapter`, `ContactToolDeps`.
- Establish `integrations/` domain-first module spine (IND-549).
  New directories: `integrations/domain/`, `integrations/application/`,
  `integrations/ports/`, `integrations/public/`, plus `integrations/index.ts`
  barrel. Canonical home for host-integration configuration/actions
  (OAuth session lifecycle, bulk contact import). Port types:
  `IntegrationAdapter`, `IntegrationImporter`, `IntegrationToolDeps`.
  `IntegrationImporter` is now a named interface (previously inline in
  `shared/agent/tool.helpers.ts`).

### Changed
- `capabilities/contacts.facade.ts` now routes through `contacts/public/`
  (IND-549).
- `capabilities/integrations.facade.ts` now routes through
  `integrations/public/` (IND-549).
- Capability boundary script updated: `contacts/` and `integrations/`
  directories now map to their respective capabilities (alongside legacy
  `contact/` and `integration/`) (IND-549).

### Deprecated
- `contact/contact.tools.ts` is now a thin compatibility re-export shim
  pointing to `contacts/application/` (IND-549).
- `contact/contact.inviter.ts` is now a thin compatibility re-export shim
  pointing to `contacts/application/` (IND-549).
- `integration/integration.tools.ts` is now a thin compatibility re-export
  shim pointing to `integrations/application/` (IND-549).
- `shared/interfaces/contact.interface.ts` is now a thin compatibility shim
  pointing to `contacts/domain/` and `contacts/ports/` (IND-549).
- `shared/interfaces/integration.interface.ts` is now a thin compatibility
  shim pointing to `integrations/domain/` and `integrations/ports/`
  (IND-549).
- `capabilities/contacts.tools.port.ts` is now a thin compatibility shim
  pointing to `contacts/ports/` (IND-549).
- `capabilities/integrations.tools.port.ts` is now a thin compatibility shim
  pointing to `integrations/ports/` (IND-549).

## [6.13.21] — 2026-07-25

### Added
- Establish `questions/` domain-first module spine (IND-547).
  New directories: `questions/domain/`, `questions/application/`,
  `questions/ports/`, `questions/public/`, plus `questions/index.ts` barrel.
  Canonical home for question generation, eligibility, validation, provenance,
  settlement policy, and continuation behaviour.
- Establish `participant-agents/` domain-first module spine (IND-548).
  New directories: `participant-agents/domain/`, `participant-agents/application/`,
  `participant-agents/ports/`, `participant-agents/public/`, plus
  `participant-agents/index.ts` barrel.  Canonical home for agent registration,
  permission-aware behaviour, and dispatch contracts.

### Changed
- `capabilities/questions.facade.ts` now routes through `questions/public/` (IND-547).
- `capabilities/participant-agents.facade.ts` agent-registry portion now
  routes through `participant-agents/application/` and
  `participant-agents/ports/` (IND-548).
- Capability boundary script updated: `participant-agents/` directory now
  maps to the `participant-agents` capability (alongside legacy `chat/`
  and `agent/`) (IND-548).

### Deprecated
- `agent/agent.tools.ts` is now a thin compatibility re-export shim pointing
  to `participant-agents/application/` (IND-548).
- `shared/interfaces/agent.interface.ts` is now a thin compatibility re-export
  shim pointing to `participant-agents/domain/` and `participant-agents/ports/`
  (IND-548).
- `capabilities/participant-agents.tools.port.ts` is now a thin compatibility
  re-export shim pointing to `participant-agents/ports/` (IND-548).
- `questioner/*` paths are now thin compatibility shims pointing to
  `questions/application/` (IND-547).
- `shared/schemas/question.schema.ts` is now a thin compatibility shim
  pointing to `questions/domain/` (IND-547).
- `shared/interfaces/questioner.interface.ts` and
  `shared/interfaces/question-generator.interface.ts` are now thin
  compatibility shims pointing to `questions/ports/` (IND-547).

## [6.13.20] — 2026-07-25

### Added
- Establish `communities/` domain-first module spine (IND-546).
  New directories: `communities/domain/`, `communities/application/`,
  `communities/ports/`, `communities/public/`, plus `communities/tests/` for
  policy characterization.
- Characterization specs for membership authority (join-policy enforcement,
  owner-only removal), privacy/scope intersection (scoped vs unscoped read,
  `showAll` bypass), and signal assignment policy (direct / evaluated /
  no-prompt fast path, membership re-check at persistence time, unassign
  authority).

### Changed
- `capabilities/communities.facade.ts` now imports from
  `communities/application/` instead of the old `network/` paths.
- `capabilities/signals.indexing.facade.ts` updated to import
  `IntentIndexer` from `capabilities/signals.facade.ts` (canonical) instead
  of the legacy `intent/intent.indexer.ts` shim.
- Communities capability boundary script updated: `communities/` directory now
  maps to the `communities` capability (alongside legacy `network/`).

### Deprecated
- `network/network.graph.ts`, `network/network.state.ts`,
  `network/network.tools.ts`, `network/network.recommender.ts`,
  `network/membership/membership.{graph,state}.ts`, and
  `network/indexer/indexer.{graph,state}.ts` are now thin compatibility
  re-export shims pointing to their canonical `communities/` counterparts.

## [6.13.19] — 2026-07-25

### Added
- Establish `participant-context/` domain-first module spine (IND-545).
  New directories: `participant-context/domain/`, `participant-context/application/`,
  `participant-context/ports/`, `participant-context/public/`, plus
  `participant-context/index.ts` barrel.  The four existing implementation
  directories (`premise/`, `context/`, `enrichment/`, `shared/hyde/`) remain in
  place as the canonical code and are re-exported through the new spine — no
  big-bang rewrite.  Characterizes premise provenance invariants
  (`source: explicit | integration | generated`), validity/regeneration invariants
  (`volatile` flag, auto-retraction semantics, regeneration boundary), and
  foreground vs. ambient adapter ownership in block-comment documentation.

### Changed
- `capabilities/participant-context.facade.ts` is now a thin shim over the
  canonical `participant-context/` module.  The facade also absorbs the three
  HyDE exports (`HydeGraphFactory`, `HydeGenerator`, `LensInferrer`) that were
  previously exported from root `index.ts` via direct `shared/hyde/` imports.
  Root `index.ts` routes those three symbols through the facade (no change to
  the public symbols or their shapes).
- `scripts/architecture/capability-boundaries.ts` registers `participant-context/`
  as the canonical capability directory (joining the existing `premise/`,
  `context/`, and `enrichment/` mappings that already pointed to
  `"participant-context"`).  Notes `shared/hyde/` as a cross-capability technology
  binding (used by both participant-context for generation and opportunities for
  search) — left unclassified so both can access it without a boundary fault.
- `architecture/exports.snapshot.json` regenerated; 327 exports unchanged in
  count and shape, three source paths updated to reflect the new facade routing.

## [6.13.18] — 2026-07-24

### Changed
- Establish outer runtime and platform target shells (IND-543). Physically
  relocate `createToolRegistry` to
  `runtime/foreground/composition/tool.registry.ts` (interaction-composition
  boundary); the old `shared/agent/tool.registry.ts` path becomes a
  backward-compat re-export shim. Add declaration-only shells:
  `runtime/foreground/index.ts`, `runtime/background/index.ts`,
  `platform/index.ts` (curated cross-domain primitives), and `public/index.ts`
  (future curated root assembly). Extend `capability-boundaries.ts` to classify
  and enforce four new boundary types: `interaction-composition` (FG),
  `ambient-background` (BG), `neutral-platform` (no capability imports allowed),
  and `public-compatibility` (facades only); new paths are checked rather than
  silently skipped. `mcp.server.ts` updated to import directly from the
  canonical composition path. 14 new architecture-boundary fixture tests added.
  No public root export or runtime behavior changes.

### Changed
- Restore a directed Protocol production module graph: tool-composition
  contracts no longer own opportunity runtime types, discovery continuation
  finalization owns a neutral result contract, and deadlock metadata is owned
  independently of negotiation state. The architecture gate now rejects every
  production cycle (IND-531). No public root export or runtime behavior changes.
- Extract authorized negotiation-detail read/projection behind narrow message,
  artifact, and lifecycle-evidence ports while retaining facade-owned lookup,
  scope admission, participant privacy, and tool IO (IND-530 Batch 16).
- Extract MCP discovery-result lifecycle reconciliation and deferred-result
  narration behind a narrow read/warning/safe-card port while retaining tool
  IO, link minting, and response assembly in the tools facade (IND-530 Batch 15).
- Extract actionable opportunity-feed admission and digest candidate selection
  behind narrow read/ledger/warning ports while retaining tool IO, presenters,
  delivery writes, and response assembly in the tools facade (IND-530 Batch 14).
- Extract continuation post-graph finalization into a narrow handler while
  retaining cache lookup, scope admission, graph invocation, and the public
  response boundary in discovery orchestration (IND-530 Batch 13).
- Extract independently timed, failure-isolated discovery-negotiation summary
  execution into a narrow handler while retaining discovery admission and outer
  orchestration in the facade (IND-530 Batch 12).
- Extract safe negotiation lifecycle-to-narration presentation translation while
  retaining lifecycle reads, tool IO, response assembly, and a compatibility
  re-export in the negotiation tools facade (IND-530 Batch 11).
- Move enforce-mode negotiation screen admission into the existing screen
  capability while retaining graph-owned routing, persistence, and lifecycle
  effects (IND-530 Batch 10).
- Extract state-aware negotiation conversation-lock admission, including the
  full consultation answer-window hold, into a narrow lifecycle policy while
  retaining graph-owned task reads and busy routing (IND-530 Batch 9).
- Extract immutable negotiation task intent-snapshot provenance into a narrow
  persistence handler while retaining LangGraph init-node task wiring and
  lifecycle boundaries (IND-530 Batch 8).
- Extract MCP discovery-run coalescing identity and admission into a narrow
  capability-owned policy while retaining run-store reads, queueing, and tool
  responses in the opportunity tools facade (IND-530 Batch 7).
- Extract safe opportunity-card presentation translation for web/MCP, including
  actionable-link ID suppression, digest markers, code-fence escaping, and
  unsupported-claim/UUID sanitization, while preserving the tools-facade export
  and IO contract (IND-530 Batch 6).
- Extract `update_opportunity` actor, lifecycle, network, and selected-intent
  admission behind a narrow persistence-read port while retaining tool schema,
  uptake advisory, graph invocation, and telemetry wiring in the tools facade
  (IND-530 Batch 5).
- Extract final opportunity-persistence admission (authoritative scope,
  participant-pair eligibility, and guarded reactivation anchors) behind a
  narrow port while keeping dedup routing, writes, and graph observability in
  the opportunity graph (IND-530 Batch 4).
- Extract the existing-opportunity negotiation continuation admission,
  exact-intent translation, and non-introducer notification handler behind a
  narrow opportunity persistence port while retaining graph-owned node wiring
  and observability (IND-530 Batch 3).
- Extract the owned-intent newborn-opportunity stamping eligibility policy and
  fail-open host callback handler from the opportunity persist node while
  preserving graph-owned persistence and observability (IND-530 Batch 2).
- Extract opportunity lifecycle admission rules and persistence handlers from
  the graph while retaining its LangGraph node routing and externally visible
  lifecycle semantics (IND-530).
- Slice tool-factory dependencies into named capability-owned ports for
  enrichment, signals, communities, opportunities, premises, contacts,
  integrations, participant agents, negotiations, and questions. `ToolDeps`
  and `ToolContext` remain structurally compatible composition intersections at
  registry/runtime boundaries; ports are declared and exported through their
  owning capability facades, while individual factories no longer receive the
  all-capability aggregate (IND-529).
- Publish Protocol tarballs without JavaScript or declaration source maps while
  retaining map generation for the first-party Sentry upload build. Published
  declarations remain available for downstream type checking and navigation
  (IND-521).

### Fixed
- Make the Questioner clarifying-questions schema survive strict structured-output conversion: the `Question.evidence` provenance field is now declared `.nullable().optional()` (was bare `.optional()`, which OpenAI/OpenRouter strict mode rejects), so every `QuestionerAgent` LLM call no longer failed client-side before any network I/O. A `.transform()` normalizes an LLM-returned `null` back to `undefined` so a null is never persisted or treated as "evidence present"; real string evidence chips (pool_discovery) flow through unchanged and the intent-recovery `!question.evidence` selection filter is unaffected (regression from the IND-418 pool_discovery work).
- Log failed network-create rollback attempts with an allowlisted network correlation ID and rollback step while preserving the original create or owner-membership failure response (IND-519).
- Move `dotenv` to development dependencies: test/preload environment loading remains available to contributors while published runtime consumers no longer receive it as a direct dependency (IND-518).
- Stop emitting source-test helpers, test directories, and spec/test files in published protocol build artifacts while preserving source-test execution (IND-515).
- Allow the private intent-refinement provenance snapshot to identify intent creation as a producer and make the shared refinement prompt independent of no-opportunity process state, enabling creation and authoritative discovery producers to converge on one ordinary intent-page question cadence.

### Added
- Capability facades for Signals, Participant context, Communities,
  Opportunities, Negotiation, Questions, Participant agents, Contacts, and
  Integrations. Cross-capability callers now use named, narrow facade contracts;
  the root barrel remains backward compatible and also adds the corresponding
  explicit tool-factory entry points. Architecture tooling records every allowed
  dependency direction and preserves the in-place directory layout for later
  extraction work (IND-528).
- Add the private `recovery` Questioner purpose and one-question intent recovery preset for post-discovery signal refinement (IND-506). The preset receives only the owned intent, global owner context, and an optional bounded aggregate count of fail-closed validated no-opportunity outcomes; it forbids candidate/counterparty/process narration, preserves the existing creation-time intent preset, persists publicly as ordinary `mode='intent'` questions with versioned internal recovery metadata, and carries optional material-fingerprint plus expected-owner guards through answer-only updates so the final database write can recheck lifecycle as well as content.
- Add versioned internal negotiation-question provenance and explicit source/candidate opportunity-actor intent threading for ordinary follow-up, inflight consultation, and uptake questions (IND-507). Runtime mode/purpose discriminants, structured `askUser` safety validation, neutral uptake context, and visible-field output gates exclude raw counterparty profile/identity/intent, private transcript, evaluator reasoning, match reasons, event/community inference, evidence, and internal IDs. Exact settlement/task correlation now threads through run-existing continuation admission without changing producer triggers or the ≤2 ordinary/inflight and ≤1 uptake cardinality.
- Add the restricted persisted `onboarding` chat persona (IND-450) with an exact consent/profile/guided-signal/completion allowlist, an onboarding-specific privacy and explicit-approval prompt, Signal's proposal-only live-membership narrowing, shared guided intake stages, and durable `profileConfirmedAt` / exact `firstSignalIntentId` completion markers; selected first signals must be active, owned, and created no earlier than a valid profile-confirmation timestamp. Gmail/contact import, opportunity/discovery/negotiation, community and membership mutation, administration, arbitrary scraping, and unreviewed shared tools remain excluded; the legacy orchestrator onboarding flow remains available to flag-off and non-web consumers.
- Harden reporter turn handling so only the exact kickoff produces the detailed briefing, focused follow-ups stay narrow, and one-turn-local contextual natural-language confirmation deterministically bypasses the model and tools in favor of the visible confirmation card (IND-493).
- Dark-gated reporter cleanup-action proposals for retracting owner premises, narrowing owned signals, and pausing owned signals (IND-490 PR1). `propose_cleanup_actions` is conditionally registered only when `WEB_AGENT_ACTIONS_ENABLED` is enabled alongside the reporter surface; it validates full owner UUIDs, requires pause evidence, persists a confirmation request, and never mutates data in chat.
- Read-only `reporter` chat persona for Agent-surface activity reporting (IND-476 PR1), with an exact positive allowlist, self-only narrowing, aggregate-only opportunity reporting, grounded `report_agent_activity` metrics, and a public briefing kickoff marker. Mutation, discovery, negotiation, memory, question-answering, scraping, and counterparty identity surfaces remain unavailable.
- Restricted `signal` chat persona for the main-web cutover (IND-449), built on the existing persona-neutral runtime with a custom signals/profile prompt, an exact positive allowlist, proposal hallucination recovery, and the discovery-coupled create-intent callback disabled. Signal-specific wrappers clamp focused intent/network reads to owned active intents and current memberships, prohibit other-user membership enumeration, and validate live membership before forwarding network-scoped proposals. Shared orchestrator, MCP, and direct-tool registries are unchanged.
- `RawEvidenceOwnerAnswer` is now re-exported from the root barrel alongside the other Lens C negotiation-evidence segment types, so API-side projections (IND-465 slice 2) can type owner-answer evidence without deep imports. Type-only, additive; no runtime change.
- Default-off `POOL_QUESTIONS_VISIT_TRIGGER` accessor plus the shared 6h `POOL_VISIT_MINING_DEBOUNCE_MS` debounce window for visit-triggered pool mining: the flag only adds a *when* for the existing mining hook — every mining/question gate (`POOL_QUESTIONS_MODE`, k-anonymity floor, VoI threshold, per-intent budgets, freshness fingerprints, push budgets) applies unchanged (IND-439 visibility-audit slice).
- Default-off deadlock detection with a persuasion→bargaining mode shift for v2 negotiations (IND-428, dialogue-game backlog item 6): a deterministic trailing-run detector (`assessDeadlock`, no LLM in the decision) flags N consecutive `counter`/`question` turns without convergence (`NEGOTIATION_DEADLOCK_THRESHOLD`, integer >= 2, default 4) and — only when `NEGOTIATION_DEADLOCK_SHIFT_ENABLED` is literally `true` — shifts the system agent's drafting stance from arguing merits to offering concessions/scope reductions, escalating to `ask_user` only where that action is already legally held. The shift changes stance only: locutions, seat vocabularies (`allowedActionsFor`), termination rules, and turn-cap semantics are untouched; externally dispatched turns never receive the stance. The applied shift is recorded once per session as internal-only `tasks.metadata.deadlockShift` (optional `setTaskDeadlockShift` hook; never projected by API surfaces) plus a `negotiation_deadlock_shift` trace event. Detection and persistence fail open, and with the flag off the drafting path is byte-identical to before. The turn protocol's formal dialogue-game framing (locutions, combination rules, commitment store, termination) is documented in `docs/design/negotiation-dialogue-game.md`. Symbols are module-local (deep import from `negotiation/negotiation.deadlock.js`), deliberately not re-exported from the root barrel per the IND-457 externally-consumed-surface policy.
- Budgeted scheduled live-eval canary (`eval:canary`): a committed, versioned manifest (`eval/canary/canary.manifest.json`) selects a representative, hard-capped subset of the baseline-backed suites (matching, opportunity, premise, profile) and runs each declared case through its existing harness against real providers, producing the same ER2-versioned run artifacts; a provider-free `--plan` dry-run validates the manifest, caps, and budget math and prints pinned model/judge IDs, git provenance, config/corpus fingerprints, and an honest call-count budget (token/cost telemetry reported as unavailable); outcomes are classified over the existing governance exit contract plus recorded artifact completeness into pass / measured regression / provider incident / baseline incompatibility / insufficient evidence; a post-run leak scan quarantines any output containing secret-like env values before upload; the canary never passes `--update-baseline` and the HyDE canonical study is explicitly excluded from routine scheduling; scheduled + manual execution lives in the non-required `.github/workflows/eval-canary.yml` (IND-447).
- Enforced eval baseline compatibility and auditable update governance: exact comparability assessment over harness/schema version, model and judge IDs, selection/full-corpus status, corpus and scoring-config fingerprints, run protocol, and completeness — provably incompatible cohorts are never compared (exit `2`), strict-mode unprovable comparability fails closed (exit `3`), committed schema-v1 baselines keep comparing under the normal policy with explicit notes, `--update-baseline` now requires `--reason` plus a complete full-corpus unfiltered run at a clean identifiable Git revision, every update persists a deterministic reviewable `*.baseline.update.json` provenance/diff summary through the overwrite-safe artifact path, added/removed/skipped cases are reported explicitly, and rolling baselines aggregate only compatible complete full-corpus reports while reporting every excluded artifact with its reason; the beta-binomial comparison and Wilson intervals are unchanged (IND-445).
- Provider-free privacy-aware eval artifact viewer with explicit shared v1/v2 and HyDE-public adapters, allowlisted redaction, attempt-aware execution inspection, baseline deltas, accessible offline navigation, safe failure pages, and atomic read-only output (IND-446).
- Default-off Lens B outcome-question shadow: pure, outcome-blind trade-off hypothesis mining over a user's OWN explicit opportunity decisions, with one unique counterpart per captured opportunity, recipient-scoped counterpart deduplication, run-local candidate aliases (raw opportunity ids are never sent to the LLM), trimmed/unique/non-empty compared sides, conflicting classifier assignments excluded from support, at least five genuinely distinct independent examples per side, small-cell suppression, aggregate-only telemetry, and an `OutcomeOutbox` contract enabling transaction-held scope revalidation plus atomic same-transaction outcome capture in the winning owner-action transition (IND-434).
- Default-off Lens C negotiation-evidence shadow mining from future negotiation tasks with immutable intent snapshots, exact task-linked allowlisted evidence, strict participant/source verification, recurrence across at least five distinct opportunities, and aggregate-only telemetry (IND-433).
- Default-off frame-v1 HyDE generation with source-only frame extraction, post-generation entity/constraint validation, partial/all rejection, ephemeral fail-open behavior, and mode/source/generation-isolated cache persistence (IND-426).
- Opt-in `POOL_QUESTIONS_PUSH` accessor, pool refresh cycle identity, dismissal-decayed push threshold helpers, deterministic Markdown-safe Personal Agent DM template, and typed private push-ledger metadata (IND-421 P5).
- Pre-insert newborn-opportunity stamping for fresh answered pool discriminators, with a fixed-axis evidence-verifying classifier, deterministic `questionId` provenance, and fail-open host callback (IND-420 P4b).
- Durable pool-discriminator semantic novelty metadata: current axis embeddings and embedding-model ids now survive deterministic question snapshot conversion, alongside full-intent freshness fingerprints (IND-420 P4a).
- Additive `IntentRecord.status` lifecycle contract (`ACTIVE | PAUSED | FULFILLED | EXPIRED | null`), with null legacy rows treated as active and paused intents excluded from candidate matching.
- Advisory uptake guard for opportunity acceptance: low-authority counterparty intents can generate preparatory-condition questions, and `update_opportunity` now returns a structured, non-mutating advisory until the questions are resolved or their IDs are explicitly acknowledged (IND-424).
- Public `QuestionPurpose` / uptake Questioner context contracts and `acknowledgedUptakeQuestionIds` acceptance input.
- QUD-typed intent clarification (`missing_constituent`, `missing_constraint`, and `open_alternative_set`) across the live intent elaboration and Questioner flows, with internal detection metadata and exact-match eval coverage (IND-425).

### Changed
- Made matching, opportunity, premise, and profile eval retries, failures, timeouts, cancellations, and incomplete runs first-class attempt evidence; incomplete runs now persist diagnostics but never compare against or update baselines (IND-444).
- Added the pool-question drift lifecycle: exact recipient+intent final freshness gates, shared inclusive `0.7` Jaccard admission, system-voided stale snapshots, durable MODE cadence suppression, intent-edit invalidation, and audit-preserved stale scoped adjustments excluded from ranking (IND-422).
- Retargeted the HyDE evidence-v2 harness to background-only discovery: 75 saved-intent cases plus 15 independently authored user-context cases (90 cases/900 candidates), with private saved-intent -> internal `query` and user-context -> `context` graph-source provenance, production-shaped saved-intent discoverer context, source-specific non-gating diagnostics, and no direct-search cohort. The four counterbalanced paired runs, blinded independent human adjudication, hierarchical bootstrap intervals, eight fixed gates, and production agents remain unchanged; this changes eval evidence and documentation only (IND-426).
- Marked atomically claimed, user-balanced and privacy-thresholded frame-centroid observation plus the privacy-thresholded non-causal yield proxy as shipped by IND-430, while explicitly leaving immutable per-discovery provenance and causal drift diagnosis as future work; protocol runtime behavior is unchanged.
- Intent graph update mode now fails closed to update actions targeting the caller-provided intent IDs; create, expire, and wrong-target actions are discarded before persistence.
- Pool-discriminator shadow scoring now retains generated axis vectors and compares fresh resolved-axis vectors in addition to text references, while embedding failures remain fail-open (IND-420 P4a).
- Reframed `README.md` as the public-facing Index Network Protocol document and moved package integration details into `IMPLEMENTATION.md`.
- Included protocol documentation files in the published package tarball so README links remain available to package consumers.

### Fixed
- Made negotiation startup claim the exact persisted pre-negotiation status and version, atomically promote the winning opportunity to `negotiating` with its task, and skip finalize persistence when init owns no task (IND-496).
- Made Personal Agent negotiation narration lifecycle-accurate: concluded agent tasks now carry additive current-opportunity, owner-acceptance, and no-H2H-evidence labels; agent-side `accept` no longer implies owner acceptance, a completed connection, or a message thread (IND-492).
- Made owned-intent opportunity persistence trigger-aware: recent/lifecycle dedup now reuses only rows linked to the same trigger intent, cross-trigger rows remain independently visible, enrichment cannot absorb another trigger's row, and final persistence reports typed same-trigger/active-negotiation conflicts (IND-495).
- Clamped intent-pinned `list_negotiations` results to the user's signal, added explicit signal/all scope metadata, and prevented stale cross-signal history from being presented as current negotiations (IND-483).
- Routed continuation-created and recovered opportunities through the normal negotiation boundary, threaded each persisted attempt version into atomic negotiation-task claiming, protected active/input-required tasks from duplicate negotiation, compensated pre-task failures and timeouts to truthful draft/latent states, and refreshed continuation cards from current lifecycle state (IND-470).
- Normalized opportunity actor intent IDs at evaluator, graph, and shared persistence boundaries so blank or null-like model sentinels are omitted, valid branded string IDs remain supported, enrichment cannot use or reintroduce malformed provenance, and legacy negotiation reads fail closed (IND-469).
- Forwarded per-attempt `AbortSignal`s through eval provider paths and hardened failure provenance against secret leakage, hostile rejection objects, classifier failures, and concurrent artifact writers (IND-444).
- Aligned HyDE evidence scoring with the live background `0.30` cutoff, retained per-lens cosines for score/ranking revalidation, required report-stage parent recomputation, and prevented forced outputs from overwriting input evidence artifacts (IND-426).
- Scoped pool-question adjustments to the exact answering recipient and selected intent, ignored legacy unscoped factors, and restricted Tier-0/newborn writes to exact trigger-intent provenance so shared opportunities cannot re-rank another viewer or intent.
- Made trigger-intent discovery fail closed over current intent assignments, active owner memberships, and explicit caller scope; enforced active candidate membership across intent/premise/context retrieval plus pre-evaluation/pre-persistence rechecks and selected-intent Radar reads.
- Removed network-derived co-attendance inference and added deterministic affiliation/presence claim rejection across evaluation, presenter/fallback/MCP/REST/delivery/chat/invite surfaces, with versioned presentation caches that do not retain degraded fallback copy.

## [6.2.1] - 2026-07-18

### Fixed
- Restored unscoped asynchronous MCP discovery by wiring the background worker to real network and membership graphs, and surfaced network-read failures instead of misreporting them as zero memberships (IND-466).

## [4.3.0] - 2026-06-21

### Added
- `STABILITY.md` defining the public contract, stability tiers (Stable vs
  `@experimental`), SemVer policy, and the deprecation path.
- Port-contract doc-comments on the `ChatSessionReader`, `DiscoveryRunStore`/
  `DiscoveryRunQueue`, `EnrichmentRunStore`/`EnrichmentRunQueue`, and `Embedder`
  interfaces (ownership scoping, null-vs-empty-array, lifecycle idempotency).
- Tier annotations and an entry-point header in `src/index.ts`.

### Changed
- Replaced all `export type *` wildcard re-exports in `src/index.ts` with explicit
  named exports so the public surface is fully enumerated and reviewable. No
  symbols added or removed — the exported surface is unchanged.
- Expanded `README.md` to document the full public surface (graph factories,
  agents, MCP, tools) and link the stability policy.

## [4.2.0] - 2026-06-19

### Added
- Opportunity legibility: cards explain *why* an opportunity surfaced.
- Negotiation trace links on surfaced opportunities.

## [4.1.0] - 2026-06

### Added
- Canonical user-context / enrichment MCP tools; `discoverySource` rename
  (IND-372, IND-371, IND-374).
- Context-derived `read_user_profiles` payload (IND-364).

### Changed
- Category A prompt consumers repointed at the global `user_context` (IND-361).
- Premise pipeline ownership: dedup, LLM validity, richer provenance (IND-359).

## [4.0.0] - 2026-06-18

### Changed
- **BREAKING:** Eliminated the "profile" concept — the pipeline, files, service,
  controller, adapter, and exported types were renamed to `enrichment`
  (`ProfileDocument` → `UserIdentity`, `read_user_profiles` returns a flat
  identity+context payload, questioner `profile` mode → `enrichment`). Update any
  imports of the removed `Profile*` exports. (IND-368)

### Removed
- **BREAKING:** `user_profiles` table and the profile generate/aggregate/save path
  retired (IND-365).

## [3.6.0] - 2026-06-12

### Added
- `read_pending_questions` MCP tool, registered in the tool registry.

## [2.0.1] - 2026-06

### Fixed
- Post-`2.0.0` fixes and stabilization.

## [2.0.0] - 2026-06-08

### Changed
- **BREAKING:** Removed `configureProtocol` startup call — model configuration is
  read from the environment and `ModelConfig` is injected per-request via
  `ToolContext`. See README for migration.

## [1.0.0 - 1.23.3] - 2026-04 to 2026-06

Pre-2.0 line: established the adapter-injected LangGraph architecture (chat,
intent, opportunity, negotiation, premise, enrichment domains), the MCP server,
the matching/opportunity/premise eval harnesses, premise source tracking and
cascade retraction, network-scoped agents, and the agent registry. Reconstructed
from git history; not itemized.

<!--
Release tags stopped being created when publishing moved to the automated
subtree workflow: only v0.2.1 and v0.3.0 still exist in indexnetwork/protocol,
so every `compare/vX.Y.Z` link below 404s. They are kept for historical intent.
New entries link to the npm release instead, and [Unreleased] compares the
branches that actually define it.
-->

[Unreleased]: https://github.com/indexnetwork/protocol/compare/main...dev
[8.0.2]: https://www.npmjs.com/package/@indexnetwork/protocol/v/8.0.2
[4.3.0]: https://github.com/indexnetwork/protocol/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/indexnetwork/protocol/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/indexnetwork/protocol/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/indexnetwork/protocol/compare/v3.6.0...v4.0.0
[3.6.0]: https://github.com/indexnetwork/protocol/compare/v2.0.1...v3.6.0
[2.0.1]: https://github.com/indexnetwork/protocol/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/indexnetwork/protocol/releases/tag/v2.0.0
