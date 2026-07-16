# HyDE evidence-v2 retrieval eval (IND-426)

This harness compares `legacy` and `frame-v1` HyDE retrieval and grounding. It is a
frozen, paired evidence study, not a production traffic replay or an opportunity-quality
eval. `eval:matching` invokes `OpportunityEvaluator` directly and remains only a secondary
evaluator-regression check; it cannot establish HyDE retrieval quality.

The evidence-v2 work changes the eval harness and its artifacts only. The production HyDE
agents, graph, feature flag, persistence, and retrieval behavior are unchanged.

## Frozen corpus and execution contract

The reviewed background-only corpus contains **90 cases and 900 candidates** across the
existing five drift strata. Every stratum retains at least 15 cases:

1. `profile-context-contamination`
2. `entity-location-substitution`
3. `time-numeric-scale`
4. `credential-organization-exclusivity`
5. `role-polarity-controls`

The primary cohort is 75 independently reviewed **saved-intent** cases. Their source text
is a stored intent processed asynchronously by background discovery. The secondary cohort
is 15 independently authored **user-context** cases: premise-derived, network-scoped
context paragraphs matched only against other users' active intents. Context cases never
carry `profileContext`, never use the profile-contamination stratum, and all their
candidates use the `intents` corpus. There is no manual or direct-search cohort.

Every frozen case has exactly 10 candidates: two graded positives (grades 3 and 2), four
linked minimal-pair hard negatives, and four distractors. The manifest fixes this exact
90/900, 75/15 source mix and 10/2/4/4 case layout.
Authored roles, links, and grades are construction labels used to validate and fingerprint
the corpus. They are **not** canonical retrieval truth; canonical metrics use resolved,
independent human adjudication.

For fidelity to the current `FromIntentQueue` -> `OpportunityGraph` implementation, the
runner maps product source `saved-intent` to graph `sourceType: 'query'`. Here `query` is
only the name of an internal graph branch fed the stored intent payload; it does **not**
represent a synchronous user request. Product source `user-context` maps to graph
`sourceType: 'context'` with a stable synthetic source ID. The private collection
provenance and every paired block record both names. Public blind adjudication records
neither. Removing or renaming the direct-search product path must preserve this background
saved-intent branch or intentionally migrate its mapping and this eval contract. Every
saved-intent run receives the same context shape as the production branch: the trigger
source appears under `Active intents:`, and an authored profile-contamination sentence,
when present, appears as the global `Context:` paragraph. User-context cases continue to
omit `profileContext` because the production `context` branch does not pass one.

For each case, the collector embeds its candidate pool once and shares those embeddings
across both modes and all runs. It then invokes the real production `LensInferrer`,
`HydeGenerator`, `HydeGraphFactory`, and frame-v1 `HydeValidator` with
`forceRegenerate: true`, an empty cache, and an empty in-memory graph database. The
agents and graph are not modified or replaced. The canonical retrieval approximation is
fixed at:

- cosine qualification cutoff: exactly `0.30`, matching the live background graph;
- score bonus: `0.1` for every additional qualifying lens match, capped at 1;
- maximum inferred lenses: `3`;
- configured **primary** lens-inferrer, generator, and validator model IDs pinned to
  `google/gemini-2.5-flash`;
- configured **primary** OpenRouter embedding configuration pinned to
  `openai/text-embedding-3-large`, 2000 dimensions, float encoding.

These pins identify configured primary IDs, not the provider/model that ultimately served
an individual request. Production retry and fallback behavior is intentionally retained;
the production call boundary does not expose per-call fallback identity, so artifacts and
reports explicitly record it as unavailable rather than claiming it was observed.

The canonical study uses four paired runs per case (360 case/run pairs, 720 mode slots).
A fixed case/run hash globally orders execution and assigns exactly two `legacy ->
frame-v1` and two `frame-v1 -> legacy` orders per case. Candidate embedding failures and
mode failures are recorded as explicit failed slots. There are no eval-level retries, no
dropped failures, and no success-only run selection. If concurrent per-lens generation
fails, the recording wrapper waits for every already-started generator call to settle
before freezing failed-slot resources, preventing late calls from disappearing or
spilling into the next mode. Frame extraction is returned through the lens-inferrer
interface and cannot be timed or counted separately without changing production agents.

