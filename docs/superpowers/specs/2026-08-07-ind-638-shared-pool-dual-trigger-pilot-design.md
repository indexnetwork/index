# IND-638 Shared-Pool Dual-Trigger Pilot Design

**Date:** 2026-08-07

**Issue:** IND-638 — HDQ3: Run five-pair shared-pool dual-trigger pilot

**Base revision:** `7a4b20b8cfb7826e1e9d4b712a3b309bb4314f89` (`dev`)

**Status:** Approved design; implementation is split into two sequential pull requests.

## 1. Purpose

IND-638 proves that Index can measure historical rediscovery end to end without confusing execution completeness with discovery quality. It runs the five independently reviewed IND-637 cases against one shared 25-person candidate pool through two production-shaped triggers:

- intent-triggered discovery;
- enrichment-triggered discovery.

The pilot is measurement-first. A low target-retrieval or final-inclusion result is valid evidence. Missing, failed, contaminated, or incomparable execution is not. No target score gates issue completion.

The first complete live pilot is five cases × two triggers × one repetition: ten graph invocations. The CLI retains the existing default of three repetitions, so an unfiltered default run costs 30 graph invocations. Every slot has exactly one attempt, and every plan remains subject to the existing hard cap of 200 graph invocations.

## 2. Locked decisions

1. Use one shared candidate pool containing all 25 final IND-637 participants.
2. Classify each case's 24 non-source candidates as:
   - one `target`;
   - three `semantic-negative` candidates with authored audit-only failure reasons;
   - twenty `background` candidates.
3. Use one minimal synthetic network prompt with fresh independent leakage and recognizability review. Do not concatenate the five case-specific prompts.
4. Commit reviewed derived retrieval-document text to Git. Generate embeddings only during an explicitly confirmed protected-base refresh and attest their fingerprints, model, and configuration in protected-base metadata.
5. Seed reviewed enrichment state: preserve the five source participants' exact audited rows and use only independently reviewed deterministic projections for the other twenty participants. Never regenerate enrichment text during refresh or measured slots.
6. Use one selected Neon child branch for the pilot. Restore it from the verified base before every slot and run all slots serially.
7. Define final rank as the thresholded graph evaluator order. Persistence or duplicate/conflict suppression is not rank.
8. Report a stage funnel, not a composite quality score.
9. Keep quality-mode launch operator-CLI-only in IND-638. Eval Ops renders artifacts truthfully but does not launch this destructive mode.
10. Verify the base through an attested Neon read-replica endpoint whose database session reports read-only.
11. Deliver two sequential PRs: provider-free contracts first, guarded runtime second.
12. After one intent smoke and one enrichment smoke, complete a ten-slot live pilot. Never automatically rerun an incomplete smoke or pilot slot.

## 3. Non-goals

IND-638 does not:

- rewrite any existing IND-637 historical profile, source premise, source context, intent, citation, cutoff, participant direction, or report identity; candidate enrichment rows added for pooling may only be deterministic projections of already approved model-safe fields and require separate pooled review;
- add new historical pairs or the approximately 35-person background expansion owned by IND-639;
- compare models or environment configurations;
- create a second eval harness or artifact family;
- establish a quality threshold, baseline, regression gate, or canonical measurement;
- commit embedding vectors to Git;
- regenerate reviewed text during measured execution;
- enqueue BullMQ jobs or execute unrelated queue post-success callbacks;
- change legacy discovery A/B or discovery-environment-matrix behavior;
- provision or mutate live infrastructure without a separate operational confirmation.

## 4. Delivery architecture

### 4.1 PR A — provider-free contract and presentation

PR A establishes the complete authority consumed by the runtime:

- shared-pool seed-plan contract and direct stable-ID mapping;
- one reviewed synthetic network prompt;
- reviewed, committed derived retrieval-document text;
- three-role candidate classification;
- trigger and experiment planning contracts;
- production-shaped pure trigger option builders shared with queue workers;
- safe historical-quality metric and artifact contracts;
- CLI parsing, help, cost, and no-comparison semantics;
- truthful Eval Ops artifact rendering and generic-comparison exclusion;
- provider-free tests, static validation, and independent pooled-content review.

PR A performs no provider, database, Redis, Neon, protected-base refresh, or live-eval operation. PR B cannot begin until PR A is merged, its merge-commit workflows pass, and a merged-tree audit is clean.

### 4.2 PR B — guarded runtime and operations

