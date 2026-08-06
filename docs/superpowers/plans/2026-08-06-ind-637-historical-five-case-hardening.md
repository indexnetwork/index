# IND-637 Historical Five-Case Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the five speculative historical fixtures with independently reviewed, citation-complete, anonymized cases that satisfy the HDQ1 provenance and projection contracts without a live model or database run.

**Architecture:** Extend the provider-free HDQ1 contract to distinguish cited historical facts, citation-derived wording, and explicitly authored synthetic-negative text. Author each audited case in its own focused module, review all five from fresh context, then expose one canonical aggregate through the existing matching and discovery-matrix adapters.

**Tech Stack:** Bun, TypeScript strict mode, Bun test, existing matching/discovery eval contracts, provider-free web-source review.

## Global Constraints

- Preserve the five existing case IDs and participant IDs. Descriptive case IDs remain control-plane metadata and never enter an LLM prompt; anonymous participant IDs remain the evaluator’s stable entity keys.
- Keep exactly one historical source participant, one documented historical partner, and three synthetic semantic hard negatives per case.
- Every model-facing statement about a historical participant must resolve to cited pre-connection evidence.
- Synthetic candidate text must be explicitly authored and tied to its violated requirement; never attach fake historical citations to synthetic people.
- The collaboration cutoff is exclusive. Remove facts whose ordering cannot be established.
- Outcome evidence must include at least one citation not used for cutoff or pre-connection claims.
- Larry Page alone is `h4-a`; Sergey Brin may appear only as anonymized, cited context.
- Frozen intent, premise, and user-context text must be deeply immutable.
- Real names, URLs, excerpts, exact dates, unique institutions/projects/products/papers/songs, reviewer metadata, labels, and outcome language are report-only.
- No live model, embedding, Redis, Neon, or database command is allowed.
- Do not update a baseline or run artifact.
- Use one writer in `/home/yanek/Projects/index/.worktrees/test-historical-case-hardening`.

---

## File Structure

### New files

- `packages/protocol/eval/matching/historical/historical.case-01.ts` — Jobs/Wozniak evidence and anonymized electronics co-exploration fixture.
- `packages/protocol/eval/matching/historical/historical.case-02.ts` — Watson/Crick evidence and anonymized structural-research fixture.
- `packages/protocol/eval/matching/historical/historical.case-03.ts` — Lennon/McCartney evidence and anonymized local-group guitarist fixture.
- `packages/protocol/eval/matching/historical/historical.case-04.ts` — Page/Bechtolsheim evidence with Larry Page as sole source.
- `packages/protocol/eval/matching/historical/historical.case-05.ts` — Karikó/Weissman evidence and anonymized RNA/immunology fixture.
- `packages/protocol/eval/matching/tests/historical.case-01.spec.ts` through `historical.case-05.spec.ts` — one provider-free contract test per independently reviewable case.
- `docs/research/2026-08-06-historical-five-case-review.md` — committed independent citation/provenance/anonymization review receipt.

### Modified files

- `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts` — provenance variants, participant origin, strict/pending review modes, matching projection, deep-freeze helper.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts` — mutation tests for the extended contract.
- `packages/protocol/eval/matching/matching.historical.ts` — canonical five-case aggregate and compatibility projection; remove the old inline corpus.
- `packages/protocol/eval/matching/tests/matching.historical.spec.ts` — five-case integration, stable IDs, source identity, projection leakage.
- `packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts` — adapt audited frozen intents directly; delete speculative reconstruction table.
- `packages/protocol/eval/discovery-env-matrix/historical-matrix.types.ts` — replace reconstruction audit fields with frozen intent text.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts` — projection/leakage/freeze integration.
- `services/api/src/cli/discovery-env-matrix.shared.ts` — bump fixture corpus metadata from `historical-matrix-v1` to `historical-matrix-v2` after the corpus changes.
- `services/api/src/cli/tests/discovery-env-matrix.spec.ts` and `discovery-env-matrix-base.spec.ts` — provider-free fixture-version and projection contracts.
- `packages/protocol/eval/README.md` — mark IND-637 corpus migration complete while keeping IND-638 runtime integration pending.
- `packages/protocol/package.json` and `bun.lock` — patch bump `9.2.1` to `9.2.2`.

---

### Task 1: Extend the HDQ1 provenance contract

**Files:**
- Modify: `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts`

**Interfaces:**
- Consumes: existing `MatchingCase`.
- Produces:
  - `HistoricalClaim = HistoricalFactClaim | HistoricalDerivedClaim | HistoricalAuthoredClaim`
  - `HistoricalParticipantKind = "historical" | "synthetic"`
  - `validateHistoricalQualityCase(input, { requireApprovedReview? }): void`
  - `defineHistoricalQualityCase(input): HistoricalQualityCase`
  - `historicalMatchingCaseProjection(input): MatchingCase`

- [ ] **Step 1: Replace the valid fixture with explicit participant and claim kinds**

Use these exact public shapes in the failing spec:

```ts
export type HistoricalParticipantKind = "historical" | "synthetic";

export interface HistoricalFactClaim {
  kind: "historical";
  id: string;
  text: string;
  citationIds: string[];
  preConnection: true;
}

export interface HistoricalDerivedClaim {
  kind: "derived";
  id: string;
  text: string;
  basisClaimIds: string[];
  rationale: string;
}

export interface HistoricalAuthoredClaim {
  kind: "authored";
  id: string;
  text: string;
  participantId: string;
  violatedRequirement: string;
}

export type HistoricalClaim = HistoricalFactClaim | HistoricalDerivedClaim | HistoricalAuthoredClaim;
```

Add `participantKinds` to `HistoricalQualityMetadata`, add `/description` to the claim-bearing paths, and make the fixture’s source/target historical and three negatives synthetic. Replace the projection shape so descriptive control IDs never cross the model boundary while the audited description does:

```ts
export interface HistoricalModelSafeProjection {
  description: string;
  input: MatchingCase["input"];
  triggerInputs: HistoricalQualityMetadata["triggerInputs"];
}

export function historicalModelSafeProjection(input: HistoricalQualityCase): HistoricalModelSafeProjection {
  return {
    description: input.description,
    input: structuredClone(input.input),
    triggerInputs: structuredClone(input.historicalQuality.triggerInputs),
  };
}
```

- [ ] **Step 2: Add focused failing mutations**

Add tests that reject:

```ts
// authored text on a historical participant
input.historicalQuality.claims[sourceIndex] = {
  kind: "authored",
  id: sourceClaim.id,
  text: sourceClaim.text,
  participantId: "p-source",
  violatedRequirement: "Historical source text cannot be authored fixture text.",
};

// historical citations on a synthetic participant
input.historicalQuality.claims[negativeIndex] = {
  kind: "historical",
  id: negativeClaim.id,
  text: negativeClaim.text,
  citationIds: ["citation-pre"],
  preConnection: true,
};

// derived claim with an authored or cyclic basis
sourceDerived.basisClaimIds = [negativeClaim.id];
sourceDerived.basisClaimIds = [sourceDerived.id];

// duplicate, missing, or unknown participant classification
input.input.entities[1]!.userId = input.input.entities[0]!.userId;
delete input.historicalQuality.participantKinds["p-target"];
input.historicalQuality.participantKinds.unknown = "synthetic";

// source or positive marked synthetic
input.historicalQuality.participantKinds["p-source"] = "synthetic";

// authored violated requirement drifting from semanticNegatives
negativeClaim.violatedRequirement = "different reason";

// report name assigned to a synthetic participant
input.reportNames!["p-negative-1"] = "Not a historical identity";

// unapproved review under strict default
input.historicalQuality.anonymizationReview.decision = "pending";
```

Also prove `{ requireApprovedReview: false }` accepts a complete pending-review case while the default rejects it.

- [ ] **Step 3: Run the contract spec and confirm RED**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
```

Expected: TypeScript/runtime failures because the new provenance variants and participant-kind validation do not exist.

- [ ] **Step 4: Implement the minimal validator and projections**

Implement these rules:

```ts
export interface HistoricalValidationOptions {
  requireApprovedReview?: boolean;
}

export function validateHistoricalQualityCase(
  input: HistoricalQualityCase,
  options: HistoricalValidationOptions = {},
): void;

export function historicalMatchingCaseProjection(input: HistoricalQualityCase): MatchingCase {
  return {
    id: input.id,
    rule: input.rule,
    tier: input.tier,
    domains: structuredClone(input.domains),
    description: input.description,
    input: structuredClone(input.input),
    expect: structuredClone(input.expect),
    reportNames: input.reportNames ? structuredClone(input.reportNames) : undefined,
  };
}
```

Reject duplicate entity IDs before constructing participant sets. Require `participantKinds` to cover the entity IDs exactly, the discoverer and sole positive to be historical, and exactly three rejected synthetic participants to be represented by `semanticNegatives`. Use DFS over `basisClaimIds` to reject cycles and require every derived path to terminate only in `historical` claims. Resolve entity JSON-pointer paths back to participant IDs: historical participants may use only historical/derived claims; synthetic participants may use only authored claims whose `participantId` and `violatedRequirement` exactly match `semanticNegatives`.

Add a recursive `deepFreeze` private helper and export:

```ts
export function defineHistoricalQualityCase(input: HistoricalQualityCase): HistoricalQualityCase {
  validateHistoricalQualityCase(input, { requireApprovedReview: false });
  return deepFreeze(input);
}
```

Strict validation remains the default. The pending-review escape is authoring-only and must not be used by the final aggregate.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
bun test eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts \
  packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
git commit -m "test(eval): distinguish historical and authored provenance"
```

### Success Criteria

- Automated: duplicate case/participant IDs, non-exclusive cutoffs, unproved ordering, reused-only outcome citations, missing field provenance, invalid participant cardinality, cross-kind provenance, derived cycles, synthetic report names, and unapproved strict review all fail with deterministic case/path context.
- Automated: mutation coverage removes provenance from `/description`, every historical participant field, source intent, every frozen premise, user context, and network context in turn; each removal fails at that exact path.
- Automated: the valid fixture has exactly one historical source, one historical positive, three synthetic rejected participants, and an independent outcome citation.
- Automated: `historicalModelSafeProjection` contains only generalized description, input, and trigger inputs; audit metadata and descriptive case ID are absent.

---

### Task 2: Re-source case 01 without post-collaboration operator leakage

**Files:**
- Create: `packages/protocol/eval/matching/historical/historical.case-01.ts`
- Create: `packages/protocol/eval/matching/tests/historical.case-01.spec.ts`

**Interfaces:**
- Consumes: `HistoricalQualityCase`, `defineHistoricalQualityCase`, `validateHistoricalQualityCase`.
- Produces: `HISTORICAL_CASE_01` with ID `historical/builder-and-operator` and pending independent review.

**Evidence to encode:**

- Esquire, “Secrets of the Little Blue Box,” https://classic.esquire.com/secrets-of-the-blue-box/ — `“October 1 1971”` establishes the publication trigger.
- NPR, “A Chat with Computing Pioneer Steve Wozniak,” https://www.npr.org/2006/09/29/6167297/a-chat-with-computing-pioneer-steve-wozniak — `“I first found out about blue boxes in an article in Esquire magazine…”`, `“Went with Steve Jobs, determined it was possible. I designed a clever little blue box…”`, and `“I had had a lifetime from fifth grade and sixth grade of building computer projects and building ham radios…”` establish ordering and Wozniak’s prior practice.
- Computerworld, “Steve Jobs interview: One-on-one in 1995,” https://www.computerworld.com/article/1476597/steve-jobs-interview-one-on-one-in-1995.html — `“He showed me the rudiments of electronics and I got very interested in that”` and childhood kit/computer recollections support Jobs’s pre-cutoff electronics familiarity.
- NPR transcript, “Computer Pioneer Steve Wozniak Tells His Story,” https://www.npr.org/transcripts/6179983 — `“I had built a computer … [and] the guy I was building it with said, you should meet … Steve Jobs”` proves prior computer construction.
- Library of Congress, “The Founding of Apple Computer, Inc.,” https://guides.loc.gov/this-month-in-business-history/april/apple-computer-founded — `“Apple Computer, Inc. was founded on April 1, 1976, by … Steve Jobs and Steve Wozniak”` plus the sales-growth excerpt is independent outcome evidence only.