## Blinded adjudication rubrics

### Candidate relevance (0-3)

Judge how relevant the candidate is to satisfying the source:

- **0 — not relevant:** does not satisfy the source, including a role, entity, location,
  time, scale, credential, organization, or exclusivity mismatch.
- **1 — weak:** some connection exists, but important needs or constraints are missing.
- **2 — relevant:** materially satisfies the source with only minor omissions.
- **3 — highly relevant:** directly and strongly satisfies the source and its important
  constraints.

### Generated-document grounding

Judge every factual detail in the generated document against `sourceText` alone:

- **supported:** every generated fact is supported by the source text; generic wording or
  a complementary/target voice is not itself an unsupported fact; `unsupportedAdditions`
  must be exactly empty;
- **unsupported:** at least one generated fact is absent from or contradicts the source;
  record at least one category, excerpt, and rationale in `unsupportedAdditions`;
- **unable:** the blinded text is too ambiguous to decide. `unable` never resolves by
  agreement, requires a blind resolver decision, and has exactly empty additions.

`profileContext` may influence production lens selection, but it is not evidence for a
generated fact. It is not included as support in the public adjudication task.

The public batch exposes only opaque IDs, task kind, rubric, `sourceText`, and the candidate
or generated `itemText` (plus artifact fingerprints). It excludes mode, run, background source, internal graph source, production validator
output, map/return status, authored labels, and private locators. The private
HMAC mapping key reconnects opaque IDs to candidates and generated-document mode/run
locations. `export` writes it with permission mode **0600**. Keep it out of source control
and do not give it to adjudicators or the blind resolver.

Canonical proof requires two distinct, complete, independently attested **human** judgment
artifacts over the entire public batch, followed by blind resolver decisions for every
candidate disagreement and every grounding disagreement or `unable`. Production
`HydeValidator` output appears only in a labeled noncanonical diagnostic appendix and
never rewrites human labels. An optional judgment artifact with
`adjudicatorKind: "llm-triage"` can help triage the workload, but it is explicitly
noncanonical and can never count as either human adjudicator or otherwise satisfy
canonicality. Adjudicator IDs and independence attestations are process assertions, not
authenticated identities or cryptographic proof that two different people authored the
files. The study operator must verify reviewer identity and independence outside this CLI
and preserve that review record with the evidence artifacts.

## Staged CLI

Run from `packages/protocol`. Live collection loads `../../.env.test`, calls external
language and embedding providers, and requires `OPENROUTER_API_KEY`. Unit tests are
provider-free. The artifact directory below is under the gitignored `runs/` tree.

### 1. Validate and list

```bash
cd packages/protocol
ART=eval/hyde/runs/evidence-v2
mkdir -p "$ART"

bun run eval:hyde -- validate-corpus
bun run eval:hyde -- list-cases
bun run eval:hyde -- list-cases --case profile-context-contamination/
```

### 2. Collect the full canonical candidate

```bash
bun run eval:hyde -- collect \
  --out "$ART/collection.json" \
  --runs 4 \
  --study-id hyde-evidence-v2
```

Omitting `--runs` also selects the canonical four runs. `--case` and other run counts are
for debugging and make collection noncanonical. Canonical collection also requires the
committed configured-primary model/embedding pins and a clean, identifiable Git revision. Collection never
retries failures. Avoid `--force` for canonical collection: its use is recorded as a
noncanonical reason.

### 3. Export public batch, private key, and item template

```bash
bun run eval:hyde -- export \
  --collection "$ART/collection.json" \
  --public "$ART/public-batch.json" \
  --private-key "$ART/private-key.json" \
  --template "$ART/judgment-template.json"
```

Export is an early evidence guard. Its shared collection preflight checks the frozen
corpus/order/fingerprint, exact config/policy/pinned configured-primary provenance, clean
Git provenance, config fingerprint, exact saved-intent -> query and user-context -> context
mapping, and schedule; exactly 90 successful embedding setups and 360 complete paired
blocks; and every run's authored score order/coverage, metadata,
qualification formula, matched-lens integrity, stable ranking, and generation diagnostic
counts. It prints all discovered reasons instead of stopping at the first. This avoids
spending adjudication effort on evidence already known to be unusable. `buildBlindExport`
also independently rejects noncanonical collections, any embedding setup failure, and any
failed or missing mode slot. The item template supplies opaque IDs and null label fields;
it is not itself a valid judgment artifact.