PR B adds:

- historical-quality protected-base seeding and read-only verification;
- embedding generation only inside an explicit refresh;
- versioned `DISCOVERY_TARGETS` base read-replica target;
- verification-before-reset;
- one-child restore-per-slot scheduling;
- fresh process and Redis namespace per slot;
- dependency construction only after restored-child verification;
- intent and enrichment execution;
- sanitized evidence projection and incomplete-evidence suppression;
- guarded disposable-database tests;
- operator runbook, manifest migration, smokes, and the ten-slot pilot.

## 5. Shared-pool authority

### 5.1 Source corpus

`HISTORICAL_QUALITY_CASES` remains the sole content authority. Strict construction must require exactly five approved cases that each satisfy `validateHistoricalQualityCase`, including:

- one historical discoverer;
- one positive historical target;
- three authored synthetic semantic negatives;
- an exclusive event-primary pre-connection cutoff;
- complete field provenance;
- approved non-high recognizability review.

The final direct mappings are:

| Case | Source | Target |
|---|---|---|
| `historical/builder-and-operator` | `h1-a` | `h1-b` |
| `historical/co-researchers-structure` | `h2-a` | `h2-b` |
| `historical/songwriting-duo` | `h3-a` | `h3-b` |
| `historical/first-check-investor` | `h4-a` | `h4-b` |
| `historical/domain-expert-and-ml` | `h5-a` | `h5-b` |

H1's evaluator mapping remains dyadic while the audit record preserves Martha Nierenberg's material participation. H5 remains Drew Weissman → Katalin Karikó and excludes post-contact facts.

#### Enrichment-row authority

The current corpus contains exact reviewed enrichment premises and user context for each of the five source participants, not for all 25 pool members. PR A must preserve those five source rows byte-for-byte.

The remaining twenty participants need candidate retrieval state in the shared pool. PR A may add it only as deterministic derived fixture data:

- premise text must be an exact approved profile or intent field, not a paraphrase;
- context text must use one fixed non-generative template over explicitly enumerated approved model-safe fields;
- every derived row must record its source field paths and content fingerprint;
- no new biography, motivation, capability, relationship, chronology, or outcome claim is permitted;
- the complete twenty-participant projection must receive the same independent pooled-content approval as the shared prompt and retrieval documents.

`HISTORICAL_QUALITY_CASES` therefore remains the sole authority for facts, while the shared-pool plan becomes the authority for reviewed deterministic retrieval projections. Strict admission fails if any required participant lacks a source or derived premise/context row.

### 5.2 Shared network

The shared network uses a stable versioned ID and the following model-facing text:

- **Title:** `Interdisciplinary collaboration community`
- **Prompt:** `A private community where people describe what they are working on, what they can contribute, and the kinds of collaboration they are open to.`

This text is explicitly synthetic fixture context, not a historical claim. It is admitted only after an independent reviewer approves:

- neutrality across all five domains;
- absence of names, dates, places, institutions, products, papers, songs, or outcomes;
- absence of source/target privilege;
- pooled-combination recognizability no higher than medium.

The review record is audit-only and never enters model input or seed rows.

Approval is mechanically bound to content:

```ts
interface HistoricalSharedPoolApproval {
  status: "pending" | "approved";
  authorId: string;
  reviewerId: string;
  independenceAttested: boolean;
  reviewedAt: string;
  reviewedRevision: string;
  corpusVersion: string;
  planFingerprint: string;
  retrievalDocumentFingerprint: string;
  recognizability: "low" | "medium" | "high";
  decision: "approved" | "changes-requested";
  rationale: string;
}
```

Strict admission requires `approved`, reviewer distinct from author, an explicit independence attestation, a parseable review time and revision, exact current corpus/plan/document fingerprints, decision `approved`, nonempty rationale, and recognizability no higher than medium. Any content or fingerprint change returns the pool to pending review. The committed record is frozen and recursively excluded from model, database seed, child argument, and artifact projections.

### 5.3 Stable IDs and direct mapping

The shared-pool plan maps stable source IDs directly. It must never recover a database ID from profile text, array position, report name, or other prose.

