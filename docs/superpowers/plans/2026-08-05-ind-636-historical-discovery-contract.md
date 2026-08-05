# IND-636 Historical Discovery Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-free corpus, metric, and experiment contracts that later Historical Discovery Quality issues can integrate without changing the current live runner or five-case corpus.

**Architecture:** Add three focused pure modules inside the existing `discovery-env-matrix` eval suite: one for historical evidence/projection, one for retrieval/evaluator metrics, and one for experiment planning. Each module owns its validation and has a dedicated spec. Current `HISTORICAL_CASES`, Neon fixtures, CLI execution, and eval-ops behavior remain unchanged until IND-637/638/641.

**Tech Stack:** Bun, TypeScript strict mode, Bun test, existing protocol eval suite, existing `MatchingCase` and eval shared structural types.

## Global Constraints

- This issue is provider-free: no model, embedding, Redis, Neon, or database calls.
- Do not migrate or rewrite the five committed historical cases; IND-637 applies the new corpus contract.
- Do not change `services/api/src/cli/discovery*.ts`, branch resets, eval-ops UI, artifact schemas, baselines, or production behavior.
- Historical evidence uses an exclusive first-substantive-collaboration cutoff.
- Historical absence is never a negative label; only authored semantic negatives with an explicit violated requirement are scored negative.
- Model-safe projection must structurally exclude citations, report identities, provenance excerpts, and anonymization-review fields.
- Retrieval rank is user-level: group evidence by participant ID, use the best score, tie-break by stable ID, and union evidence metadata.
- Failure precedence is `execution → retrieval → evaluation_admission → evaluation_rejection → finalization → none`.
- Shared scorecard `passes/passRate` represent execution completeness only for this future harness.
- Historical experiments use exactly one attempt per requested slot and refuse more than 200 graph invocations.
- Ordinary A/B comparisons change exactly one resolved graph-agent model assignment or one environment key; judge, embedding, provider, corpus, and scoring resources remain equal.
- A/B contracts report factor differences and metric deltas; they do not declare a winner or significance.

---

## File Structure

### New files

- `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts`
  - Owns v2 historical evidence, trigger-input, semantic-negative, anonymization-review, and model-safe-projection contracts.
  - Exports `HistoricalQualityCase`, `validateHistoricalQualityCase`, and `historicalModelSafeProjection`.
- `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts`
  - Owns user-level retrieval deduplication, evaluator-state attribution, failure-stage classification, and completeness transport fields.
  - Exports `dedupeHistoricalRetrieval`, `classifyHistoricalFailureStage`, and `executionCompletenessFields`.
- `packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts`
  - Owns trigger selection, resolved configuration comparison, one-factor validation, slot planning, one-attempt enforcement, and the 200-invocation ceiling.
  - Exports `buildHistoricalExperimentPlan`, `diffResolvedHistoricalConfigs`, and constants.
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts`
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts`
- `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts`

### Modified files

- `packages/protocol/eval/README.md`
  - Documents that IND-636 adds preparatory provider-free v2 contracts while the current five cases/live runner remain v1 until later project issues.

---

### Task 1: Historical evidence and projection contract

**Files:**
- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts`
- Test: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts`

**Interfaces:**
- Consumes: `MatchingCase` from `../matching/matching.types.js`.
- Produces:
  - `HistoricalQualityCase extends MatchingCase`
  - `validateHistoricalQualityCase(input: HistoricalQualityCase): void`
  - `historicalModelSafeProjection(input: HistoricalQualityCase): HistoricalModelSafeProjection`
  - evidence/provenance types used by IND-637 and fixture projection used by IND-638.

- [ ] **Step 1: Write the failing corpus-contract spec**

Create `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts` with a complete valid fixture and focused mutations:

```ts
import { describe, expect, it } from "bun:test";
import type { HistoricalQualityCase } from "../historical-quality.corpus.js";
import {
  historicalModelSafeProjection,
  validateHistoricalQualityCase,
} from "../historical-quality.corpus.js";

const validCase = (): HistoricalQualityCase => ({
  id: "historical-v2/builder-operator",
  rule: "historical",
  tier: 3,
  domains: ["technology"],
  description: "An operator needs a complementary hardware builder.",
  input: {
    discovererId: "p-source",
    entities: [
      {
        userId: "p-source",
        profile: { name: "(source user)", bio: "Commercial operator.", location: "West Coast", interests: [], skills: ["sales"] },
        intents: [{ intentId: "i-source", payload: "Find a hardware builder." }],
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-target",
        profile: { name: "Participant B", bio: "Hardware builder.", location: "West Coast", interests: [], skills: ["circuit design"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-1",
        profile: { name: "Participant C", bio: "Sales operator.", location: "West Coast", interests: [], skills: ["sales"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-2",
        profile: { name: "Participant D", bio: "Parts supplier.", location: "West Coast", interests: [], skills: ["procurement"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-3",
        profile: { name: "Participant E", bio: "Weekend hobbyist.", location: "West Coast", interests: [], skills: ["soldering"] },
        networkId: "historical-v2-pool",
      },
    ],
    networkContexts: { "historical-v2-pool": "An interdisciplinary collaboration community." },
  },
  expect: [
    { candidateId: "p-target", match: true },
    { candidateId: "p-negative-1", match: false },
    { candidateId: "p-negative-2", match: false },
    { candidateId: "p-negative-3", match: false },
  ],
  reportNames: { "p-source": "Real Source", "p-target": "Real Target" },
  historicalQuality: {
    cutoff: {
      date: "1975-12-31",
      precision: "day",
      exclusive: true,
      orderingCitationIds: ["citation-pre"],
    },
    citations: [
      { id: "citation-pre", url: "https://example.org/pre", title: "Pre-connection source", publisher: "Archive", excerpt: "Commercial operator before collaboration." },
      { id: "citation-outcome", url: "https://example.org/outcome", title: "Outcome source", publisher: "Archive", excerpt: "The collaboration produced a documented result." },
    ],
    claims: [
      { id: "claim-source", text: "Commercial operator.", citationIds: ["citation-pre"], preConnection: true },
    ],
    outcomeCitationIds: ["citation-outcome"],
    anonymizationReview: {
      reviewer: "independent-reviewer",
      reviewedAt: "2026-08-05",
      recognizability: "medium",
      decision: "approved",
      rationale: "Unique names and outcome terms are absent from model input.",
    },
    semanticNegatives: {
      "p-negative-1": "Same-side operator; lacks the required builder role.",
      "p-negative-2": "Supplier relationship does not satisfy the co-builder requirement.",
      "p-negative-3": "No product-building commitment.",
    },
    triggerInputs: {
      intent: { text: "Find a hardware builder." },
      enrichment: {
        premises: ["I can commercialize a personal-computing product."],
        userContext: "Commercial operator seeking a complementary technical collaborator.",
      },
    },
  },
});

describe("historical quality corpus contract", () => {
  it("accepts complete cited pre-connection evidence", () => {
    expect(() => validateHistoricalQualityCase(validCase())).not.toThrow();
  });

  it("rejects missing citations, non-exclusive cutoffs, unproved year ordering, and unapproved anonymization", () => {
    const missing = validCase();
    missing.historicalQuality.claims[0]!.citationIds = ["missing"];
    expect(() => validateHistoricalQualityCase(missing)).toThrow(/unknown citation missing/);

    const inclusive = validCase();
    inclusive.historicalQuality.cutoff.exclusive = false as true;
    expect(() => validateHistoricalQualityCase(inclusive)).toThrow(/cutoff must be exclusive/);

    const invalidDate = validCase();
    invalidDate.historicalQuality.cutoff.date = "1975-13-40";
    expect(() => validateHistoricalQualityCase(invalidDate)).toThrow(/cutoff date does not match day precision/);

    const yearWithoutOrdering = validCase();
    yearWithoutOrdering.historicalQuality.cutoff = {
      date: "1975",
      precision: "year",
      exclusive: true,
      orderingCitationIds: [],
    };
    expect(() => validateHistoricalQualityCase(yearWithoutOrdering)).toThrow(/year precision requires ordering evidence/);

    const overlappingOutcome = validCase();
    overlappingOutcome.historicalQuality.outcomeCitationIds = ["citation-pre"];
    expect(() => validateHistoricalQualityCase(overlappingOutcome)).toThrow(/outcome requires an independent citation/);

    const unapproved = validCase();
    unapproved.historicalQuality.anonymizationReview.decision = "revise";
    expect(() => validateHistoricalQualityCase(unapproved)).toThrow(/anonymization review must be approved/);
  });

  it("requires one positive and at least three authored semantic negatives that reference rejected candidates", () => {
    const tooFew = validCase();
    delete tooFew.historicalQuality.semanticNegatives["p-negative-3"];
    expect(() => validateHistoricalQualityCase(tooFew)).toThrow(/at least three semantic negatives/);

    const positiveAsNegative = validCase();
    positiveAsNegative.historicalQuality.semanticNegatives["p-target"] = "invalid";
    expect(() => validateHistoricalQualityCase(positiveAsNegative)).toThrow(/must reference a rejected candidate/);
  });

  it("projects only model-safe matching and trigger inputs", () => {
    const input = validCase();
    const projection = historicalModelSafeProjection(input);
    const serialized = JSON.stringify(projection);
    expect(Object.keys(projection).sort()).toEqual(["id", "input", "triggerInputs"]);
    for (const forbidden of ["reportNames", "historicalQuality", "citations", "claims", "anonymizationReview", "Real Source", "https://example.org/"]) {
      expect(serialized).not.toContain(forbidden);
    }

    const leakedName = validCase();
    leakedName.input.entities[0]!.profile.name = "Real Source";
    expect(() => validateHistoricalQualityCase(leakedName)).toThrow(/report name Real Source is present in model-safe projection/);
  });
});
```

- [ ] **Step 2: Run the corpus spec to verify it fails**

Run:

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
```

Expected: FAIL with `Cannot find module '../historical-quality.corpus.js'`.

- [ ] **Step 3: Implement the evidence types, explicit projection, and validator**

Create `packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts` with these exact public interfaces:

```ts
import type { MatchingCase } from "../matching/matching.types.js";

export type HistoricalDatePrecision = "day" | "month" | "year";
export type HistoricalRecognizability = "low" | "medium" | "high";

