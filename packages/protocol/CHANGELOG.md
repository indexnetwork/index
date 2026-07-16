# Changelog

All notable changes to `@indexnetwork/protocol` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
See [STABILITY.md](./STABILITY.md) for the public-contract and tier definitions.

> History before `2.0.0` was reconstructed from git and is summarized rather than
> itemized. From `2.0.0` onward, keep this file updated as part of every release
> (bump `package.json` and the `[Unreleased]` section before promoting to `main`).

## [Unreleased]

### Added
- Default-off frame-v1 HyDE generation with source-only frame extraction, post-generation entity/constraint validation, partial/all rejection, ephemeral fail-open behavior, and mode/source/generation-isolated cache persistence (IND-426).
- Opt-in `POOL_QUESTIONS_PUSH` accessor, pool refresh cycle identity, dismissal-decayed push threshold helpers, deterministic Markdown-safe Personal Agent DM template, and typed private push-ledger metadata (IND-421 P5).
- Pre-insert newborn-opportunity stamping for fresh answered pool discriminators, with a fixed-axis evidence-verifying classifier, deterministic `questionId` provenance, and fail-open host callback (IND-420 P4b).
- Durable pool-discriminator semantic novelty metadata: current axis embeddings and embedding-model ids now survive deterministic question snapshot conversion, alongside full-intent freshness fingerprints (IND-420 P4a).
- Additive `IntentRecord.status` lifecycle contract (`ACTIVE | PAUSED | FULFILLED | EXPIRED | null`), with null legacy rows treated as active and paused intents excluded from candidate matching.
- Advisory uptake guard for opportunity acceptance: low-authority counterparty intents can generate preparatory-condition questions, and `update_opportunity` now returns a structured, non-mutating advisory until the questions are resolved or their IDs are explicitly acknowledged (IND-424).
- Public `QuestionPurpose` / uptake Questioner context contracts and `acknowledgedUptakeQuestionIds` acceptance input.
- QUD-typed intent clarification (`missing_constituent`, `missing_constraint`, and `open_alternative_set`) across the live intent elaboration and Questioner flows, with internal detection metadata and exact-match eval coverage (IND-425).

### Changed
- Retargeted the HyDE evidence-v2 harness to background-only discovery: 75 saved-intent cases plus 15 independently authored user-context cases (90 cases/900 candidates), with private saved-intent -> internal `query` and user-context -> `context` graph-source provenance, production-shaped saved-intent discoverer context, source-specific non-gating diagnostics, and no direct-search cohort. The four counterbalanced paired runs, blinded independent human adjudication, hierarchical bootstrap intervals, eight fixed gates, and production agents remain unchanged; this changes eval evidence and documentation only (IND-426).
- Marked atomically claimed, user-balanced and privacy-thresholded frame-centroid observation plus the privacy-thresholded non-causal yield proxy as shipped by IND-430, while explicitly leaving immutable per-discovery provenance and causal drift diagnosis as future work; protocol runtime behavior is unchanged.
- Intent graph update mode now fails closed to update actions targeting the caller-provided intent IDs; create, expire, and wrong-target actions are discarded before persistence.
- Pool-discriminator shadow scoring now retains generated axis vectors and compares fresh resolved-axis vectors in addition to text references, while embedding failures remain fail-open (IND-420 P4a).
- Reframed `README.md` as the public-facing Index Network Protocol document and moved package integration details into `IMPLEMENTATION.md`.
- Included protocol documentation files in the published package tarball so README links remain available to package consumers.

### Fixed
- Aligned HyDE evidence scoring with the live background `0.30` cutoff, retained per-lens cosines for score/ranking revalidation, required report-stage parent recomputation, and prevented forced outputs from overwriting input evidence artifacts (IND-426).
- Scoped pool-question adjustments to the exact answering recipient and selected intent, ignored legacy unscoped factors, and restricted Tier-0/newborn writes to exact trigger-intent provenance so shared opportunities cannot re-rank another viewer or intent.
- Made trigger-intent discovery fail closed over current intent assignments, active owner memberships, and explicit caller scope; enforced active candidate membership across intent/premise/context retrieval plus pre-evaluation/pre-persistence rechecks and selected-intent Radar reads.
- Removed network-derived co-attendance inference and added deterministic affiliation/presence claim rejection across evaluation, presenter/fallback/MCP/REST/delivery/chat/invite surfaces, with versioned presentation caches that do not retain degraded fallback copy.

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

[Unreleased]: https://github.com/indexnetwork/protocol/compare/v4.3.0...HEAD
[4.3.0]: https://github.com/indexnetwork/protocol/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/indexnetwork/protocol/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/indexnetwork/protocol/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/indexnetwork/protocol/compare/v3.6.0...v4.0.0
[3.6.0]: https://github.com/indexnetwork/protocol/compare/v2.0.1...v3.6.0
[2.0.1]: https://github.com/indexnetwork/protocol/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/indexnetwork/protocol/releases/tag/v2.0.0