```ts
type HistoricalCandidateRole = "target" | "semantic-negative" | "background";

interface HistoricalSharedPoolPlan {
  corpusVersion: string;
  network: {
    id: string;
    title: string;
    prompt: string;
  };
  participants: Array<{
    participantId: string;
    userId: string;
    intentId: string;
    premiseIds: string[];
    contextId: string;
    retrievalDocumentIds: string[];
  }>;
  cases: Array<{
    caseId: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    candidates: Array<{
      participantId: string;
      role: HistoricalCandidateRole;
      semanticNegativeReasonId?: string;
    }>;
  }>;
}
```

Requirements:

- one network;
- exactly 25 unique participants and memberships;
- exactly five source mappings;
- for every case, exactly 24 candidates: one target, three semantic negatives, twenty backgrounds;
- IDs derived only from stable source IDs and a fixed quality namespace;
- output invariant to source-array reordering;
- no inconsistent duplicate participant;
- no report identity, audit metadata, answer key, or semantic-negative reason in model-safe rows;
- an independent literal fingerprint over the complete plan and complete database seed projection.

Existing participant identity remains stable. The shared network receives a new ID. Intent, premise, context, and retrieval-document IDs are explicit, deterministic, and pinned; they are not reconstructed from text.

### 5.4 Reviewed retrieval state

All 25 participants belong to the shared network and their audited intents are assigned to it. The five source participants persist their exact existing reviewed enrichment rows byte-for-byte. The other twenty participants persist only the independently reviewed deterministic, source-path-bound candidate enrichment projections defined above.

Reviewed derived retrieval-document text is committed as fixture data with:

- stable document ID;
- participant/source ID;
- source type;
- strategy;
- target corpus or frame;
- exact reviewed text;
- content fingerprint;
- review metadata kept outside model input.

PR A may author these documents from already approved model-safe facts, but they remain pending until an independent reviewer approves source grounding, neutrality, anonymization, and pooled recognizability. Measured slots never generate or rewrite them.

Embedding vectors are not committed. The confirmed base refresh embeds the approved text once, records exact vector fingerprints plus provider/model/configuration identity, and publishes quality metadata only after all rows pass integrity verification.

## 6. CLI and experiment plan

Quality mode remains part of the `discovery` harness:

```text
bun run eval:discovery -- \
  --historical-quality \
  --trigger intent \
  --trigger enrichment \
  --runs 1 \
  --env DISCOVERY_ALLOWED_TYPES=intent,profile
```

Contract:

- `--historical-quality` selects the additive mode.
- `--trigger intent|enrichment` is repeatable; omission selects both.
- `--case <id>` may filter to one or more existing cases according to the existing selection contract.
- `--runs <n>` defaults to 3 and remains bounded by existing repetition and 200-invocation limits.
- Quality mode requires the existing single-configuration `--env` shape and rejects comparison `--a/--b`.
- It reuses report path, force, confirmation, and exit-code conventions.
- It has no baseline and no baseline-update flags.
- Help remains credential-free and explains restore-per-slot behavior, graph and evaluator call estimates, read-only base verification, one-attempt policy, and no-subset-verdict behavior.

PR A introduces a dedicated `buildHistoricalQualityPilotPlan` as the pilot planning authority. It accepts exactly one resolved configuration, quality triggers, selected cases, and repetitions; emits opaque slot IDs plus explicit case, trigger, repetition, selected side, configuration fingerprint, and fixed one-attempt policy; and rejects comparison inputs. The existing comparison-oriented `buildHistoricalExperimentPlan` remains unchanged for later model/environment comparison work (IND-641), with its existing tests and callers preserved. Child arguments contain opaque IDs and configuration identifiers, never corpus prose or credentials.

## 7. Production-shaped triggers

Pure builders are extracted from the two production queue seams and used by both queue workers and quality mode.

### 7.1 Intent

Queue admission remains in `FromIntentQueue`: ownership, status, memberships, network assignment, and scope intersection. The shared builder accepts already authorized values and returns the complete graph invocation:

- source user ID;
- persisted audited search query;
- `operationMode: "create"`;
- one shared `networkId` or its exact one-network `indexScope` equivalent;
- trigger intent ID;
- `options.initialStatus: "latent"`;
- the existing minimum score when required by the graph contract.

Quality mode verifies fixture ownership and assignments before calling the builder. It does not inherit BullMQ's three-job-attempt policy.

### 7.2 Enrichment

The enrichment builder returns:

- source user ID;
- shared network ID;
- `operationMode: "create"`;
- `options.initialStatus: "latent"`;
- the existing minimum score when required.

It omits search query and trigger intent ID. Reviewed premises and user context are read from restored storage; they are not invented graph parameters.