Each output file is atomically replaced, but the public batch, private key, and template
are **not** written as a transactional three-file set. Rerunning `export --force`
regenerates the secret and opaque IDs. Preserve, move, and review all three files as one
set; after a partial write, rerun the complete export rather than mixing generations.

### 4. Produce two independent human judgments

Each human works independently from `public-batch.json`, without the private key or
production diagnostics, and saves a complete artifact such as
`human-a.json`/`human-b.json`:

```json
{
  "artifactType": "hyde-independent-judgment",
  "schemaVersion": "hyde-evidence-artifact-v4",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "adjudicatorId": "human-a",
  "adjudicatorKind": "human",
  "batchFingerprint": "COPY_FROM_PUBLIC_BATCH",
  "blindedIndependentAttestation": true,
  "judgments": [
    { "opaqueId": "blind-...", "taskKind": "candidate-relevance", "relevanceGrade": 3 },
    {
      "opaqueId": "blind-...",
      "taskKind": "generated-document-grounding",
      "grounding": "unsupported",
      "unsupportedAdditions": [
        {
          "category": "location",
          "excerpts": ["invented location"],
          "rationale": "The location is absent from sourceText."
        }
      ]
    }
  ]
}
```

Every public item must appear exactly once with the matching task kind. Supported/unable
grounding entries use `unsupportedAdditions: []`.

Optionally create a separate artifact with `adjudicatorKind: "llm-triage"` and a unique
adjudicator ID. It may be passed to `resolve` for diagnostics, but it is noncanonical and
never substitutes for either human file.

### 5. Blindly resolve disagreement and `unable`

The resolver uses opaque IDs, the public batch, and the human judgments, but not the
private key or production diagnostics. Create `resolver.json` containing decisions only
for disagreements and `unable` labels. A decision for an agreed, missing, extra, or
otherwise unused item makes resolution explicitly incomplete and noncanonical:

```json
{
  "artifactType": "hyde-resolver-decisions",
  "schemaVersion": "hyde-evidence-artifact-v4",
  "createdAt": "2026-01-02T00:00:00.000Z",
  "resolverId": "blind-resolver",
  "batchFingerprint": "COPY_FROM_PUBLIC_BATCH",
  "decisions": [
    {
      "opaqueId": "blind-...",
      "taskKind": "candidate-relevance",
      "finalRelevanceGrade": 2,
      "rationale": "Blind resolution rationale."
    },
    {
      "opaqueId": "blind-...",
      "taskKind": "generated-document-grounding",
      "finalGrounding": "unsupported",
      "unsupportedAdditions": [
        {
          "category": "organization",
          "excerpts": ["invented organization"],
          "rationale": "The organization is absent from sourceText."
        }
      ],
      "rationale": "Blind resolution rationale."
    }
  ]
}
```

Resolve with both human files and, if created, the optional triage file:

```bash
bun run eval:hyde -- resolve \
  --batch "$ART/public-batch.json" \
  --judgment "$ART/human-a.json" \
  --judgment "$ART/human-b.json" \
  --judgment "$ART/llm-triage.json" \
  --resolver "$ART/resolver.json" \
  --out "$ART/resolved.json"
```

Omit the `llm-triage.json` line when no triage artifact was created. If the initial
resolve reports unresolved items, add the required opaque resolver decisions and rerun to
a new output path (or use `--force` only for the derived output).

### 6. Analyze

```bash
bun run eval:hyde -- analyze \
  --collection "$ART/collection.json" \
  --private-key "$ART/private-key.json" \
  --resolved "$ART/resolved.json" \
  --judgment "$ART/human-a.json" \
  --judgment "$ART/human-b.json" \
  --judgment "$ART/llm-triage.json" \
  --resolver "$ART/resolver.json" \
  --out "$ART/analysis.json"
```