export interface HistoricalCitation {
  id: string;
  url: string;
  title: string;
  publisher: string;
  excerpt: string;
}

export interface HistoricalClaim {
  id: string;
  text: string;
  citationIds: string[];
  preConnection: true;
}

export interface HistoricalQualityMetadata {
  cutoff: {
    date: string;
    precision: HistoricalDatePrecision;
    exclusive: true;
    orderingCitationIds: string[];
  };
  citations: HistoricalCitation[];
  claims: HistoricalClaim[];
  outcomeCitationIds: string[];
  anonymizationReview: {
    reviewer: string;
    reviewedAt: string;
    recognizability: HistoricalRecognizability;
    decision: "approved" | "revise";
    rationale: string;
  };
  semanticNegatives: Record<string, string>;
  triggerInputs: {
    intent: { text: string };
    enrichment: { premises: string[]; userContext: string };
  };
}

export interface HistoricalQualityCase extends MatchingCase {
  historicalQuality: HistoricalQualityMetadata;
}

export interface HistoricalModelSafeProjection {
  id: string;
  input: MatchingCase["input"];
  triggerInputs: HistoricalQualityMetadata["triggerInputs"];
}

export function historicalModelSafeProjection(input: HistoricalQualityCase): HistoricalModelSafeProjection {
  return {
    id: input.id,
    input: structuredClone(input.input),
    triggerInputs: structuredClone(input.historicalQuality.triggerInputs),
  };
}
```

Implement `validateHistoricalQualityCase` with small private helpers and these deterministic checks:

```ts
export function validateHistoricalQualityCase(input: HistoricalQualityCase): void {
  const fail = (message: string): never => { throw new Error(`${input.id}: ${message}`); };
  const nonblank = (value: string, field: string): void => {
    if (value.trim() === "") fail(`${field} must be non-empty`);
  };

  const ids = new Set(input.input.entities.map((entity) => entity.userId));
  if (!ids.has(input.input.discovererId)) fail("discoverer must reference an entity");
  const positives = input.expect.filter((expectation) => expectation.match);
  if (positives.length !== 1) fail("requires exactly one positive partner");

  const citations = new Map<string, HistoricalCitation>();
  for (const citation of input.historicalQuality.citations) {
    nonblank(citation.id, "citation id");
    if (citations.has(citation.id)) fail(`duplicate citation ${citation.id}`);
    let url: URL;
    try { url = new URL(citation.url); } catch { fail(`citation ${citation.id} URL is invalid`); }
    if (url.protocol !== "https:" && url.protocol !== "http:") fail(`citation ${citation.id} URL must be HTTP(S)`);
    nonblank(citation.title, `citation ${citation.id} title`);
    nonblank(citation.publisher, `citation ${citation.id} publisher`);
    nonblank(citation.excerpt, `citation ${citation.id} excerpt`);
    citations.set(citation.id, citation);
  }
  const assertCitationIds = (values: readonly string[], field: string): void => {
    if (values.length === 0) fail(`${field} requires at least one citation`);
    for (const id of values) if (!citations.has(id)) fail(`${field} references unknown citation ${id}`);
  };

  if (input.historicalQuality.cutoff.exclusive !== true) fail("cutoff must be exclusive");
  const cutoffPatterns: Record<HistoricalDatePrecision, RegExp> = {
    day: /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/,
    month: /^\d{4}-(0[1-9]|1[0-2])$/,
    year: /^\d{4}$/,
  };
  if (!cutoffPatterns[input.historicalQuality.cutoff.precision].test(input.historicalQuality.cutoff.date)) {
    fail(`cutoff date does not match ${input.historicalQuality.cutoff.precision} precision`);
  }
  if (input.historicalQuality.cutoff.precision === "day") {
    const [year, month, day] = input.historicalQuality.cutoff.date.split("-").map(Number);
    const normalized = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10);
    if (normalized !== input.historicalQuality.cutoff.date) fail("cutoff day is not a valid calendar date");
  }
  if (input.historicalQuality.cutoff.precision === "year" && input.historicalQuality.cutoff.orderingCitationIds.length === 0) {
    fail("year precision requires ordering evidence");
  }
  assertCitationIds(input.historicalQuality.cutoff.orderingCitationIds, "cutoff ordering");
  assertCitationIds(input.historicalQuality.outcomeCitationIds, "outcome");
  const claimIds = new Set<string>();
  const preConnectionCitationIds = new Set(input.historicalQuality.cutoff.orderingCitationIds);
  for (const claim of input.historicalQuality.claims) {
    nonblank(claim.id, "claim id");
    if (claimIds.has(claim.id)) fail(`duplicate claim ${claim.id}`);
    claimIds.add(claim.id);
    nonblank(claim.text, `claim ${claim.id} text`);
    if (claim.preConnection !== true) fail(`claim ${claim.id} must attest preConnection`);
    assertCitationIds(claim.citationIds, `claim ${claim.id}`);
    for (const citationId of claim.citationIds) preConnectionCitationIds.add(citationId);
  }
  if (input.historicalQuality.outcomeCitationIds.every((citationId) => preConnectionCitationIds.has(citationId))) {
    fail("outcome requires an independent citation");
  }

  const review = input.historicalQuality.anonymizationReview;
  if (review.decision !== "approved") fail("anonymization review must be approved");
  nonblank(review.reviewer, "anonymization reviewer");
  nonblank(review.reviewedAt, "anonymization reviewedAt");
  nonblank(review.rationale, "anonymization rationale");

  const negativeEntries = Object.entries(input.historicalQuality.semanticNegatives);
  if (negativeEntries.length < 3) fail("requires at least three semantic negatives");
  const rejected = new Set(input.expect.filter((expectation) => !expectation.match).map((expectation) => expectation.candidateId));
  for (const [participantId, reason] of negativeEntries) {
    if (!ids.has(participantId)) fail(`semantic negative ${participantId} is not a participant`);
    if (!rejected.has(participantId)) fail(`semantic negative ${participantId} must reference a rejected candidate`);
    nonblank(reason, `semantic negative ${participantId} reason`);
  }

  nonblank(input.historicalQuality.triggerInputs.intent.text, "intent trigger text");
  if (input.historicalQuality.triggerInputs.enrichment.premises.length === 0) fail("enrichment requires at least one premise");
  for (const premise of input.historicalQuality.triggerInputs.enrichment.premises) nonblank(premise, "enrichment premise");
  nonblank(input.historicalQuality.triggerInputs.enrichment.userContext, "enrichment user context");

  const serializedProjection = JSON.stringify(historicalModelSafeProjection(input));
  for (const reportName of Object.values(input.reportNames ?? {})) {
    if (reportName.trim() !== "" && serializedProjection.includes(reportName)) {
      fail(`report name ${reportName} is present in model-safe projection`);
    }
  }
}
```

Keep the projection explicit. Do not implement it via object spread plus deletion; that can leak newly added audit fields later.

- [ ] **Step 4: Run the corpus spec and suite typecheck**

Run:

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the corpus contract**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.corpus.ts \
  packages/protocol/eval/discovery-env-matrix/tests/historical-quality.corpus.spec.ts
git commit -m "test(eval): define historical evidence contract"
```