The pilot invokes the graph directly to retain graph output and traces. It does not enqueue jobs or execute unrelated callbacks.

## 8. Protected-base lifecycle

### 8.1 Separate refresh and verification

The existing protected base remains the physical base. Historical quality uses a separate metadata key and version. PR B adds a nullable JSONB attestation column to `eval_matrix_metadata` through a normal Drizzle migration; the legacy matrix metadata row keeps it null and preserves existing behavior.

The quality row stores a versioned canonical attestation object:

```ts
interface HistoricalQualityBaseAttestation {
  version: 1;
  corpusVersion: string;
  seedPlanFingerprint: string;
  documentSetFingerprint: string;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    configurationFingerprint: string;
  };
  vectors: Array<{
    documentId: string;
    textFingerprint: string;
    vectorFingerprint: string;
  }>;
}
```

The row's existing `fixtureFingerprint` is the SHA-256 digest of canonical JSON for this object; `fixtureCorpusVersion` carries the quality corpus version; `schemaMigrationFingerprint` retains its existing meaning. Vectors are fingerprinted from a canonical finite-number encoding in stable document-ID order. Refresh writes exactly one quality root row after all data verifies. Read-only verification recomputes source text, seed-plan, document-set, configuration, and DB-vector fingerprints and requires exact equality with both the JSON object and its root digest.

Refresh:

- requires `DISCOVERY_ENV_MATRIX_BASE_CONFIRM=1` and `TEST_DATABASE_SAFE=1`;
- uses the writable protected base;
- may call the configured embedder only for approved committed text;
- deletes or replaces only fixture-owned IDs;
- refuses unexpected dependents or opportunities;
- removes/withholds quality metadata before provider-backed writes;
- publishes metadata only after exact rows, documents, assignments, vectors, and fingerprints verify.

Verification:

- is provider-free and read-only;
- never constructs an embedder, model, HyDE generator, opportunity graph, or Redis client;
- checks exact scalar rows, IDs, lifecycle/status, assignments, one network, finite vector dimensions, document source links, text and vector fingerprints, and absence of mutable leftovers;
- fails closed on any difference.

The discovery runner never refreshes a stale base. It reports the failure before reset or spend.

### 8.2 Read-replica manifest

`DISCOVERY_TARGETS` becomes a versioned manifest containing:

- project ID;
- base branch ID;
- base read-replica endpoint ID and `/protocol_eval` URL;
- the existing two child branch/endpoint/URL targets.

Attestation verifies:

- project ownership;
- exact protected base branch name and non-primary status;
- read-replica endpoint ownership and endpoint/URL host binding;
- child branch parentage and endpoint/URL binding;
- exact `/protocol_eval` path;
- no crossed base/child endpoint.

Before any reset, a fresh verifier process connects only to the attested base read replica, confirms the database session reports read-only, and performs quality verification. A failure remains pre-reset/pre-spend.

Child-side verification remains as defense in depth after restore.

## 9. Per-slot isolation

The initial pilot selects one existing single-run child target and runs every slot serially.

For each slot:

1. Restore the selected child from the verified base and await all Neon operations.
2. Spawn a fresh Bun process for exactly one opaque slot.
3. Re-attest the manifest and exact child URL/branch binding.
4. Verify restored quality metadata and fixture state.
5. Only then construct database, embedder, Redis, graph, generator, evaluator, and judge dependencies.
6. Create a unique cache namespace from opaque run/slot/configuration identifiers.
7. Invoke one trigger once. The slot orchestration runner—not the graph invocation object—uses `maxAttempts: 1` and no retry backoff.
8. Project and write one sanitized terminal child result.
9. Close DB and Redis resources before the next restore.

No two slots use the selected branch concurrently. No slot carries opportunity, rejection-cooldown, mutable context, or cache history into the next slot.

A local `HydeCache` decorator prefixes every operation. It cannot escape its namespace. The restored database's approved frozen documents are the authoritative miss fallback, so Redis isolation does not cause regeneration.

## 10. Quality evidence

### 10.1 Per-participant metric

```ts
interface HistoricalParticipantMetric {
  participantId: string;
  role: "target" | "semantic-negative" | "background";
  retrieval: null | {
    rank: number;
    bestScore: number;
    evidenceIds: string[];
    evidenceTypes: Array<"intent" | "premise" | "user_context">;
  };
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    score: number | null;
    errorClass?: string;
  };
  finalRank: number | null;
  failureStage: HistoricalFailureStage;
}
```