**Final model-facing historical text:**

```ts
const source = {
  bio: "Teenage Northern California electronics hobbyist who learned basic electronics from family and a nearby engineer, assembled build-it-yourself electronics kits, and had early exposure to computers.",
  location: "Northern California",
  interests: ["electronics", "build-it-yourself devices", "computers"],
  skills: ["electronics fundamentals", "kit assembly", "hands-on construction"],
  intent: "Explore an electronics project with a local hobbyist who has deeper circuit-design experience.",
};

const partner = {
  bio: "Young Northern California electronics hobbyist with extensive practice designing computer circuits and building computer and radio projects. Had already built a computer project with a school friend.",
  location: "Northern California",
  interests: ["electronics", "computer design", "amateur radio"],
  skills: ["computer-circuit design", "electronics construction", "technical experimentation"],
  intent: "Apply prior circuit-design experience in an electronics project with another local hobbyist.",
};
```

Use conservative cutoff `{ date: "1971", precision: "year", exclusive: true }`; ordering citations establish that the retained childhood/high-school facts predate the first substantive joint project later in 1971. The October magazine article remains cutoff chronology only and is not a basis for model-facing trigger text. Rewrite the three synthetic negatives around a generic electronics project: same-side beginner without advanced circuit skill; component seller who does not design; radio hobbyist unwilling to collaborate on circuit construction. Do not include personal computers, Homebrew, selling, persuasion, parts sourcing, Apple, Blue Boxes, telephone tones, or later business roles.

- [ ] **Step 1: Write the failing case spec**

Assert ID/participant stability, two historical plus three synthetic participants, strict validation rejection while review is pending, non-review validation success, forbidden-term absence, at least three authored negative reasons, and deep freezing.

- [ ] **Step 2: Run the case spec and confirm RED**

```bash
cd packages/protocol
bun test eval/matching/tests/historical.case-01.spec.ts
```

Expected: module missing.

- [ ] **Step 3: Author the case and exact field provenance**

Map every historical field to historical/derived claims based only on the evidence above. Map every synthetic field to an authored claim with the exact negative requirement. Set review decision to `pending`; do not self-approve.

- [ ] **Step 4: Run the case spec and typechecks**

```bash
bun test eval/matching/tests/historical.case-01.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/matching/historical/historical.case-01.ts \
  packages/protocol/eval/matching/tests/historical.case-01.spec.ts
git commit -m "test(eval): re-source historical electronics case"
```

### Success Criteria

- Automated: cutoff is exactly year-precision `1971`, exclusive, with ordering evidence; all retained historical facts predate the joint project.
- Automated: the October article is cutoff evidence only and model trigger/profiles contain none of its unique project terms.
- Automated: exactly five stable participants exist; `h1-a` and `h1-b` are historical, while `h1-c/d/e` are authored semantic negatives with distinct violated requirements.
- Automated: model-safe text excludes every forbidden post-collaboration/operator term listed above and is deeply frozen.

---

### Task 3: Re-source case 02 without diffraction-data or outcome hindsight

**Files:**
- Create: `packages/protocol/eval/matching/historical/historical.case-02.ts`
- Create: `packages/protocol/eval/matching/tests/historical.case-02.spec.ts`

**Interfaces:**
- Produces: `HISTORICAL_CASE_02`, ID `historical/co-researchers-structure`.

**Evidence to encode:**

- Nobel Foundation, “James Watson – Biographical,” https://www.nobelprize.org/prizes/medicine/1962/watson/biographical/ — zoology degree, phage thesis, Copenhagen fellowship, May 1951 exposure to an X-ray image, August arrangement, and `“started work in early October 1951. He soon met Crick”`.
- Wellcome Collection, “Francis Crick (1916-2004): archives,” https://wellcomecollection.org/works/hz43r7re — Crick’s pre-connection interest in genetic material/protein structure and June 1949 protein-structure work through X-ray crystallography.
- Arizona State Embryo Project, the Watson/Crick 1953 paper history, https://embryo.asu.edu/pages/molecular-structure-nucleic-acids-structure-deoxyribose-nucleic-acid-1953-james-watson-and — `“The collaboration … began in October 1951 soon after Watson arrived…”` establishes the month boundary.
- Science History Institute, https://www.sciencehistory.org/education/scientific-biographies/francis-crick-rosalind-franklin-james-watson-and-maurice-wilkins/ — `“saw some of the X-ray images”` and changed research direction; this does not establish possession of diffraction data.
- Nobel Foundation, “The Nobel Prize in Physiology or Medicine 1962,” https://www.nobelprize.org/prizes/medicine/1962/summary/ — award for discoveries concerning nucleic-acid molecular structure is independent outcome evidence only.

**Final model-facing text:**

```ts
const source = {
  bio: "Young biologist trained in zoology and virus research who recently redirected his work toward the structural chemistry of nucleic acids after seeing X-ray images at a scientific meeting.",
  location: "Continental Europe",
  interests: ["nucleic acids", "molecular structure", "virus research"],
  skills: ["biology", "experimental interpretation", "virus research"],
  intent: "Work with a researcher experienced in physical modeling and crystallographic methods to investigate nucleic-acid structure.",
};

const partner = {
  bio: "Physics-trained researcher in southern England studying protein structure with X-ray crystallography and reading broadly about genetic material and protein structure.",
  location: "Southern England",
  interests: ["genetic material", "protein structure", "molecular structure"],
  skills: ["physics", "X-ray crystallography", "structural analysis"],
  intent: "Apply physical and crystallographic reasoning to a significant biological structure problem.",
};
```