---

### Task 2: User-level retrieval and evaluator attribution metrics

**Files:**
- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts`
- Test: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts`

**Interfaces:**
- Consumes: provider-free raw retrieval/evaluator observations supplied later by IND-638.
- Produces:
  - `dedupeHistoricalRetrieval(rows: readonly HistoricalRetrievalEvidenceRow[]): HistoricalRetrievedUser[]`
  - `classifyHistoricalFailureStage(input: HistoricalFailureInput): HistoricalFailureStage`
  - `executionCompletenessFields(completed: boolean): Pick<CaseResultLike, "runs" | "passes" | "passRate" | "flaky">`

- [ ] **Step 1: Write the failing metric spec**

Create `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  classifyHistoricalFailureStage,
  dedupeHistoricalRetrieval,
  executionCompletenessFields,
} from "../historical-quality.metrics.js";

describe("historical quality metrics", () => {
  it("deduplicates evidence rows by participant using best score and stable-id ties", () => {
    expect(dedupeHistoricalRetrieval([
      { participantId: "b", score: 0.8, evidenceType: "premise", evidenceId: "p-2" },
      { participantId: "a", score: 0.8, evidenceType: "intent", evidenceId: "i-1" },
      { participantId: "b", score: 0.9, evidenceType: "user_context", evidenceId: "c-1" },
      { participantId: "a", score: 0.7, evidenceType: "premise", evidenceId: "p-1" },
    ])).toEqual([
      { participantId: "b", retrievalRank: 1, bestScore: 0.9, evidenceTypes: ["premise", "user_context"], evidenceIds: ["c-1", "p-2"] },
      { participantId: "a", retrievalRank: 2, bestScore: 0.8, evidenceTypes: ["intent", "premise"], evidenceIds: ["i-1", "p-1"] },
    ]);

    expect(dedupeHistoricalRetrieval([
      { participantId: "b", score: 0.8, evidenceType: "premise", evidenceId: "p-2" },
      { participantId: "a", score: 0.8, evidenceType: "premise", evidenceId: "p-1" },
    ]).map((row) => row.participantId)).toEqual(["a", "b"]);
  });

  it("rejects invalid retrieval observations", () => {
    expect(() => dedupeHistoricalRetrieval([
      { participantId: "a", score: Number.NaN, evidenceType: "intent", evidenceId: "i-1" },
    ])).toThrow(/finite score/);
    expect(() => dedupeHistoricalRetrieval([
      { participantId: "", score: 0.5, evidenceType: "intent", evidenceId: "i-1" },
    ])).toThrow(/participantId/);
  });

  it("classifies the first failed stage without calling unevaluated targets rejected", () => {
    const base = {
      completed: true,
      targetId: "target",
      retrievedParticipantIds: ["target"],
      evaluator: { eligible: true, submitted: true, returned: true, finalIncluded: true },
    } as const;
    expect(classifyHistoricalFailureStage({ ...base, completed: false })).toBe("execution");
    expect(classifyHistoricalFailureStage({ ...base, retrievedParticipantIds: [] })).toBe("retrieval");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: false, submitted: false, returned: false, finalIncluded: false } })).toBe("evaluation_admission");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: false, returned: false, finalIncluded: false } })).toBe("evaluation_admission");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: true, returned: false, finalIncluded: false } })).toBe("evaluation_rejection");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: true, returned: true, finalIncluded: false } })).toBe("finalization");
    expect(classifyHistoricalFailureStage(base)).toBe("none");
  });

  it("maps scorecard transport fields to completeness only", () => {
    expect(executionCompletenessFields(true)).toEqual({ runs: 1, passes: 1, passRate: 1, flaky: false });
    expect(executionCompletenessFields(false)).toEqual({ runs: 1, passes: 0, passRate: 0, flaky: false });
  });
});
```