Pass the same complete set of judgment artifacts used by `resolve` (at least the two human
files), and pass `--resolver` exactly when resolver decisions were used. Omit the optional
triage and resolver lines when those sources did not exist. Analysis regenerates the
public batch from the collection/private key, strictly reparses these sources, reruns
resolution with the recorded timestamp, and deep-compares the result and immutable sorted
source fingerprints/IDs/kinds. A hand-authored `resolved.json` therefore cannot assert its
own canonical human provenance. The analysis schema also recomputes every gate's policy,
bound, status, canonical order, and overall status from metrics/canonicality, and rejects
a hand-edited PASS that conflicts with completeness, adjudication, metric availability,
or canonical bootstrap provenance.

### 7. Render JSON and Markdown reports

```bash
bun run eval:hyde -- report \
  --analysis "$ART/analysis.json" \
  --collection "$ART/collection.json" \
  --private-key "$ART/private-key.json" \
  --resolved "$ART/resolved.json" \
  --judgment "$ART/human-a.json" \
  --judgment "$ART/human-b.json" \
  --judgment "$ART/llm-triage.json" \
  --resolver "$ART/resolver.json" \
  --json "$ART/report.json" \
  --markdown "$ART/report.md"
```

Omit optional triage/resolver inputs exactly as for `analyze`. `report` recomputes the
analysis from every supplied parent and refuses a standalone analysis artifact that does
not match, so an internally consistent hand-edited PASS file cannot be rendered as
canonical evidence. All output stages refuse to overwrite existing files unless `--force`
is supplied, and even `--force` cannot target an input artifact path.

Artifacts remain unsigned JSON. Raw per-lens cosines are retained so qualification,
max-cosine, bonus, and ranking derivations can be recomputed, but embeddings are not stored
and coordinated edits to all parent artifacts remain outside schema verification.
Canonical review therefore depends on external custody, authenticated reviewer records,
and comparing the preserved fingerprints.

### Exit codes

- `0`: command succeeded; for analyze/report, all eight gates pass.
- `1`: complete canonical evidence was analyzed, but at least one gate failed.
- `2`: CLI argument, artifact validation, I/O, or execution error.
- `3`: incomplete, noncanonical, or otherwise insufficient evidence. Collection also
  returns 3 when it records any noncanonical reason; resolve returns 3 until complete
  canonical human adjudication exists.

## Metrics

All retrieval grades and grounding labels below come from resolved human adjudication.
Metrics are computed per paired case/run:

- **Tie-fractional Precision@5:** number of grade-positive candidates in the top five,
  divided by five. If a score tie crosses rank 5, each tied candidate receives its
  fractional probability of occupying the remaining slots.
- **Graded nDCG@5:** gain is `2^grade - 1` with logarithmic discount. Boundary and
  within-ranking ties use expected DCG across tied positions, not candidate ID/order.
- **Hard-negative FPR@5:** fraction of authored linked hard negatives that remain resolved
  grade 0 and appear in the top five, with the same fractional tie handling.
- **Positive-to-nearest-linked-hard-negative margin:** for each resolved positive with
  linked grade-0 hard negatives, its raw maximum cosine minus the largest raw maximum
  cosine of those linked negatives, then averaged. Bonus-adjusted rank scores are not used.
- **Unsupported generated-document rate:** human-unsupported generated documents divided
  by all generated documents for that mode; an empty generated set is 0.
- **Returned exposure / grounding-error rate:** human-unsupported returned documents
  divided by all returned documents; a no-return run is 0 exposure. That zero cannot hide
  retrieval collapse because all-rejected and retrieval metrics are reported and gated
  separately.
- **Frame all-rejected rate:** submitted frame-v1 validator cohorts where every submitted
  document is rejected and none is returned.
- **Frame failed-open rate:** failed-open frame-v1 documents divided by submitted frame-v1
  documents (0 when none were submitted).
- **Background-source diagnostics:** non-gating coverage plus point estimates for all six
  paired metrics and two frame-only metrics, reported separately for the 75 saved-intent
  and 15 user-context cases. Overall gates still use all frozen cases.
- **Completeness:** failed, missing, and incomplete paired slots/rates. Any incomplete pair
  makes intervals, every gate, and the overall result insufficient.