Use cutoff `{ date: "1951-10", precision: "month", exclusive: true }`. Remove “access to diffraction data,” certainty that the structure was within reach, “builds structural models,” restless psychology, and any possession/use of Franklin/Gosling data. Retain synthetic negatives as a same-side experimental biologist, laboratory administrator, and unrelated small-molecule chemist, all explicitly authored.

- [ ] **Step 1: Write the failing case spec** with cutoff, forbidden-data, participant-kind, provenance, pending-review, and freeze assertions.
- [ ] **Step 2: Run RED:** `bun test eval/matching/tests/historical.case-02.spec.ts`.
- [ ] **Step 3: Author the complete case and path-level provenance** from the exact evidence above.
- [ ] **Step 4: Run GREEN and typechecks:**

```bash
bun test eval/matching/tests/historical.case-02.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

- [ ] **Step 5: Commit:**

```bash
git add packages/protocol/eval/matching/historical/historical.case-02.ts \
  packages/protocol/eval/matching/tests/historical.case-02.spec.ts
git commit -m "test(eval): re-source historical structure case"
```

### Success Criteria

- Automated: cutoff is exactly month-precision `1951-10`, exclusive, and every retained Watson/Crick fact resolves to the listed pre-connection sources.
- Automated: model-safe text contains no possession/access claim for diffraction data, no outcome certainty, and no post-meeting work.
- Automated: exactly one historical source, one historical positive, and three distinct synthetic negative requirements validate under pending-review mode.
- Automated: all source/partner trigger, premise, context, and participant text is deeply frozen.

---

### Task 4: Re-source case 03 as evidenced guitarist recruitment

**Files:**
- Create: `packages/protocol/eval/matching/historical/historical.case-03.ts`
- Create: `packages/protocol/eval/matching/tests/historical.case-03.spec.ts`

**Interfaces:**
- Produces: `HISTORICAL_CASE_03`, ID `historical/songwriting-duo`.

**Evidence to encode:**

- National Museums Liverpool, “When Paul McCartney met John Lennon,” https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon — first meeting `6 July 1957`, Lennon’s group leadership/improvised words, McCartney’s tuning/guitar demonstration, and later joint writing.
- JohnLennon.com, “MOTHER… discover more about John’s childhood,” https://www.johnlennon.com/news/mother-%E2%86%92-watch-the-4k-remastered-video-discover-more-about-johns-childhood/ — Lennon learned banjo chords, progressed to guitar, and practiced before the dated performance.
- PaulMcCartney.com, “The Lyrics: 1956 to the Present Special,” https://www.paulmccartney.com/news/you-gave-me-the-answer-the-lyrics-1956-to-the-present-special — `“the first song I ever wrote … when I was fourteen”` establishes pre-meeting songwriting.
- National Trust, “The Beatles | History,” https://www.nationaltrust.org.uk/visit/liverpool-lancashire/the-beatles-childhood-homes/history-of-the-beatles-childhood-homes — `“he'd been looking for a better guitarist for his group”` and the later invitation.
- Guinness World Records, “Most US No.1 singles by a songwriter,” https://www.guinnessworldrecords.com/world-records/69695-most-number-one-singles-by-a-songwriter — later jointly credited number-one singles are independent outcome evidence only.

**Final model-facing text:**

```ts
const source = {
  bio: "Teenage guitarist in northern England who leads an amateur popular-music group and performs at community events. Interested in improving the group’s musicianship.",
  location: "Northern England",
  interests: ["popular music", "guitar", "live performance"],
  skills: ["guitar", "live performance", "group leadership"],
  intent: "Find a capable local guitarist to strengthen an amateur performance group.",
};

const partner = {
  bio: "Teenage popular-music enthusiast in northern England who plays guitar, can tune it, remembers songs accurately, and had already tried writing a song.",
  location: "Northern England",
  interests: ["popular music", "guitar", "early songwriting"],
  skills: ["guitar playing", "instrument tuning", "song recall"],
  intent: "Play and improve at contemporary popular music, including guitar and early songwriting.",
};
```

Use cutoff `{ date: "1957-07-06", precision: "day", exclusive: true }`. Remove port-city/club-circuit combinations, half-finished notebook, edgy-versus-melodic polarity, harmony/arrangement/bass, and mutual co-writer searches. Synthetic negatives become same-side group leader, non-performing promoter, and technically trained musician uninterested in popular group performance.

- [ ] **Step 1: Write the failing case spec** including the exact forbidden terms `bass`, `half-finished`, `melodically gifted`, `co-writer`, and unique group/song/place names.
- [ ] **Step 2: Run RED:** `bun test eval/matching/tests/historical.case-03.spec.ts`.
- [ ] **Step 3: Author the case and provenance.** Treat guitar recruitment as the trigger; keep songwriting success report-only.
- [ ] **Step 4: Run GREEN and typechecks:**

```bash
bun test eval/matching/tests/historical.case-03.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

- [ ] **Step 5: Commit:**

```bash
git add packages/protocol/eval/matching/historical/historical.case-03.ts \
  packages/protocol/eval/matching/tests/historical.case-03.spec.ts