- [ ] **Step 2: Run the metric spec to verify it fails**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts
```

Expected: FAIL with `Cannot find module '../historical-quality.metrics.js'`.

- [ ] **Step 3: Implement deterministic metric helpers**

Create `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts`:

```ts
import type { CaseResultLike } from "../shared/index.js";

export type HistoricalEvidenceType = "intent" | "premise" | "user_context";

export interface HistoricalRetrievalEvidenceRow {
  participantId: string;
  score: number;
  evidenceType: HistoricalEvidenceType;
  evidenceId: string;
}

export interface HistoricalRetrievedUser {
  participantId: string;
  retrievalRank: number;
  bestScore: number;
  evidenceTypes: HistoricalEvidenceType[];
  evidenceIds: string[];
}

export function dedupeHistoricalRetrieval(rows: readonly HistoricalRetrievalEvidenceRow[]): HistoricalRetrievedUser[] {
  const grouped = new Map<string, { bestScore: number; evidenceTypes: Set<HistoricalEvidenceType>; evidenceIds: Set<string> }>();
  for (const row of rows) {
    if (row.participantId.trim() === "") throw new Error("Historical retrieval participantId must be non-empty");
    if (!Number.isFinite(row.score)) throw new Error(`Historical retrieval ${row.participantId} requires a finite score`);
    if (row.evidenceId.trim() === "") throw new Error(`Historical retrieval ${row.participantId} evidenceId must be non-empty`);
    const current = grouped.get(row.participantId) ?? {
      bestScore: Number.NEGATIVE_INFINITY,
      evidenceTypes: new Set<HistoricalEvidenceType>(),
      evidenceIds: new Set<string>(),
    };
    current.bestScore = Math.max(current.bestScore, row.score);
    current.evidenceTypes.add(row.evidenceType);
    current.evidenceIds.add(row.evidenceId);
    grouped.set(row.participantId, current);
  }
  return [...grouped.entries()]
    .sort(([aId, a], [bId, b]) => b.bestScore - a.bestScore || aId.localeCompare(bId))
    .map(([participantId, value], index) => ({
      participantId,
      retrievalRank: index + 1,
      bestScore: value.bestScore,
      evidenceTypes: [...value.evidenceTypes].sort(),
      evidenceIds: [...value.evidenceIds].sort(),
    }));
}

export type HistoricalFailureStage =
  | "execution"
  | "retrieval"
  | "evaluation_admission"
  | "evaluation_rejection"
  | "finalization"
  | "none";

export interface HistoricalFailureInput {
  completed: boolean;
  targetId: string;
  retrievedParticipantIds: readonly string[];
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    finalIncluded: boolean;
  };
}

export function classifyHistoricalFailureStage(input: HistoricalFailureInput): HistoricalFailureStage {
  if (!input.completed) return "execution";
  if (!input.retrievedParticipantIds.includes(input.targetId)) return "retrieval";
  if (!input.evaluator.eligible || !input.evaluator.submitted) return "evaluation_admission";
  if (!input.evaluator.returned) return "evaluation_rejection";
  if (!input.evaluator.finalIncluded) return "finalization";
  return "none";
}

export function executionCompletenessFields(
  completed: boolean,
): Pick<CaseResultLike, "runs" | "passes" | "passRate" | "flaky"> {
  return { runs: 1, passes: completed ? 1 : 0, passRate: completed ? 1 : 0, flaky: false };
}
```

Do not infer evaluator submission from retrieval rank. IND-638 must populate `eligible` and `submitted` from actual graph traces.

- [ ] **Step 4: Run metric and existing policy tests**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.policy.spec.ts
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit the metric contract**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts \
  packages/protocol/eval/discovery-env-matrix/tests/historical-quality.metrics.spec.ts
git commit -m "test(eval): define historical quality metrics"
```

---

### Task 3: Trigger, workload, and one-factor experiment contract

**Files:**
- Create: `packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts`
- Test: `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts`

**Interfaces:**
- Consumes: fully resolved, credential-free side configurations; stable case IDs; selected triggers and repetitions.
- Produces:
  - `HISTORICAL_QUALITY_MAX_ATTEMPTS = 1`
  - `HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS = 200`
  - `diffResolvedHistoricalConfigs(a, b): HistoricalFactorDifference[]`
  - `buildHistoricalExperimentPlan(input): HistoricalExperimentPlan`
  - deterministic slots consumed by IND-638 and side provenance consumed by IND-641.

- [ ] **Step 1: Write the failing experiment-contract spec**