- **Timing/resources:** candidate-embedding setup timing; attempted/completed/failed mode
  runs; generated, returned, overwritten, rejected, failed-open, all-rejected, and empty
  generation counts; production-wrapper call/input/outcome counts and p50/p95/mean
  duration. Canonical token/cost data, per-call provider/fallback identity, and separate
  frame-extraction resource data are unavailable.

## Confidence intervals

The deterministic hierarchical paired bootstrap uses 10,000 replicates, a fixed committed
seed, and 95% R-7 percentile intervals. The analysis API retains diagnostic/test overrides,
but any other replicate count or seed makes every gate and the overall result insufficient;
the CLI exposes no bootstrap override. Within each exact stratum, cases are sampled with
replacement; paired run observations are then sampled with replacement within each
selected case, preserving the legacy/frame-v1 pairing. Aggregation is equal-weight
run -> case -> stratum, followed by an equal-weight macro average across the five strata.
Frame-only scalar rates use the same case/run hierarchy and equal-stratum macro weighting.

## The eight release gates

These are the **only** gates. Bounds refer to 95% confidence intervals and delta is
`frame-v1 - legacy`:

1. grounding-error delta upper bound **< 0**;
2. frame-v1 grounding-error upper bound **<= 0.05**;
3. Precision@5 delta lower bound **>= -0.05**;
4. nDCG@5 delta lower bound **>= -0.05**;
5. raw-cosine margin delta lower bound **>= -0.03**;
6. hard-negative FPR@5 delta upper bound **<= 0.02**;
7. frame-v1 all-rejected upper bound **<= 0.05**;
8. frame-v1 failed-open upper bound **<= 0.02**.

There are no extra release gates. If any pair, canonical provenance, private mapping,
resolved label, two-human attestation, or required metric is incomplete/noncanonical,
all eight gate statuses and the overall status become `INSUFFICIENT`, not pass or fail.

## Limitations

- The corpus is frozen and local; it is not a production sample.
- This component study does not execute BullMQ, network scoping, database persistence or
  reuse, raw-context fallback, candidate merging, negotiation, or delivery. It tests the
  HyDE generation/retrieval component used inside those background jobs.
- The in-memory retrieval adapter approximates production scoring but omits SQL
  per-lens/per-corpus limits and cross-row user grouping. Production and
  eval scoring intentionally compare every returned lens against both intent and premise
  candidates; a lens target corpus is a production preference/limit-allocation hint, not
  a corpus filter.
- Embeddings cannot be recomputed from collection artifacts. Collection artifacts retain
  every per-lens cosine, allowing analysis to recompute max cosine, cutoff qualification,
  bonus, and exact stable ranking, but they cannot prove that the retained cosines came
  from the underlying vectors.
- Language and embedding provider variance remains despite fixed execution/bootstrap
  schedules and configured-primary provenance pins. Production retries/fallbacks remain
  enabled, while the actual per-call provider/model identity is unavailable and unrecorded.
- Fully blinded, independent human relevance and grounding review is expensive; LLM
  triage cannot reduce the canonical two-human requirement. Reviewer IDs/attestations are
  not authenticated by the CLI and require external operator verification. Human grades remain truth: if
  they show that the frozen corpus no longer has the required positives or linked hard
  negatives, evidence becomes insufficient rather than relabeling those judgments.
- There is no synchronous direct-search cohort; `query` in private artifacts is solely the
  current internal graph source used by saved-intent background processing.
- The study does not establish production opportunity precision, recall, fairness, or
  external validity. `eval:matching` is only the secondary evaluator-only check.
- Canonical token use, provider cost, and separately observable frame-extraction resource
  data are unavailable at the collection boundary.
- JSON artifacts are unsigned; fingerprints require trusted external custody to protect
  against coordinated edits to all parents.
- Multi-file export is not transactional even though each replacement is atomic, and
  `export --force` regenerates opaque IDs. Preserve the public/private/template outputs as
  one generation.
- Run artifacts are gitignored; no run artifact or baseline is committed, and there is no
  baseline-update path. Preserve reviewed artifacts privately with their fingerprints.