git commit -m "test(eval): re-source historical music case"
```

### Success Criteria

- Automated: cutoff is exactly `1957-07-06`, exclusive, and the recruitment trigger maps to the National Trust evidence.
- Automated: every listed unique group/song/place term plus `bass`, `half-finished`, `melodically gifted`, and `co-writer` is absent from serialized model input.
- Automated: historical fields resolve only to the four pre-connection sources; Guinness evidence is outcome-only.
- Automated: three synthetic negatives each violate a different guitarist-recruitment requirement and all frozen text is immutable.

---

### Task 5: Replace the composite Page/Brin source in case 04

**Files:**
- Create: `packages/protocol/eval/matching/historical/historical.case-04.ts`
- Create: `packages/protocol/eval/matching/tests/historical.case-04.spec.ts`

**Interfaces:**
- Produces: `HISTORICAL_CASE_04`, ID `historical/first-check-investor`, with Larry Page as the sole source identity while both historical participants retain report names.

**Evidence to encode:**

- Stanford-hosted April 1998 paper, “The Anatomy of a Large-Scale Hypertextual Web Search Engine,” http://infolab.stanford.edu/~backrub/google.html — working prototype, full-text/hyperlink database, and goal of improving web search quality.
- National Science Foundation, “On the Origins of Google,” https://www.nsf.gov/news/origins-google — Page’s link-ranking insight and another graduate researcher joining him; collaborator must be anonymized.
- Stanford OTL, “Uniquely Google(TM),” http://infolab.stanford.edu/pub/voy/museum/google.htm — the researchers’ pre-meeting decision to form a company and demonstration/discussion/check/incorporation sequence.
- Stanford Engineering, “Andy Bechtolsheim: Hero talks innovation, success and engineering,” https://engineering.stanford.edu/news/andy-bechtolsheim-hero-talks-innovation-success-and-engineering — invited demonstration and post-cutoff decision sequence.
- Stanford Engineering, “Andreas Bechtolsheim,” https://engineering.stanford.edu/about/history/heroes/2012-heroes/andreas-bechtolsheim — workstation, systems architecture, networking venture, and operating background before 1998.
- NSF “On the Origins of Google” — funding enabled later relocation and incorporation; independent outcome evidence only.

**Final model-facing text:**

```ts
const source = {
  bio: "Graduate computer-science researcher developing a working web-information system with another graduate researcher. The prototype used the Web’s link structure to improve result quality, operated across millions of pages, and had demonstrated enough technical and commercial promise for the researchers to pursue a company.",
  location: "Northern California",
  interests: ["web information retrieval", "large-scale systems", "search quality"],
  skills: ["link analysis", "search-system architecture", "web crawling and indexing"],
  intent: "Find a technically fluent outside backer willing to evaluate a working information-retrieval prototype and consider funding its transition into a company.",
};

const partner = {
  bio: "Computer-systems engineer and repeat technical-company founder with experience designing and commercializing workstations, building a high-speed networking venture, and leading an acquired networking business. A trusted technical contact has invited him to evaluate a graduate team’s working information-retrieval demonstration.",
  location: "Northern California",
  interests: ["computer systems", "high-speed networking", "technical ventures"],
  skills: ["systems architecture", "computer engineering", "technical company building"],
  intent: "Evaluate an interesting technical demonstration introduced through a trusted systems colleague.",
};
```

Use cutoff `{ date: "1998-08", precision: "month", exclusive: true }`. Remove “no business network,” “no money,” “first believer,” habitual first-check investing, recurring prototype backing, hands-on coaching, and exact university/company/product/check details. Keep `reportNames` exactly `{ "h4-a": "Larry Page", "h4-b": "Andy Bechtolsheim" }`; no Sergey Brin report entry.

- [ ] **Step 1: Write the failing case spec** proving the single source identity and forbidden composite/support claims.
- [ ] **Step 2: Run RED:** `bun test eval/matching/tests/historical.case-04.spec.ts`.
- [ ] **Step 3: Author the case and provenance.** A derived claim may say “another graduate researcher” based on the NSF citation; it may not name or merge that person.
- [ ] **Step 4: Run GREEN and typechecks:**

```bash
bun test eval/matching/tests/historical.case-04.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

- [ ] **Step 5: Commit:**

```bash
git add packages/protocol/eval/matching/historical/historical.case-04.ts \
  packages/protocol/eval/matching/tests/historical.case-04.spec.ts
git commit -m "test(eval): use one founder in historical funding case"
```

### Success Criteria

- Automated: cutoff is exactly month-precision `1998-08`, exclusive, and post-demonstration decisions/check/incorporation are absent from model input.
- Automated: `h4-a` is Larry Page alone; `h4-b` is Andy Bechtolsheim; the collaborator appears only as unnamed citation-derived context.
- Automated: composite identity, habitual first-check, coaching, exact company/product/university/check terms, and unsupported absolutes are absent.
- Automated: three synthetic negatives carry distinct stage/technical/capital violations and every frozen field is immutable.

---

### Task 6: Re-source case 05 before the first RNA/immunology collaboration

**Files:**
- Create: `packages/protocol/eval/matching/historical/historical.case-05.ts`
- Create: `packages/protocol/eval/matching/tests/historical.case-05.spec.ts`

**Interfaces:**
- Produces: `HISTORICAL_CASE_05`, ID `historical/domain-expert-and-ml`.

**Evidence to encode:**

- Nobel Foundation, Karikó banquet speech, https://www.nobelprize.org/prizes/medicine/2023/kariko/speech/ — `“we met at a xerox machine … in 1997 … Drew and I started to work together”` establishes the year boundary and rejects embellishment.
- Cell, “Persistent progress,” https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/ — Karikó’s pre-existing therapeutic-protein mRNA work; Weissman’s dendritic-cell/HIV/vaccine interests and lack of RNA access; later template exchange is post-cutoff.
- Nobel Foundation 2023 press release, https://www.nobelprize.org/prizes/medicine/2023/press-release/ — pre-1997 education, appointments, clinical, and NIH training.
- Nobel Foundation advanced information, https://www.nobelprize.org/prizes/medicine/2023/advanced-information/ — immunology/microbiology, HIV/immune-cell research, and RNA-biochemistry complementarity.
- PNAS, “Profile of Katalin Karikó and Drew Weissman,” https://pmc.ncbi.nlm.nih.gov/articles/PMC10907315/ — `“discoveries made it possible to develop COVID-19 mRNA vaccines, which saved millions of lives”` is independent outcome evidence only.