Create `packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import {
  HISTORICAL_QUALITY_MAX_ATTEMPTS,
  buildHistoricalExperimentPlan,
  diffResolvedHistoricalConfigs,
} from "../historical-quality.experiment.js";

const fixed = {
  judgeModelId: "judge-v1",
  embeddingModelId: "embedding-v1",
  providerAccountFingerprint: "provider-account-a",
  corpusVersion: "historical-v2",
  scoringPolicyFingerprint: "scoring-v2",
};
const side = (id: "a" | "b", models: Record<string, string>, env: Record<string, string> = {}) => ({
  id,
  config: { models, env, fixed },
});

describe("historical experiment contract", () => {
  it("uses exactly one attempt and plans a full pair at 180 invocations", () => {
    expect(HISTORICAL_QUALITY_MAX_ATTEMPTS).toBe(1);
    const plan = buildHistoricalExperimentPlan({
      caseIds: Array.from({ length: 15 }, (_, index) => `case-${index + 1}`),
      triggers: ["intent", "enrichment"],
      repetitions: 3,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }),
        side("b", { opportunityEvaluator: "model-b" }),
      ],
      mode: "ordinary",
    });
    expect(plan.graphInvocations).toBe(180);
    expect(plan.maxAttempts).toBe(1);
    expect(plan.slots).toHaveLength(180);
    expect(plan.slots[0]).toMatchObject({ caseId: "case-1", trigger: "intent", repetition: 0, sideId: "a", attempt: 1 });
  });

  it("refuses an attempt ceiling above 200", () => {
    expect(() => buildHistoricalExperimentPlan({
      caseIds: Array.from({ length: 17 }, (_, index) => `case-${index + 1}`),
      triggers: ["intent", "enrichment"],
      repetitions: 3,
      sides: [side("a", { opportunityEvaluator: "model-a" }), side("b", { opportunityEvaluator: "model-b" })],
      mode: "ordinary",
    })).toThrow(/204 graph invocations exceeds hard cap 200/);
  });

  it("accepts exactly one resolved model or env difference and rejects multiple factors", () => {
    expect(diffResolvedHistoricalConfigs(
      side("a", { opportunityEvaluator: "model-a" }).config,
      side("b", { opportunityEvaluator: "model-b" }).config,
    )).toEqual([{ kind: "model", key: "opportunityEvaluator", a: "model-a", b: "model-b" }]);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"],
      triggers: ["intent"],
      repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }, { DISCOVERY_ALLOWED_TYPES: "intent" }),
        side("b", { opportunityEvaluator: "model-b" }, { DISCOVERY_ALLOWED_TYPES: "intent,profile" }),
      ],
      mode: "ordinary",
    })).toThrow(/ordinary comparison requires exactly one resolved factor difference/);
  });

  it("holds judge, embedding, provider, corpus, and scoring resources equal", () => {
    const b = side("b", { opportunityEvaluator: "model-b" });
    b.config.fixed = { ...fixed, judgeModelId: "judge-v2" };
    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" }), b], mode: "ordinary",
    })).toThrow(/judgeModelId must be equal/);
  });

  it("rejects duplicate triggers, asymmetric resolved maps, and credential keys", () => {
    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent", "intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" })], mode: "ordinary",
    })).toThrow(/duplicate trigger intent/);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a", lensInferrer: "model-lens" }),
        side("b", { opportunityEvaluator: "model-b" }),
      ],
      mode: "ordinary",
    })).toThrow(/model key sets must be equal/);

    expect(() => buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [side("a", { opportunityEvaluator: "model-a" }, { OPENROUTER_API_KEY: "secret" })], mode: "ordinary",
    })).toThrow(/credential key OPENROUTER_API_KEY/);
  });

  it("allows labelled exploratory multi-factor plans without a causal claim", () => {
    const plan = buildHistoricalExperimentPlan({
      caseIds: ["case-1"], triggers: ["intent"], repetitions: 1,
      sides: [
        side("a", { opportunityEvaluator: "model-a" }, { DISCOVERY_ALLOWED_TYPES: "intent" }),
        side("b", { opportunityEvaluator: "model-b" }, { DISCOVERY_ALLOWED_TYPES: "intent,profile" }),
      ],
      mode: "exploratory",
    });
    expect(plan.factorDifferences).toHaveLength(2);
    expect(plan.causalClaimAllowed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the experiment spec to verify it fails**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts
```

Expected: FAIL with `Cannot find module '../historical-quality.experiment.js'`.

- [ ] **Step 3: Implement resolved config diffing and deterministic plan construction**

Create `packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts` with these public contracts:

```ts
import { isCredentialEnvKey } from "../ops/ops.allowlist.js";

export const HISTORICAL_QUALITY_TRIGGERS = ["intent", "enrichment"] as const;
export type HistoricalQualityTrigger = typeof HISTORICAL_QUALITY_TRIGGERS[number];
export const HISTORICAL_QUALITY_MAX_ATTEMPTS = 1;
export const HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS = 200;

export interface HistoricalFixedResources {
  judgeModelId: string;
  embeddingModelId: string;
  providerAccountFingerprint: string;
  corpusVersion: string;
  scoringPolicyFingerprint: string;
}

export interface HistoricalResolvedConfig {
  models: Record<string, string>;
  env: Record<string, string>;
  fixed: HistoricalFixedResources;
}

export interface HistoricalExperimentSide {
  id: "a" | "b";
  config: HistoricalResolvedConfig;
}

export type HistoricalFactorDifference = {
  kind: "model" | "env";
  key: string;
  a: string | null;
  b: string | null;
};

export interface HistoricalExperimentSlot {
  caseId: string;
  trigger: HistoricalQualityTrigger;
  repetition: number;
  sideId: "a" | "b";
  attempt: 1;
}

export interface HistoricalExperimentInput {
  caseIds: string[];
  triggers: HistoricalQualityTrigger[];
  repetitions: number;
  sides: [HistoricalExperimentSide] | [HistoricalExperimentSide, HistoricalExperimentSide];
  mode: "ordinary" | "exploratory";
}

export interface HistoricalExperimentPlan {
  slots: HistoricalExperimentSlot[];
  graphInvocations: number;
  maxAttempts: 1;
  factorDifferences: HistoricalFactorDifference[];
  causalClaimAllowed: boolean;
}
```

Implement the helpers with deterministic ordering:

```ts
function mapDiff(kind: "model" | "env", a: Record<string, string>, b: Record<string, string>): HistoricalFactorDifference[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .filter((key) => (a[key] ?? null) !== (b[key] ?? null))
    .map((key) => ({ kind, key, a: a[key] ?? null, b: b[key] ?? null }));
}

export function diffResolvedHistoricalConfigs(a: HistoricalResolvedConfig, b: HistoricalResolvedConfig): HistoricalFactorDifference[] {
  return [...mapDiff("model", a.models, b.models), ...mapDiff("env", a.env, b.env)];
}

function assertFixedResourcesEqual(a: HistoricalFixedResources, b: HistoricalFixedResources): void {
  for (const key of ["judgeModelId", "embeddingModelId", "providerAccountFingerprint", "corpusVersion", "scoringPolicyFingerprint"] as const) {
    if (a[key].trim() === "" || b[key].trim() === "") throw new Error(`Historical comparison ${key} must be non-empty`);
    if (a[key] !== b[key]) throw new Error(`Historical comparison ${key} must be equal across sides`);
  }
}

function assertSameKeySet(label: "model" | "env", a: Record<string, string>, b: Record<string, string>): void {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
    throw new Error(`Historical comparison ${label} key sets must be equal across sides`);
  }
}

export function buildHistoricalExperimentPlan(input: HistoricalExperimentInput): HistoricalExperimentPlan {
  if (input.caseIds.length === 0) throw new Error("Historical experiment requires at least one case");
  if (new Set(input.caseIds).size !== input.caseIds.length) throw new Error("Historical experiment case IDs must be unique");
  if (input.triggers.length === 0) throw new Error("Historical experiment requires at least one trigger");
  const seenTriggers = new Set<HistoricalQualityTrigger>();
  for (const trigger of input.triggers) {
    if (seenTriggers.has(trigger)) throw new Error(`Historical experiment has duplicate trigger ${trigger}`);
    seenTriggers.add(trigger);
  }
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1) throw new Error("Historical repetitions must be a positive integer");
  if (input.sides[0].id !== "a" || (input.sides.length === 2 && input.sides[1].id !== "b")) {
    throw new Error("Historical sides must be [a] or [a, b]");
  }
  for (const side of input.sides) {
    for (const [agent, modelId] of Object.entries(side.config.models)) {
      if (agent.trim() === "" || modelId.trim() === "") throw new Error("Historical resolved model assignments must be non-empty");
    }
    for (const [key, value] of Object.entries(side.config.env)) {
      if (isCredentialEnvKey(key)) throw new Error(`Historical resolved config contains credential key ${key}`);
      if (value.trim() === "") throw new Error(`Historical resolved env ${key} must be non-empty`);
    }
    for (const [key, value] of Object.entries(side.config.fixed)) {
      if (value.trim() === "") throw new Error(`Historical fixed resource ${key} must be non-empty`);
    }
  }
  if (input.mode === "exploratory" && input.sides.length !== 2) {
    throw new Error("Historical exploratory mode requires two sides");
  }

  const factorDifferences = input.sides.length === 2
    ? diffResolvedHistoricalConfigs(input.sides[0].config, input.sides[1].config)
    : [];
  if (input.sides.length === 2) {
    assertSameKeySet("model", input.sides[0].config.models, input.sides[1].config.models);
    assertSameKeySet("env", input.sides[0].config.env, input.sides[1].config.env);
    assertFixedResourcesEqual(input.sides[0].config.fixed, input.sides[1].config.fixed);
    if (input.mode === "ordinary" && factorDifferences.length !== 1) {
      throw new Error(`Historical ordinary comparison requires exactly one resolved factor difference (received ${factorDifferences.length})`);
    }
    if (input.mode === "exploratory" && factorDifferences.length === 0) {
      throw new Error("Historical exploratory comparison requires at least one resolved factor difference");
    }
  }

  const graphInvocations = input.caseIds.length * input.triggers.length * input.repetitions * input.sides.length * HISTORICAL_QUALITY_MAX_ATTEMPTS;
  if (graphInvocations > HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS) {
    throw new Error(`${graphInvocations} graph invocations exceeds hard cap ${HISTORICAL_QUALITY_MAX_GRAPH_INVOCATIONS}`);
  }

  const slots: HistoricalExperimentSlot[] = [];
  for (const caseId of input.caseIds) {
    for (const trigger of input.triggers) {
      for (let repetition = 0; repetition < input.repetitions; repetition += 1) {
        for (const side of input.sides) slots.push({ caseId, trigger, repetition, sideId: side.id, attempt: 1 });
      }
    }
  }
  return {
    slots,
    graphInvocations,
    maxAttempts: HISTORICAL_QUALITY_MAX_ATTEMPTS,
    factorDifferences,
    causalClaimAllowed: input.mode === "ordinary" && input.sides.length === 2,
  };
}
```