Raw retrieval evidence is converted to `HistoricalRetrievalEvidenceRow` and then passed through `dedupeHistoricalRetrieval`. Dedupe retains the best score, merges evidence IDs/types, sorts by descending score, and uses participant ID for stable ties.

Evaluator states are distinct:

- `eligible`: present after membership/cooldown eligibility;
- `submitted`: present in candidate evaluation or candidate-specific failure trace;
- `returned`: finite evaluator score returned;
- final inclusion/rank: present in thresholded `evaluatedOpportunities` order.

An eligible but unsubmitted candidate is not called rejected. `classifyHistoricalFailureStage` classifies every target, semantic negative, and background candidate from explicit booleans.

### 10.2 Slot and run summaries

Each slot becomes one unique transport case row. Its transport `caseId` is `${encodeURIComponent(logicalCaseId)}/${trigger}/r${repetition + 1}`; logical case ID, trigger, and zero-based repetition also remain explicit typed fields. This prevents duplicate scorecard case IDs while preserving stable logical aggregation.

Each slot records:

- `kind: "historical-quality-pilot"`;
- logical case ID, trigger, repetition, and configuration fingerprint;
- terminal completion state;
- 24 participant metrics;
- a descriptive stage-funnel summary only when complete.

The run-level report aggregates complete evidence by case and trigger:

- target retrieved count/rate;
- target evaluator-return count/rate;
- target final-inclusion count/rate;
- target final-rank distribution;
- semantic-negative final-inclusion count;
- background final-inclusion count;
- failure-stage distribution.

There is no composite pass score, winner, quality threshold, or baseline delta.

`executionCompletenessFields` supplies only transport-required `runs`, `passes`, and `passRate`. These fields never contribute to quality calculations.

### 10.3 Incomplete evidence

A run is complete only when every requested slot has exactly one terminal-success attempt and one valid quality row.

If any slot is missing or failed:

- persist the sanitized diagnostic artifact;
- mark run-level quality output unavailable;
- print `no quality verdict`;
- exit with insufficient-evidence status `3`;
- do not average successful subsets;
- do not retry automatically.

Reset or process-launch failures retain the existing operational failure classification and spend-stage accounting.

## 11. Artifact and Eval Ops presentation

The existing `index-eval/run-report` envelope and `harness: "discovery"` remain. PR A extends the strict V2 artifact schema with an optional explicit metadata discriminator:

```ts
measurement: {
  kind: "historical-quality-pilot";
  scorecardSemantics: "execution-completeness";
  repetitionsRequested: number;
  requestedSlots: number;
  completedSlots: number;
  qualityVerdictAvailable: boolean;
}
```

Quality case rows carry `historicalQuality`. Transport-required scorecard fields are populated only from execution evidence:

- every logical repetition is already a unique slot/case row, so the strict envelope and payload use `runs: 1` regardless of `repetitionsRequested`;
- every slot uses rule `execution-completeness`, row `runs: 1`, and `passes: 1 | 0`;
- execution contains exactly one run with `runIndex: 0` for each unique transport case row, satisfying `execution.runs.length === payload.cases.length * artifact.runs`;
- rule pass rate and `aggregatePassRate` are therefore execution-completeness aggregates;
- logical case/trigger/repetition aggregation reads only typed `historicalQuality` fields, never transport case-ID parsing;
- no quality field is derived from transport pass values.

The shared artifact validator verifies this projection and forbids the quality discriminator with any other scorecard semantics. Eval Ops server/API comparison code excludes `measurement.kind === "historical-quality-pilot"` before generic discovery A/B projection, not merely at render time.

Eval Ops:

- shows execution completeness as `completed/requested`;
- shows `quality verdict unavailable` for incomplete runs;
- renders per-case/trigger funnel and participant metrics for complete runs;
- labels target, semantic-negative, and background roles distinctly;
- never displays aggregate pass rate, baseline delta, regression, winner, or quality percentage for quality artifacts;
- excludes quality artifacts from generic Harness/Compare score comparisons;
- updates destruction language to say the selected child is restored before every measured slot;
- does not add historical-quality launch controls in IND-638.

No artifact field contains raw profiles, prompts, context text, citations, report names, URLs, semantic-negative reasons, reviewer data, provider reasoning, provider errors, or credentials.