**Final model-facing text:**

```ts
const source = {
  bio: "Biochemist on the U.S. East Coast focused on RNA-mediated protein therapy, experienced in producing laboratory-made messenger RNA and studying how RNA can direct protein production.",
  location: "U.S. East Coast",
  interests: ["RNA biology", "therapeutic protein production", "experimental optimization"],
  skills: ["biochemistry", "RNA production", "in-vitro transcription", "RNA-focused cell experiments"],
  intent: "Find an immunologist with immune-cell and vaccine experience to test how laboratory-made messenger RNA interacts with immune cells.",
};

const partner = {
  bio: "Physician-scientist on the U.S. East Coast with training in immunology and microbiology, research on dendritic cells and viral disease, and an interest in vaccine approaches. Does not have direct RNA-production expertise.",
  location: "U.S. East Coast",
  interests: ["dendritic cells", "viral disease", "vaccines", "antigen delivery"],
  skills: ["clinical medicine", "immunology", "microbiology", "immune-cell research"],
  intent: "Explore how antigen-delivery approaches affect dendritic cells with a collaborator who can produce a promising molecular payload.",
};
```

Use cutoff `{ date: "1997", precision: "year", exclusive: true }` with explicit year-ordering citations. Exclude all 1997 appointments under this conservative proxy. Remove “immune reaction that blocks the work,” later joint findings, copier setting, shared institution, modified nucleosides, vaccine outcomes, awards, companies, pandemic language, and exact institutions.

- [ ] **Step 1: Write the failing case spec** covering year ordering, later-discovery leakage, participant kinds, pending review, and freezing.
- [ ] **Step 2: Run RED:** `bun test eval/matching/tests/historical.case-05.spec.ts`.
- [ ] **Step 3: Author the case and provenance.** Keep the trigger source-user centered; do not invent a third-party scientific connector.
- [ ] **Step 4: Run GREEN and typechecks:**

```bash
bun test eval/matching/tests/historical.case-05.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

- [ ] **Step 5: Commit:**

```bash
git add packages/protocol/eval/matching/historical/historical.case-05.ts \
  packages/protocol/eval/matching/tests/historical.case-05.spec.ts
git commit -m "test(eval): re-source historical RNA case"
```

### Success Criteria

- Automated: cutoff is exactly year-precision `1997`, exclusive, and ordering evidence proves every retained fact predates first joint work.
- Automated: model-safe text excludes the meeting setting, shared future institution, template exchange, joint findings, modified-nucleoside terms, companies, pandemic outcomes, and awards.
- Automated: PNAS evidence is outcome-only; every source/partner field resolves to Nobel/Cell pre-connection evidence.
- Automated: three synthetic negatives carry distinct methodological/domain-role violations and all frozen fields are immutable.

---

### Task 7: Obtain and apply independent case approval

**Files:**
- Modify: all five `packages/protocol/eval/matching/historical/historical.case-*.ts`
- Create: `docs/research/2026-08-06-historical-five-case-review.md`
- Test: all five case specs

**Interfaces:**
- Consumes: five pending-review cases and their citations.
- Produces: approved review metadata for every case plus a durable review receipt.

- [ ] **Step 1: Dispatch a fresh read-only reviewer per case**

Each reviewer must open every citation and return this exact checklist:

```text
CASE: the audited case's stable ID
CITATIONS: PASS|FAIL — title/publisher/excerpt/URL findings
CUTOFF: PASS|FAIL — exclusive boundary and ordering findings
PROVENANCE: PASS|FAIL — every historical/derived field supported
SYNTHETIC NEGATIVES: PASS|FAIL — authored-only and requirement-specific
LEAKAGE: low|medium|high — combination-based recognizability analysis
SERIALIZED PROJECTIONS: PASS|FAIL — inspect historicalModelSafeProjection, matrixModelInput, and matching evaluator input
DECISION: approved|revise
RATIONALE: evidence-backed explanation
REQUIRED CHANGES: concrete field paths and replacements, or "none"
```

Reviewers are read-only, fresh-context, and independent of the authoring workers.

- [ ] **Step 2: Apply every required correction with one writer**

Do not weaken the cutoff or provenance rules to satisfy a review. Remove/generalize unsupported text, update exact provenance text, and keep the review decision pending until corrected.

- [ ] **Step 3: Commit the corrected pending-review checkpoint**

```bash
git add packages/protocol/eval/matching/historical \
  packages/protocol/eval/matching/tests/historical.case-*.spec.ts
git commit -m "test(eval): address historical corpus review"
```

Record this exact commit SHA as the tree submitted for re-review.

- [ ] **Step 4: Re-run each original reviewer on every changed case**

Resume the original reviewer session or use the exact same durable reviewer identifier; do not substitute a new reviewer after corrections. All five final decisions must be `approved`. Preserve reviewer run IDs, reviewed checkpoint SHA, review date, recognizability rating, and rationale.

- [ ] **Step 5: Write the review receipt**

`docs/research/2026-08-06-historical-five-case-review.md` must include the checklist result for every case, final citation URLs, exact reviewed Git commit, reviewer run IDs, corrections applied, and a statement that no provider/model/database command ran. Do not copy model secrets or private reasoning.

- [ ] **Step 6: Update case metadata, tests, and strict validation**

Set each case’s `anonymizationReview` to its real reviewer receipt. Do not use a generic placeholder such as `independent-reviewer`. In each case spec, replace the pending-review strict-rejection assertion with:

```ts
for (const historicalCase of [
  HISTORICAL_CASE_01,
  HISTORICAL_CASE_02,
  HISTORICAL_CASE_03,
  HISTORICAL_CASE_04,
  HISTORICAL_CASE_05,
]) {
  expect(() => validateHistoricalQualityCase(historicalCase)).not.toThrow();
  expect(historicalCase.historicalQuality.anonymizationReview.decision).toBe("approved");
}
```

Retain a cloned mutation test proving `decision: "pending"` still fails strict validation.

- [ ] **Step 7: Run all case specs**

```bash
cd packages/protocol
bun test eval/matching/tests/historical.case-01.spec.ts \
  eval/matching/tests/historical.case-02.spec.ts \
  eval/matching/tests/historical.case-03.spec.ts \
  eval/matching/tests/historical.case-04.spec.ts \
  eval/matching/tests/historical.case-05.spec.ts
