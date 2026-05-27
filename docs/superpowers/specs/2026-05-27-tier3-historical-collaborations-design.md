# Tier-3 Historical Collaborations — Design

**Status:** Approved for planning
**Date:** 2026-05-27
**Component:** `packages/protocol/eval/matching/` (matching quality eval harness)
**Related:** `project_matching_eval_harness` (memory); README "Future (Tier 3)" section

## Goal

Add a tier of golden cases built from real, well-documented collaborations that
demonstrably produced something great — recreated as the people looked *before* they
connected — and assert that the opportunity evaluator would have surfaced the eventual
partner over plausible contemporaries who were around at the same time.

Tiers 1 and 2 use synthetic minimal-pairs and personas: they prove the evaluator obeys
specific rules. Tier 3 asks a harder, more meaningful question — *would the protocol have
found a connection we know in hindsight was excellent?* The ground truth is not a label we
assigned; it is history: this connection actually happened and worked.

## What we are measuring (and what we are not)

We measure whether, given a realistic candidate pool, the evaluator ranks the genuinely
complementary partner above plausible-but-wrong alternatives — on profile and intent fit,
not on name recognition.

We are **not** measuring the model's memory of famous people. Because gemini-2.5-flash
recognizes these collaborations, naming the real people would let it match on fame rather
than fit, inflating scores into meaninglessness. The entire validity of this tier rests on
anonymization (see below).

## Case shape

Each case is one `MatchingCase` whose `input.entities` contains five anonymized people:

```
entities = [ discoverer, realPartner, distractorA, distractorB, distractorC ]
expect:
  realPartner  -> match: true,  scoreBand: [60, 100]   # clearly above the 30 surfacing floor
  distractorA  -> match: false, scoreBand: [0, 29]
  distractorB  -> match: false, scoreBand: [0, 29]
  distractorC  -> match: false, scoreBand: [0, 29]
```

The existing per-candidate band model already expresses "the partner surfaces, the
distractors don't" — **no scorer or runner change is needed.** All five people sit in one
shared, thematically-relevant index, so network membership alone never separates them; the
evaluator has to discriminate on fit.

If the real partner scores below 60 (or, worse, below 30 and fails to surface), that is a
**recorded finding** about the evaluator under-valuing a strong match — not a corpus bug.
That asymmetry is the point: a low partner score is exactly the kind of weakness this tier
exists to expose.

### The `[60, 100]` band is deliberately lenient to start

The prompt's own scale puts a primary-role match at 90–100 and a "should meet" at 70–89. A
genuine historical match should land there. We set the floor at 60 for the first baseline to
absorb model variance; a partner landing in 60–69 is itself a mild finding worth noting. The
band can be tightened to `[70, 100]` once we see where the model actually lands.

## Anonymization and provenance

- Real names and uniquely-identifying specifics are stripped. Each entity carries only the
  structural pre-connection signal: situation, skills, interests, location, and the seeking
  intent — described the way a contemporary profile would read, with no hindsight.
- The shared index is anonymized too: described by its purpose and theme, never named.
- A code comment above each case records the real identities, the outcome, and the
  approximate year, so the ground truth stays auditable. The comment never enters the model
  input.
- Profiles are **hand-authored from well-documented public facts.** No LLM-generated bios —
  consistent with the project's standing rule against fabrication. Where a "before" fact is
  uncertain, we author conservatively (omit rather than invent).

## Distractors must fall into a real reject category

A distractor only legitimately scores below 30 if it triggers one of the evaluator's actual
reject rules (clauses 7–9 of `entityBundleSystemPrompt`). So each case's three distractors
are drawn from these archetypes, not merely "someone worse":

1. **Same-side** (clause 8): a person seeking the *same* thing the discoverer seeks (e.g.,
   another operator also looking for a technical builder). An opportunity needs one side to
   offer what the other seeks; two seekers are not a match.
2. **Complementary / non-substitutive role** (clause 7): a person whose role enables the
   sought relation from outside it but cannot fill it (e.g., for a founder seeking a
   co-builder, someone who would only advise or fund, not build).
3. **Plausible-but-misaligned fit**: a credible community co-member whose skills or intent
   genuinely don't complement the discoverer (e.g., a hobbyist who tinkers for fun with no
   interest in partnering or shipping).

These are same-era, same-domain, and comparable on the surface — they are people who
*could* have been the match but weren't the right fit. A distractor from an unrelated field
would make the test trivially easy and is not allowed.

## Shared community context (no schema change)

The evaluator already consumes network context through two existing fields:

- `EvaluatorEntity.networkId` — the index each person was found through; rendered per entity
  as `INDEX: <id>`.
- `EvaluatorInput.networkContexts?: Record<string, string>` — pre-rendered markdown
  describing each index's purpose/theme; rendered under a `NETWORK CONTEXTS:` block. Prompt
  rule 10 reads it for theme alignment and co-attendance signal.

Each case sets all five people's `networkId` to one shared anonymized index and provides a
matching `networkContexts` entry describing that community structurally. This mirrors how
Index grounds real matches in shared communities and makes the distractors harder — they are
plausible co-members, not strangers.

**One exception (case 5):** one distractor is surfaced via a *different, less-relevant
adjacent index* to confirm that weak network relevance does not rescue a poor fit. The other
four cases use the single-shared-index design.

## Seeking signal

The "what they were looking for before" is modeled as the **discoverer's intent payload**,
not a typed `discoveryQuery`. These situations were historically ambient ("who should I
partner with?"), not active text queries, and using an intent avoids entangling this tier
with the query-primacy rule. Each case is authored from **one direction** — whichever side
has the clearer pre-connection seeking intent.

Note: the evaluator masks the discoverer's name to `(source user)` automatically, so the
discoverer is already partly anonymized by the harness; we still anonymize the bio.

## The five collaborations

Each entry lists: the discoverer (seeker), the real partner (the match), the shared index
theme, the three distractor archetypes, and the expected partner role. All names below are
for the provenance comment only and never enter the input.

### 1. Hardware builder + commercial operator → cofounders
*Real: Steve Wozniak + Steve Jobs, Apple, ~1976. Provenance comment only.*

- **Discoverer (seeker):** A young commercial operator who runs a small electronics resale
  side business and is convinced affordable personal computers can be sold to individuals.
  Intent: find a brilliant hardware engineer to build a sellable personal-computer product
  with.
- **Real partner:** A gifted hardware engineer who designs terminal and computer circuit
  boards for fun and shares his designs at a hobbyist club; not commercially driven on his
  own.
- **Shared index:** A hobbyist club for people building personal computers from parts —
  members swap circuit designs and believe computing should reach individuals. *(Real:
  Homebrew Computer Club.)*
- **Distractors:** (a) same-side — another operator/promoter also looking for a technical
  builder to commercialize; (b) complementary — a parts distributor who supplies components
  but won't co-build; (c) misaligned — a hobbyist who tinkers purely for fun, no interest in
  shipping a product.
- **Expected partner role:** `agent` — the builder provides the technical capability the
  operator's intent seeks; the operator (discoverer) is the patient. This matches the existing
  Tier-2 cofounder convention, where `p-tech-cofounder` is asserted `agent`. The intent is
  framed directionally ("find a hardware engineer to build"), so this is provider/seeker, not
  a symmetric peer split.

### 2. Two co-researchers cracking a molecular structure → landmark paper
*Real: James Watson + Francis Crick, DNA structure, ~1953. Provenance comment only.*

- **Discoverer (seeker):** A biologist with access to diffraction data and a conviction the
  molecule's structure is solvable, seeking a model-building collaborator who thinks
  physically about structure.
- **Real partner:** A physics-trained researcher who builds structural models and reasons
  from first principles, looking for a biological problem worth his modeling.
- **Shared index:** A university lab circle racing to determine a key molecule's
  three-dimensional structure. *(Real: the Cavendish Laboratory.)*
- **Distractors:** (a) same-side — another data-driven biologist also seeking a modeler; (b)
  complementary — a lab administrator who enables the work but does no science; (c)
  misaligned — a chemist working on an unrelated reaction mechanism.
- **Expected partner role:** `peer`.

### 3. Songwriting duo, same town, complementary styles → creative partnership
*Real: John Lennon + Paul McCartney, Liverpool, late 1950s. Provenance comment only.*

- **Discoverer (seeker):** A young musician in a port-city club scene with raw energy and
  half-finished songs, looking for a co-writer whose melodic instinct complements his edge.
- **Real partner:** A melodically gifted young musician in the same scene, technically
  fluent, looking for a writing partner with attitude and lyrical ideas.
- **Shared index:** A local skiffle/club music scene in a working-class port city. *(Real:
  Liverpool.)*
- **Distractors:** (a) same-side — another frontman also seeking a co-writer to back him; (b)
  complementary — a club promoter who books acts but doesn't write; (c) misaligned — a
  classically trained musician with no interest in popular songwriting.
- **Expected partner role:** `peer`.

### 4. First-check investor + technical founder → backed company
*Real: an early angel + the technical founder they first funded (e.g., Andy Bechtolsheim's
first check). Provenance comment only.*

- **Discoverer (seeker):** A technical founder with a working prototype out of a university
  spinout scene, seeking a first check and early guidance to turn it into a company.
- **Real partner:** An experienced angel who writes first checks into exactly this domain and
  stage and rolls up their sleeves with founders.
- **Shared index:** An early-stage community around a university spinout scene — technical
  founders and the first-check angels who back them.
- **Distractors:** (a) same-side — another early founder also raising a first round; (b)
  complementary/non-substitutive — a late-stage growth investor who only writes large checks
  at a much later stage (wrong stage; cannot fill the first-check role); (c) misaligned — an
  angel who invests only in an unrelated sector.
- **Expected partner role:** `agent` (the investor provides capital/help; the founder is the
  patient).

### 5. Domain expert + ML researcher → cross-disciplinary breakthrough
*Real: a structural-biology domain expert + a deep-learning researcher (e.g., the
AlphaFold-style pairing). Provenance comment only.*

- **Discoverer (seeker):** A deep-learning researcher with a powerful model looking for a
  hard, well-characterized scientific problem and a domain expert to ground it in reality.
- **Real partner:** A domain expert in a structural science with deep problem knowledge and
  curated data, looking for modeling firepower they lack in-house.
- **Shared index:** An interdisciplinary consortium applying machine learning to a hard
  scientific problem.
- **Distractors:** (a) same-side — another ML researcher (a mirror of the discoverer; tests
  that the evaluator prefers the complementary expert over a same-side peer); (b) misaligned
  — a domain expert in an unrelated science; (c) **adjacent-index** — a generalist data
  analyst surfaced via a *different, less-relevant* index, to confirm weak network relevance
  does not rescue a poor fit.
- **Expected partner role:** `peer`.

### Role-assertion policy

Partner roles follow the established corpus convention: `agent` for the directional-provider
cases (1 builder, 4 investor — the candidate supplies what the discoverer's intent seeks),
`peer` for the symmetric-collaboration cases (2 co-researchers, 3 songwriters, 5
cross-disciplinary co-discovery). The existing Tier-2 corpus already asserts `agent` for the
technical cofounder and `peer` for the event co-attendance match, so these align. Per the
diagnosing-matching-eval philosophy, if a debatable role call proves *systematically* wrong on
a high-run pass without indicating a real defect, relax that one assertion to unset rather
than leaving the tier permanently red. Match and band assertions are never relaxed this way.

## Schema changes (minimal, additive)

1. `matching.types.ts`:
   - Widen `MatchingCase.tier` from `1 | 2` to `1 | 2 | 3`.
   - Add `"historical"` to the `Rule` union.
2. New file `matching.historical.ts` exporting `HISTORICAL_CASES: MatchingCase[]` (the five
   cases plus their `networkContexts`). Keeps the narrative-heavy cases out of the surgical
   `matching.cases.ts`.
3. `matching.cases.ts`: import and spread `HISTORICAL_CASES` into the exported `CASES` array.

The reporter groups by `rule`, so `historical` appears as its own scorecard row, and
`--rule historical` runs just these cases. No CLI, scorer, runner, or reporter logic changes.

## Testing and rollout

- Existing scorer/runner/reporter unit tests are unchanged and must still pass.
- Author cases, then read the result:
  `bun run eval:matching -- --rule historical --report --runs 7`
- Analyze any underperformance with the `diagnosing-matching-eval` skill (the `--report`
  artifact carries the evaluator's verbatim reasoning). Calibrate bands/roles per the
  policies above only where a finding is corpus-side, not evaluator-side.
- Commit the baseline: `bun run eval:matching -- --update-baseline` (full corpus, so the new
  rule is captured alongside the existing ones).
- Bump protocol `1.22.0 → 1.23.0` (minor: additive corpus + widened types).
- Update the README Tier-3 section from "Future" to implemented, and refresh the
  `project_matching_eval_harness` memory note.

## Non-goals (YAGNI)

- No new "rank" assertion type (real-partner-strictly-greater-than-all-distractors). The
  independent per-candidate bands already express the intent; a dedicated rank assertion is
  unnecessary complexity for now.
- No automated scraping or generation of historical profiles. Five hand-authored cases.
- No change to the evaluator prompt as part of this work. If Tier 3 surfaces an evaluator
  weakness, that is a separate, evidence-backed effort.
```