## 12. Safety and failure handling

- Help executes before credential or runtime imports.
- Confirmation precedes Neon access.
- Control-plane attestation precedes database/runtime imports.
- Read-only base verification precedes every destructive reset.
- Restored-child verification precedes expensive dependency construction.
- Credentials and URLs never appear in arguments, logs, errors, or artifacts.
- Only fixture-owned IDs may be refreshed or cleaned.
- No global Redis flush or broad `protocol:*` deletion is permitted.
- No database-backed test runs until `DATABASE_URL` is proven to be the attested disposable `/protocol_eval` child and `TEST_DATABASE_SAFE=1` is set.
- The fail-closed database guard is never bypassed.
- No provider/model/live run occurs in PR A.
- Read-replica provisioning, manifest-secret migration, base refresh, smokes, and the ten-slot pilot each occur only after deterministic gates and separate operational confirmation.

## 13. Verification strategy

### 13.1 PR A

Provider-free tests must prove:

- exact five-case admission and 25-person pool;
- one network and stable direct mappings;
- one/three/twenty role counts per case;
- order-invariant IDs and fingerprints;
- model/audit leakage exclusion;
- fresh pooled prompt/document approval schema, independence, revision, and exact fingerprint binding;
- ten-slot and 30-slot plans, one attempt, and 200-invocation cap;
- production queue/builder byte parity;
- intent versus enrichment invocation differences;
- retrieval dedupe, evaluator-state distinctions, final rank, and every failure stage;
- completeness-only transport fields;
- safe artifact schemas and incomplete no-verdict behavior;
- Eval Ops truthful labels and generic-comparison exclusion.

Run affected protocol, API, queue, and Eval Ops tests plus typechecks, builds, lint, subtree parity, frozen install, static inventories, and provider-free `eval:verify`.

### 13.2 PR B

Provider-free tests must prove:

- versioned base read-replica target parsing and attestation;
- read-only verify → reset → spawn ordering;
- no reset/dependency construction on base failure;
- retained child verification before dependency construction;
- one restore and one process per slot;
- serial selected-branch scheduling and no retries;
- opaque child arguments and redaction;
- unique bounded Redis namespaces;
- DB fallback uses approved documents without generation;
- exact sanitized metric projection;
- incomplete-run suppression and exit semantics;
- resource cleanup on every terminal path.

Database-backed tests require the attested disposable child and prove exact seed/verify behavior, stale detection, fixture ownership, vector/document checks, opportunity absence, and restore-state invariants with provider seams mocked.

### 13.3 Operational validation

After all deterministic and guarded database gates pass:

1. Provision and attest the base read replica and atomically migrate `DISCOVERY_TARGETS`.
2. Explicitly confirm and refresh the protected base if stale.
3. Verify the base provider-free through the read replica.
4. Run `historical/builder-and-operator` × intent × one repetition.
5. Run `historical/builder-and-operator` × enrichment × one repetition.
6. If both are complete, run five cases × both triggers × one repetition: ten slots.

Every smoke and pilot slot has one attempt. Exit `3`, missing evidence, or incomplete evidence means no quality verdict and no automatic rerun.

## 14. Completion criteria

IND-638 is complete when:

- both PRs are merged into `dev` with required versioning;
- all PR and merge-commit workflows pass;
- merged-tree audits have no Critical or Important findings;
- the shared prompt and committed derived text have independent pooled-combination approval;
- provider-free and guarded disposable-database tests pass;
- the base is verified through the attested read replica;
- one intent smoke and one enrichment smoke complete with one attempt each;
- the ten-slot pilot produces ten terminal quality rows and a readable stage-funnel report;
- no quality target is required;
- Linear evidence records exact revisions, commands, artifact location, completeness, and residual risks;
- all merged implementation worktrees and branches are cleaned.

## 15. Known residual risks

- All five case combinations remain medium-recognizability even after anonymization; the pooled combination requires fresh review.
- Positive candidates may retain order characteristics in underlying fixtures; metrics must not infer quality from fixture order.
- Embeddings are provider/configuration dependent; attestation makes the exact protected-base state comparable but not portable across an intentional refresh.
- Parent read-replica verification and child reset have a control-plane time-of-check/time-of-use window; retained child verification is the compensating check.
- The ten-slot pilot provides one observation per case/trigger and is not a stability or significance study. Later issues own expansion and canonical repeated measurements.