```

Expected: PASS, including strict default validation.

- [ ] **Step 8: Commit final approval metadata and receipt**

```bash
git add packages/protocol/eval/matching/historical \
  packages/protocol/eval/matching/tests/historical.case-*.spec.ts \
  docs/research/2026-08-06-historical-five-case-review.md
git commit -m "docs(eval): record independent historical corpus review"
```

### Success Criteria

- Manual/committed: the receipt has one PASS/FAIL row for every citation listed in Tasks 2–6, verifying URL, title, publisher, exact excerpt, fact ordering, mapped field paths, and outcome-only use where required.
- Manual/committed: each case records cutoff, provenance, synthetic-negative, serialized-projection, and combination-leakage verdicts plus the original reviewer identifier and exact reviewed checkpoint SHA.
- Manual/committed: reviewers are read-only and the receipt identifies the sole patch-applying writer.
- Automated: all five cases pass strict validation only after their independent decisions become approved; cloned pending/revise mutations still fail.

---

### Task 8: Switch matching and matrix consumers to the audited corpus

**Files:**
- Modify: `packages/protocol/eval/matching/matching.historical.ts`
- Modify: `packages/protocol/eval/matching/tests/matching.historical.spec.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/historical-matrix.types.ts`
- Modify: `packages/protocol/eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts`
- Modify: `services/api/src/cli/discovery-env-matrix.shared.ts`
- Modify: `services/api/src/cli/tests/discovery-env-matrix.spec.ts`
- Modify: `services/api/src/cli/tests/discovery-env-matrix-base.spec.ts`

**Interfaces:**
- Consumes: the five approved `HISTORICAL_CASE_01` through `HISTORICAL_CASE_05` values.
- Produces: `HISTORICAL_QUALITY_CASES`, compatibility `HISTORICAL_CASES`, and frozen matrix fixtures without speculative intent reconstruction.

- [ ] **Step 1: Write failing aggregate and matrix expectations**

Assert:

```ts
expect(HISTORICAL_QUALITY_CASES.map(({ id }) => id)).toEqual([
  "historical/builder-and-operator",
  "historical/co-researchers-structure",
  "historical/songwriting-duo",
  "historical/first-check-investor",
  "historical/domain-expert-and-ml",
]);
expect(HISTORICAL_CASES).toEqual(
  HISTORICAL_QUALITY_CASES.map(historicalMatchingCaseProjection),
);
expect(HISTORICAL_QUALITY_CASES[3]!.reportNames).toEqual({
  "h4-a": "Larry Page",
  "h4-b": "Andy Bechtolsheim",
});
```

Make leakage scans inspect `historicalModelSafeProjection`, `matrixModelInput`, and the exact strings given to the matching evaluator (`case.input`).

- [ ] **Step 2: Run aggregate specs and confirm RED**

```bash
cd packages/protocol
bun test eval/matching/tests/matching.historical.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts
```

Expected: missing aggregate exports and old reconstruction assumptions.

- [ ] **Step 3: Replace the inline corpus with the canonical aggregate**

`matching.historical.ts` should contain only imports, strict validation, and exports:

```ts
export const HISTORICAL_QUALITY_CASES = Object.freeze([
  HISTORICAL_CASE_01,
  HISTORICAL_CASE_02,
  HISTORICAL_CASE_03,
  HISTORICAL_CASE_04,
  HISTORICAL_CASE_05,
] satisfies HistoricalQualityCase[]);

for (const historicalCase of HISTORICAL_QUALITY_CASES) {
  validateHistoricalQualityCase(historicalCase);
}

export const HISTORICAL_CASES = Object.freeze(
  HISTORICAL_QUALITY_CASES.map(historicalMatchingCaseProjection),
);
```

Delete the old five inline objects.

- [ ] **Step 4: Delete speculative matrix reconstruction and control-ID projection**

Remove `RECONSTRUCTED_INTENTS` and `historically_grounded_reconstruction`. Every participant must carry a frozen intent directly in the canonical case. Simplify matrix intent to `{ text: string }`, adapt from `HISTORICAL_QUALITY_CASES`, and keep all audit fields outside `matrixModelInput`. Remove `id` from `HistoricalMatrixModelInput` and from `matrixModelInput`; stable descriptive case IDs remain control-plane metadata only. Keep the provenance-backed generalized `description` because the judge consumes it.

- [ ] **Step 5: Version the changed API fixture contract**

Change `BASE_FIXTURE_CORPUS_VERSION` from `historical-matrix-v1` to `historical-matrix-v2`. Update provider-free API tests to expect v2 and to prove old protected-base metadata is rejected before any reset or spend. Document that authorized reseeding is deliberately deferred to IND-638; this issue does not touch Neon.

- [ ] **Step 6: Run aggregate, matrix, policy, API fixture, and type tests**

```bash
cd packages/protocol
bun test eval/matching/tests/matching.historical.spec.ts \
  eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.policy.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
cd ../../services/api
bun test src/cli/tests/discovery-env-matrix.spec.ts \
  src/cli/tests/discovery-env-matrix-base.spec.ts
```

Expected: PASS without database credentials or branch mutation.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/eval/matching/matching.historical.ts \
  packages/protocol/eval/matching/tests/matching.historical.spec.ts \
  packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts \
  packages/protocol/eval/discovery-env-matrix/historical-matrix.types.ts \
  packages/protocol/eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts \
  services/api/src/cli/discovery-env-matrix.shared.ts \
  services/api/src/cli/tests/discovery-env-matrix.spec.ts \
  services/api/src/cli/tests/discovery-env-matrix-base.spec.ts
git commit -m "test(eval): adopt audited historical corpus"
```

