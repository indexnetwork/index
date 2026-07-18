import { describe, expect, it } from "bun:test";

import { renderViewerFailureHtml, renderViewerHtml } from "../viewer.html.js";
import { applyViewerBaseline } from "../viewer.baseline.js";
import { toViewerFailure } from "../viewer.redaction.js";
import { VIEWER_ADAPTERS, adaptViewerArtifact } from "../viewer.registry.js";
import { ViewerSafeError } from "../viewer.types.js";
import { makeAttemptAwareV2RunReport, makeCompleteV2RunReport, makeHydePublicBatch, readCommittedBaseline, SHARED_HARNESSES, V2_ERROR_SENTINEL } from "./viewer.fixtures.js";

const SOURCE = { sha256: "a".repeat(64), byteLength: 1_024 };
const BASELINE_SOURCE = { sha256: "b".repeat(64), byteLength: 2_048 };
const SENSITIVE_SENTINEL = "VIEWER_PRIVATE_SENTINEL_9f6634";

interface RawAssertion {
  kind: string;
  passed: boolean;
  detail?: string;
  [key: string]: unknown;
}

interface RawRunResult {
  passed: boolean;
  assertions: RawAssertion[];
  [key: string]: unknown;
}

interface RawCase {
  caseId: string;
  rule: string;
  runs: number;
  passes: number;
  passRate: number;
  flaky: boolean;
  runResults: RawRunResult[];
  [key: string]: unknown;
}