Do not compute or persist the secret-free configuration fingerprint in this issue. IND-641 owns resolved provenance and hashes after it defines the child-spawn boundary. This contract defines exactly what the fingerprint input must contain.

- [ ] **Step 4: Run experiment, suite, and type tests**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.cases.spec.ts \
  eval/discovery-env-matrix/tests/historical-matrix.policy.spec.ts
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
```

Expected: all tests and typecheck pass.

- [ ] **Step 5: Commit the experiment contract**

```bash
git add packages/protocol/eval/discovery-env-matrix/historical-quality.experiment.ts \
  packages/protocol/eval/discovery-env-matrix/tests/historical-quality.experiment.spec.ts
git commit -m "test(eval): define historical experiment contract"
```

---

### Task 4: Document the migration boundary and verify the provider-free suite

**Files:**
- Modify: `packages/protocol/eval/README.md`
- Verify: all new and existing `discovery-env-matrix` specs

**Interfaces:**
- Consumes: all contracts from Tasks 1–3.
- Produces: an explicit operator/developer boundary: IND-636 is preparatory, IND-637 migrates corpus data, IND-638 integrates runtime/fixture/metrics, and IND-641 integrates child-spawn A/B provenance.

- [ ] **Step 1: Add a focused README section after the harness table**

Insert:

```markdown
### Historical discovery quality v2 contracts

`eval/discovery-env-matrix/historical-quality.{corpus,metrics,experiment}.ts` defines the
provider-free contract for the Historical Discovery Quality project (IND-636): cited
pre-connection evidence, model-safe projection, user-level retrieval/evaluator attribution,
and one-attempt/200-invocation one-factor experiment planning.

These modules are deliberately **not wired into the current five cases or live discovery
runner yet**. IND-637 migrates and independently reviews the historical corpus; IND-638
builds the shared-pool dual-trigger fixture/runtime; IND-641 applies resolved side
configuration at child spawn. Until those issues land, `eval:matching`,
`eval:discovery-env-matrix`, and `eval:discovery` retain their existing behavior.
```

- [ ] **Step 2: Run all focused provider-free verification**

```bash
cd packages/protocol
bun test eval/discovery-env-matrix/tests/
bun x tsc --noEmit -p eval/discovery-env-matrix/tsconfig.json
bun run eval:verify
```

Expected:

- every `discovery-env-matrix` test passes;
- suite typecheck exits 0;
- `eval:verify` reports all 13 suites type-checked and tested;
- no provider credentials are required or read.

- [ ] **Step 3: Audit issue scope and repository state**

```bash
cd ../..
git diff --check
git status --short
git diff -- packages/protocol/eval/discovery-env-matrix packages/protocol/eval/README.md
```

Confirm:

- only the six new contract/spec files and `packages/protocol/eval/README.md` changed;
- `matching.historical.ts`, baselines, `services/api/**`, `apps/eval-ops/**`, and production `packages/protocol/src/**` did not change;
- no run artifacts, environment files, or database outputs are staged.

- [ ] **Step 4: Commit documentation and final verification boundary**

```bash
git add packages/protocol/eval/README.md
git commit -m "docs(eval): document historical quality contract"
```

- [ ] **Step 5: Attach exact evidence to IND-636**

Update IND-636 with:

- changed files;
- focused test command/output counts;
- `eval:verify` result;
- statement that no provider/database command ran;
- residual handoff: current five cases remain v1 until IND-637, and no live path consumes these contracts until IND-638/641.

Do not mark IND-636 Done until its PR is merged and dev CI verifies the provider-free gate.

---

## Plan Self-Review Checklist

Before execution, verify:

- Each spec requirement assigned to IND-636 has a task: evidence/projection (Task 1), retrieval/evaluator/completeness metrics (Task 2), trigger/workload/one-factor planning (Task 3), migration boundary and full provider-free verification (Task 4).
- No task migrates current corpus data, changes runtime behavior, touches a database/provider, or creates a baseline.
- Public names are consistent across tasks:
  - `HistoricalQualityCase`
  - `validateHistoricalQualityCase`
  - `historicalModelSafeProjection`
  - `dedupeHistoricalRetrieval`
  - `classifyHistoricalFailureStage`
  - `executionCompletenessFields`
  - `buildHistoricalExperimentPlan`
  - `diffResolvedHistoricalConfigs`
- The full paired workload is 180 and 17 cases at the same shape is 204, which is refused.
- Automatic retry is unrepresentable: every slot has literal `attempt: 1` and `maxAttempts: 1`.