### Success Criteria

- Automated: the aggregate contains exactly the five stable case IDs and each case has exactly five stable anonymous participant IDs; descriptive case IDs are absent from the exact matching/matrix LLM payload strings.
- Automated: serialized `historicalModelSafeProjection`, `matrixModelInput`, and matching evaluator input contain none of the report identities, URLs, excerpts, audit keys, reviewed unique proper nouns, negative labels/reasons, or outcome terms.
- Automated/static: `RECONSTRUCTED_INTENTS` and `historically_grounded_reconstruction` are absent; each matrix intent equals its canonical frozen participant intent.
- Automated: fixture metadata is `historical-matrix-v2`; v1 protected-base metadata is refused by provider-free API tests before any reset/spend path.

---

### Task 9: Document, version, and verify the provider-free migration

**Files:**
- Modify: `packages/protocol/eval/README.md`
- Modify: `packages/protocol/package.json`
- Modify: `bun.lock`
- Delete before PR: `docs/superpowers/specs/2026-08-06-ind-637-historical-five-case-hardening-design.md`
- Delete before PR: `docs/superpowers/plans/2026-08-06-ind-637-historical-five-case-hardening.md`

**Interfaces:**
- Produces: release-ready package metadata and exact verification evidence.

- [ ] **Step 1: Update the migration-boundary documentation**

Replace the README sentence saying IND-637 “migrates” the corpus with wording that IND-637 has migrated and independently reviewed the five cases, while IND-638 still owns shared-pool fixture/runtime integration and IND-641 owns child-spawn side configuration.

- [ ] **Step 2: Bump the protocol patch version**

Change `packages/protocol/package.json` from `9.2.1` to `9.2.2`, run `bun install` at the repository worktree root, and verify only the expected root lockfile version entry changes.

- [ ] **Step 3: Run focused provider-free verification**

```bash
cd packages/protocol
bun test eval/matching/tests/historical.case-01.spec.ts \
  eval/matching/tests/historical.case-02.spec.ts \
  eval/matching/tests/historical.case-03.spec.ts \
  eval/matching/tests/historical.case-04.spec.ts \
  eval/matching/tests/historical.case-05.spec.ts \
  eval/matching/tests/matching.historical.spec.ts \
  eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.policy.spec.ts
bun x tsc --noEmit -p eval/matching/tsconfig.json
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
bun run eval:verify
cd ../../services/api
bun test src/cli/tests/discovery-env-matrix.spec.ts \
  src/cli/tests/discovery-env-matrix-base.spec.ts
```

Expected: all focused specs and provider-free API fixture specs pass; both suite typechecks pass; `eval:verify` reports all 13 suites type-checked and tested without provider credentials.

- [ ] **Step 4: Run package/repository checks**

```bash
cd ../..
bun run check:subtree-parity
git diff --check
git status --short
git diff --name-only origin/dev
```

Confirm no baseline, run artifact, production API runtime, database, environment, or eval-ops file changed. The only API files allowed are the fixture-version constant and its provider-free specs.

- [ ] **Step 5: Remove temporary superpowers artifacts**

The Development Reference requires related superpowers specs/plans to be deleted before branch finishing:

```bash
git rm docs/superpowers/specs/2026-08-06-ind-637-historical-five-case-hardening-design.md \
  docs/superpowers/plans/2026-08-06-ind-637-historical-five-case-hardening.md
```

The permanent design/evidence record is `docs/research/2026-08-06-historical-five-case-review.md` plus the typed contracts and tests.

- [ ] **Step 6: Commit final documentation and versioning**

```bash
git add packages/protocol/eval/README.md packages/protocol/package.json bun.lock \
  docs/research/2026-08-06-historical-five-case-review.md
git add -u docs/superpowers
git commit -m "chore(protocol): prepare historical corpus release"
git diff --name-only origin/dev...HEAD
git status --short --branch
```

- [ ] **Step 7: Attach exact evidence to IND-637**

Move IND-637 to In Review and comment with changed files, focused test counts, both typechecks, `eval:verify`, independent reviewer run IDs, statement that no live provider/database command ran, and residual handoff that shared-pool/runtime work remains IND-638.

### Success Criteria

- Automated: `packages/protocol/package.json` is `9.2.2` and `bun.lock` changes only for the corresponding workspace version.
- Automated: focused protocol/API tests, both suite typechecks, all 13 provider-free eval suites, subtree parity, and `git diff --check` pass.
- Automated/path audit: the final `origin/dev...HEAD` inventory contains no baseline, run artifact, environment, database, production runtime, or eval-ops changes; only the approved API fixture-version files are present.
- Manual/recorded: the exact command transcript attests that no model, embedding, Redis, Neon, database, baseline-update, or run-artifact command ran.
- Git: temporary superpowers spec/plan files are deleted, the worktree is clean, and the branch contains the durable research review record.

---

## Plan Self-Review Checklist

- Contract extension distinguishes historical, derived, and authored text without weakening strict approval.
- Every model-facing historical field, including case description and trigger text, has provenance.
- Every case has a dedicated TDD task and exact source/text constraints.
- Jobs/Wozniak no longer claims pre-cutoff operator/builder semantics.
- Watson does not possess diffraction data or outcome knowledge before the cutoff.
- Lennon/McCartney is reframed as evidenced guitarist recruitment, not a speculative co-writer search.
- Larry Page is the sole `h4-a` source.
- Karikó/Weissman excludes post-meeting experiments and outcomes.
- Independent review happens before strict aggregation.
- Matrix speculative reconstructions are deleted.
- No live model/database or baseline update is included.
- Package patch version and root lockfile are included.
- Temporary spec/plan deletion is included before PR creation.