interface RawArtifact {
  artifactType: string;
  schemaVersion: number;
  harness: string;
  harnessVersion: string;
  completeness: {
    caseCount: number;
    ruleCount: number;
    totalRuns: number;
    totalPasses: number;
    flakyCaseCount: number;
  };
  payload: {
    aggregatePassRate: number;
    rules: Array<{ rule: string; caseCount: number; passRate: number }>;
    cases: RawCase[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function asRawArtifact(value: Record<string, unknown>): RawArtifact {
  return structuredClone(value) as unknown as RawArtifact;
}

function seedSensitiveFields(artifact: RawArtifact): void {
  const firstCase = artifact.payload.cases[0];
  const firstAssertion = firstCase?.runResults[0]?.assertions[0];
  if (!firstCase || !firstAssertion) throw new Error("Fixture requires one assertion");
  firstCase.candidates = [SENSITIVE_SENTINEL];
  firstCase.reasoning = SENSITIVE_SENTINEL;
  firstCase.rawReasoning = SENSITIVE_SENTINEL;
  firstCase.piiHits = [SENSITIVE_SENTINEL];
  firstCase.input = SENSITIVE_SENTINEL;
  firstCase.profileContext = SENSITIVE_SENTINEL;
  firstCase.expect = SENSITIVE_SENTINEL;
  firstCase.apiKey = SENSITIVE_SENTINEL;
  firstCase.authorization = SENSITIVE_SENTINEL;
  firstCase.headers = { authorization: SENSITIVE_SENTINEL };
  firstCase.embedding = [0.123, 0.456];
  firstCase.embeddings = [[0.123, 0.456]];
  firstCase.secret = SENSITIVE_SENTINEL;
  firstCase.secrets = [SENSITIVE_SENTINEL];
  firstCase.mappings = { private: SENSITIVE_SENTINEL };
  firstCase.runResults[0]!.secret = SENSITIVE_SENTINEL;
  firstAssertion.detail = SENSITIVE_SENTINEL;
  firstAssertion.candidateId = SENSITIVE_SENTINEL;
}

function setPasses(caseResult: RawCase, passes: number): void {
  caseResult.runResults.forEach((runResult, index) => {
    const passed = index < passes;
    runResult.assertions.forEach((assertion) => {
      assertion.passed = true;
    });
    if (!passed) {
      const first = runResult.assertions[0];
      if (!first) throw new Error("Fixture run requires one assertion");
      first.passed = false;
    }
    runResult.passed = passed;
  });
  caseResult.passes = passes;
  caseResult.passRate = passes / caseResult.runs;
  caseResult.flaky = passes > 0 && passes < caseResult.runs;
}

function recompute(artifact: RawArtifact): void {
  const cases = artifact.payload.cases;
  const rules = [...new Set(cases.map((entry) => entry.rule))].map((rule) => {
    const members = cases.filter((entry) => entry.rule === rule);
    return {
      rule,
      caseCount: members.length,
      passRate: members.reduce((sum, entry) => sum + entry.passRate, 0) / members.length,
    };
  });
  artifact.payload.rules = rules;
  artifact.payload.aggregatePassRate = cases.reduce((sum, entry) => sum + entry.passRate, 0) / cases.length;
  artifact.completeness = {
    caseCount: cases.length,
    ruleCount: rules.length,
    totalRuns: cases.reduce((sum, entry) => sum + entry.runs, 0),
    totalPasses: cases.reduce((sum, entry) => sum + entry.passes, 0),
    flakyCaseCount: cases.filter((entry) => entry.flaky).length,
  };
}

describe("explicit viewer adapters", () => {
  it("renders all four committed baselines through allowlisted projections", async () => {
    for (const harness of SHARED_HARNESSES) {
      const artifact = asRawArtifact(await readCommittedBaseline(harness));
      const expectedCases = artifact.completeness.caseCount;
      seedSensitiveFields(artifact);

      const document = adaptViewerArtifact(artifact, { source: SOURCE });
      const html = renderViewerHtml(document);

      expect(document.adapterId).toBe(`shared-${harness}-baseline-v1`);
      expect(document.items).toHaveLength(expectedCases);
      expect(document.telemetryNotice).toContain("attempt telemetry was not recorded");
      expect(document.items.every((item) => !item.executionAvailable && item.executionRuns.length === 0)).toBe(true);
      expect(JSON.stringify(document)).not.toContain(SENSITIVE_SENTINEL);
      expect(html).not.toContain(SENSITIVE_SENTINEL);
      expect(html).not.toContain('"detail":');
      expect(html).not.toContain('"candidateId":');
      expect(html).not.toContain('"embedding":');
      expect(html).not.toContain('"headers":');
      expect(html).not.toContain('"mappings":');
    }
  });

  it("reconstructs digest-only source metadata at every adapter boundary", () => {
    const sourceWithPrivateFields = {
      ...SOURCE,
      path: SENSITIVE_SENTINEL,
      privateNote: SENSITIVE_SENTINEL,
    };
    const shared = adaptViewerArtifact(makeCompleteV2RunReport(), { source: sourceWithPrivateFields });
    const hyde = adaptViewerArtifact(makeHydePublicBatch(), { source: sourceWithPrivateFields });
    for (const document of [shared, hyde]) {
      expect(document.source).toEqual(SOURCE);
      expect(JSON.stringify(document)).not.toContain(SENSITIVE_SENTINEL);
      expect(renderViewerHtml(document)).not.toContain(SENSITIVE_SENTINEL);
    }
  });

  it("projects v2 structural attempt evidence while redacting provider errors", () => {
    const artifact = makeAttemptAwareV2RunReport();
    const document = adaptViewerArtifact(artifact, { source: SOURCE });
    const html = renderViewerHtml(document);
    const partial = document.items.find((item) => item.id === "attempt-partial");
    const zero = document.items.find((item) => item.id === "attempt-zero");

    expect(document.adapterId).toBe("shared-matching-run-report-v2");
    expect(document.kind).toBe("shared-scorecard-v2");
    expect(document.sharedComparison?.executionComplete).toBe(false);
    expect(document.completeness).toContainEqual({ label: "Requested runs", value: "6" });
    expect(document.completeness).toContainEqual({ label: "Recovered runs", value: "1" });
    expect(document.completeness).toContainEqual({ label: "Complete", value: "false" });
    expect(partial?.state).toBe("incomplete");
    expect(partial?.fields).toContainEqual({ label: "Scored output state", value: "pass" });
    expect(partial?.diagnostics[0]?.run).toBe(2);
    expect(partial?.executionRuns).toHaveLength(3);
    expect(partial?.executionRuns[1]).toMatchObject({ run: 2, outcome: "success", recovered: true });
    expect(partial?.executionRuns[1]?.attempts).toHaveLength(2);
    expect(zero?.state).toBe("unjudged");
    expect(zero?.runs).toBe(0);
    expect(zero?.executionAvailable).toBe(true);
    expect(JSON.stringify(document)).not.toContain(V2_ERROR_SENTINEL);
    expect(JSON.stringify(document)).not.toContain('"error":');
    expect(html).not.toContain(V2_ERROR_SENTINEL);
    expect(html).toContain("attempt-partial::run:2::attempt:2");
  });

  it("renders v2 baseline and run-report identities for all four harness adapters", () => {
    const assertionKinds = {
      matching: "match",
      profile: "name",
      premise: "count",
      opportunity: "non_empty",
    } as const;
    for (const harness of SHARED_HARNESSES) {
      for (const artifactKind of ["baseline", "run-report"] as const) {
        const artifact = structuredClone(makeCompleteV2RunReport());
        artifact.harness = harness;
        artifact.artifactType = artifactKind === "baseline"
          ? "index-eval/baseline"
          : "index-eval/run-report";
        const sourceCase = artifact.payload.cases[0] as typeof artifact.payload.cases[0] & {
          runResults: Array<{ assertions: Array<{ kind: string }> }>;
        };
        sourceCase.runResults[0]!.assertions[0]!.kind = assertionKinds[harness];
        const document = adaptViewerArtifact(artifact, { source: SOURCE });
        expect(document.adapterId).toBe(`shared-${harness}-${artifactKind}-v2`);
        expect(document.kind).toBe("shared-scorecard-v2");
      }
    }
  });

  it("fails closed on malformed v2 execution cross-fields without echoing source values", () => {
    const artifact = structuredClone(makeAttemptAwareV2RunReport());
    artifact.execution.runs[0]!.runId = V2_ERROR_SENTINEL;
    let caught: unknown;
    try {
      adaptViewerArtifact(artifact, { source: SOURCE });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ViewerSafeError);
    const html = renderViewerFailureHtml(toViewerFailure(caught, SOURCE));
    expect(html).not.toContain(V2_ERROR_SENTINEL);
  });

  it("renders only the strict HyDE blind public batch", () => {
    const document = adaptViewerArtifact(makeHydePublicBatch(), { source: SOURCE });
    const html = renderViewerHtml(document);
    expect(document.adapterId).toBe("hyde-blind-public-batch-v4");
    expect(document.items).toHaveLength(901);
    expect(document.items[0]?.state).toBe("unjudged");
    expect(document.items.some((item) => item.group === "generated-document-grounding")).toBe(true);
    expect(html).toContain("PUBLIC_SOURCE_TEXT");
    expect(html).toContain("PUBLIC_ITEM_TEXT");
    expect(html).toContain("PUBLIC_GROUNDING_SOURCE_TEXT");
    expect(html).toContain("PUBLIC_GROUNDING_ITEM_TEXT");
  });

  it("rejects every private/unblinding HyDE family without echoing values", () => {
    const prohibitedTypes = [
      "hyde-evidence-collection",
      "hyde-blind-private-key",
      "hyde-independent-judgment",
      "hyde-resolver-decisions",
      "hyde-resolved-adjudication",
      "hyde-evidence-analysis",
      "hyde-unblinding-map-v9",
      "hyde-private-mapping-v9",
    ];

    for (const artifactType of prohibitedTypes) {
      const value = { artifactType, hmacSecret: SENSITIVE_SENTINEL, mappings: [SENSITIVE_SENTINEL] };
      let caught: unknown;
      try {
        adaptViewerArtifact(value, { source: SOURCE });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ViewerSafeError);
      expect((caught as ViewerSafeError).code).toBe("prohibited-artifact");
      const html = renderViewerFailureHtml(toViewerFailure(caught, SOURCE));
      expect(html).not.toContain(SENSITIVE_SENTINEL);
      expect(html).not.toContain(artifactType);
    }
  });

  it("dispatches only exact shared and HyDE schema identities", async () => {
    expect(VIEWER_ADAPTERS.filter((adapter) => adapter.artifactType.startsWith("index-eval/"))).toHaveLength(16);
    const shared = asRawArtifact(await readCommittedBaseline("matching"));
    const wrongSharedVersion = { ...shared, schemaVersion: 3 };
    const wrongHarnessVersion = { ...shared, harnessVersion: "2" };
    const wrongHydeVersion = { ...makeHydePublicBatch(), schemaVersion: "hyde-private-v99" };
    for (const value of [wrongSharedVersion, wrongHarnessVersion, wrongHydeVersion]) {
      expect(() => adaptViewerArtifact(value, { source: SOURCE })).toThrow(ViewerSafeError);
    }
  });

  it("fails closed on extra private fields and unknown assertion kinds", async () => {
    const publicBatch = { ...makeHydePublicBatch(), hmacSecret: SENSITIVE_SENTINEL };
    expect(() => adaptViewerArtifact(publicBatch, { source: SOURCE })).toThrow(ViewerSafeError);

    const matching = asRawArtifact(await readCommittedBaseline("matching"));
    const assertion = matching.payload.cases[0]?.runResults[0]?.assertions[0];
    if (!assertion) throw new Error("Fixture requires one assertion");
    assertion.kind = SENSITIVE_SENTINEL;
    let caught: unknown;
    try {
      adaptViewerArtifact(matching, { source: SOURCE });
    } catch (error) {
      caught = error;
    }
    const html = renderViewerFailureHtml(toViewerFailure(caught, SOURCE));
    expect(html).toContain("could not be displayed safely");
    expect(html).not.toContain(SENSITIVE_SENTINEL);
  });
});

describe("baseline comparison", () => {
  it("computes improved, regressed, new, missing, and unchanged deltas without mutation", async () => {
    const baselineArtifact = asRawArtifact(await readCommittedBaseline("matching"));
    const currentArtifact = structuredClone(baselineArtifact);
    currentArtifact.artifactType = "index-eval/run-report";
    currentArtifact.corpusFingerprint = "c".repeat(64);

    const baselineImproved = baselineArtifact.payload.cases[0];
    const currentImproved = currentArtifact.payload.cases[0];
    const baselineRegressed = baselineArtifact.payload.cases[1];
    const currentRegressed = currentArtifact.payload.cases[1];
    if (!baselineImproved || !currentImproved || !baselineRegressed || !currentRegressed) {
      throw new Error("Fixture requires two cases");
    }
    setPasses(baselineImproved, baselineImproved.runs - 1);
    setPasses(currentImproved, currentImproved.runs);
    setPasses(baselineRegressed, baselineRegressed.runs);
    setPasses(currentRegressed, currentRegressed.runs - 1);

    const baselineOnly = structuredClone(baselineArtifact.payload.cases[2]!);
    baselineOnly.caseId = "baseline-only-case";
    baselineArtifact.payload.cases.push(baselineOnly);
    const currentOnly = structuredClone(currentArtifact.payload.cases[2]!);
    currentOnly.caseId = "current-only-case";
    currentArtifact.payload.cases.push(currentOnly);
    recompute(baselineArtifact);
    recompute(currentArtifact);

    const baseline = adaptViewerArtifact(baselineArtifact, { source: BASELINE_SOURCE });
    const current = adaptViewerArtifact(currentArtifact, { source: SOURCE });
    const currentBefore = JSON.stringify(current);
    const compared = applyViewerBaseline(current, baseline);

    expect(JSON.stringify(current)).toBe(currentBefore);
    expect(compared.items.find((item) => item.id === currentImproved.caseId)?.delta?.state).toBe("improved");
    expect(compared.items.find((item) => item.id === currentRegressed.caseId)?.delta?.state).toBe("regressed");
    expect(compared.items.find((item) => item.id === "current-only-case")?.delta?.state).toBe("new");
    expect(compared.baseline?.missingItemIds).toContain("baseline-only-case");
    expect(compared.items.some((item) => item.delta?.state === "unchanged")).toBe(true);
  });

  it("allows a complete v2 report to compare with a committed v1 baseline", async () => {
    const current = adaptViewerArtifact(makeCompleteV2RunReport(), { source: SOURCE });
    const baseline = adaptViewerArtifact(await readCommittedBaseline("matching"), { source: BASELINE_SOURCE });
    const compared = applyViewerBaseline(current, baseline);
    expect(compared.kind).toBe("shared-scorecard-v2");
    expect(compared.baseline).toBeDefined();
    expect(compared.items[0]?.delta?.state).toBe("new");
  });

  it("rejects incomplete v2 reports from baseline comparison", async () => {
    const current = adaptViewerArtifact(makeAttemptAwareV2RunReport(), { source: SOURCE });
    const baseline = adaptViewerArtifact(await readCommittedBaseline("matching"), { source: BASELINE_SOURCE });
    expect(() => applyViewerBaseline(current, baseline)).toThrow(/complete/);
  });

  it("rejects a baseline from a different harness", async () => {
    const currentArtifact = asRawArtifact(await readCommittedBaseline("matching"));
    currentArtifact.artifactType = "index-eval/run-report";
    currentArtifact.corpusFingerprint = "c".repeat(64);
    const current = adaptViewerArtifact(currentArtifact, { source: SOURCE });
    const wrong = adaptViewerArtifact(await readCommittedBaseline("profile"), { source: BASELINE_SOURCE });
    expect(() => applyViewerBaseline(current, wrong)).toThrow(/same harness/);
  });

  it("rejects a current run report whose corpus fingerprint is unavailable", async () => {
    const currentArtifact = asRawArtifact(await readCommittedBaseline("matching"));
    currentArtifact.artifactType = "index-eval/run-report";
    const knownBaselineArtifact = structuredClone(makeCompleteV2RunReport());
    knownBaselineArtifact.artifactType = "index-eval/baseline";
    const current = adaptViewerArtifact(currentArtifact, { source: SOURCE });
    const knownBaseline = adaptViewerArtifact(knownBaselineArtifact, { source: BASELINE_SOURCE });
    expect(() => applyViewerBaseline(current, knownBaseline)).toThrow(/compatible corpus/);
  });

  it("rejects baseline-as-current and filtered-run comparisons", async () => {
    const baselineArtifact = asRawArtifact(await readCommittedBaseline("matching"));
    const baseline = adaptViewerArtifact(baselineArtifact, { source: BASELINE_SOURCE });
    expect(() => applyViewerBaseline(baseline, baseline)).toThrow(/run report/);

    const filteredArtifact = structuredClone(baselineArtifact);
    filteredArtifact.artifactType = "index-eval/run-report";
    filteredArtifact.corpusFingerprint = "c".repeat(64);
    filteredArtifact.selection = { fullCorpus: false, filters: { rule: "role-fidelity" } };
    const filtered = adaptViewerArtifact(filteredArtifact, { source: SOURCE });
    expect(filtered.completeness).toContainEqual({
      label: "Selection filter: rule",
      value: "role-fidelity",
    });
    expect(() => applyViewerBaseline(filtered, baseline)).toThrow(/full-corpus/);
  });

  it("fails closed on unreviewed shared selection-filter keys", async () => {
    const artifact = asRawArtifact(await readCommittedBaseline("opportunity"));
    artifact.artifactType = "index-eval/run-report";
    artifact.selection = { fullCorpus: false, filters: { privateQuery: SENSITIVE_SENTINEL } };
    let caught: unknown;
    try {
      adaptViewerArtifact(artifact, { source: SOURCE });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ViewerSafeError);
    expect(renderViewerFailureHtml(toViewerFailure(caught, SOURCE))).not.toContain(SENSITIVE_SENTINEL);
  });
});
