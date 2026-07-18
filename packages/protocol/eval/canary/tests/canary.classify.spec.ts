/**
 * Provider-free specs for canary outcome classification, exit aggregation,
 * the redaction/leak scan, and the summary artifact (IND-447).
 */
import { describe, expect, test } from "bun:test";
import { aggregateCanaryExitCode, buildCanarySummary, classifyCanaryInvocation, formatCanarySummaryMarkdown, scanForSecretLeaks, type CanaryInvocationRecord } from "../canary.classify.js";
import { parseCanaryManifest, resolveCanaryManifest, type CanaryManifest } from "../canary.manifest.js";
import { buildCanaryPlan, type CanaryPlan } from "../canary.plan.js";
import { CANARY_SUITE_DEFINITIONS } from "../canary.suites.js";

describe("classifyCanaryInvocation", () => {
  test("maps the governance exit contract to alert classes", () => {
    expect(classifyCanaryInvocation({ exitCode: 0, artifactPresent: true, artifactComplete: true }).classification).toBe("pass");
    expect(classifyCanaryInvocation({ exitCode: 1, artifactPresent: true, artifactComplete: true }).classification).toBe("regression");
    expect(classifyCanaryInvocation({ exitCode: 3, artifactPresent: true, artifactComplete: true }).classification).toBe("insufficient-evidence");
  });

  test("distinguishes provider incidents from baseline incompatibility on exit 2 via artifact completeness", () => {
    expect(classifyCanaryInvocation({ exitCode: 2, artifactPresent: true, artifactComplete: true }).classification).toBe("baseline-incompatibility");
    expect(classifyCanaryInvocation({ exitCode: 2, artifactPresent: true, artifactComplete: false }).classification).toBe("provider-incident");
    expect(classifyCanaryInvocation({ exitCode: 2, artifactPresent: false, artifactComplete: null }).classification).toBe("provider-incident");
  });

  test("treats an unreaped/unspawnable process as a provider incident", () => {
    const result = classifyCanaryInvocation({ exitCode: null, artifactPresent: false, artifactComplete: null });
    expect(result.classification).toBe("provider-incident");
    expect(result.detail).toContain("failed to run");
  });
});

describe("aggregateCanaryExitCode", () => {
  test("prioritizes incidents/incompatibility (2), then insufficient evidence (3), then regression (1)", () => {
    expect(aggregateCanaryExitCode(["pass", "pass"])).toBe(0);
    expect(aggregateCanaryExitCode(["pass", "regression"])).toBe(1);
    expect(aggregateCanaryExitCode(["regression", "insufficient-evidence"])).toBe(3);
    expect(aggregateCanaryExitCode(["regression", "insufficient-evidence", "provider-incident"])).toBe(2);
    expect(aggregateCanaryExitCode(["baseline-incompatibility", "pass"])).toBe(2);
    expect(aggregateCanaryExitCode([])).toBe(0);
  });
});

describe("scanForSecretLeaks", () => {
  test("finds raw secret-like env values and reports names only", () => {
    const env = { OPENROUTER_API_KEY: "super-secret-value-123", HOME: "/home/user" };
    const findings = scanForSecretLeaks("error: called with super-secret-value-123 in body", env);
    expect(findings).toEqual(["env:OPENROUTER_API_KEY"]);
    expect(findings.join(" ")).not.toContain("super-secret-value-123");
  });

  test("ignores non-secret-like names and short values", () => {
    expect(scanForSecretLeaks("path /home/user here", { HOME: "/home/user" })).toEqual([]);
    expect(scanForSecretLeaks("ab present", { SHORT_KEY: "ab" })).toEqual([]);
  });

  test("flags provider-key-shaped strings even without env context", () => {
    expect(scanForSecretLeaks(`token sk-${"a".repeat(20)} leaked`, {})).toEqual(["pattern:provider-key-like"]);
  });

  test("returns empty for clean artifact content", () => {
    expect(scanForSecretLeaks('{"artifactType":"index-eval/run-report","cases":[]}', { OPENROUTER_API_KEY: "super-secret-value-123" })).toEqual([]);
  });
});

function fakePlan(): CanaryPlan {
  const manifest = parseCanaryManifest({
    artifactType: "index-eval/canary-manifest",
    schemaVersion: 1,
    description: "classify spec manifest",
    runsPerCase: 1,
    alpha: 0.05,
    suites: { opportunity: { cases: ["greeting/plain-prose"] } },
  }) as CanaryManifest;
  const selection = resolveCanaryManifest(manifest, {
    opportunity: { suite: "opportunity", caseIds: CANARY_SUITE_DEFINITIONS.opportunity.cases.map((c) => c.id) },
  });
  return buildCanaryPlan({
    manifest,
    selection,
    definitions: CANARY_SUITE_DEFINITIONS,
    outDir: "eval/canary/runs/spec",
    resolveModelName: (agent) => `fake/${agent}`,
    git: { revision: "b".repeat(40), dirty: false },
    judgeModelId: "fake/judge",
  });
}

function record(overrides: Partial<CanaryInvocationRecord> = {}): CanaryInvocationRecord {
  return {
    suite: "opportunity",
    caseId: "greeting/plain-prose",
    artifactFile: "opportunity--greeting-plain-prose.json",
    exitCode: 0,
    classification: "pass",
    detail: "ok",
    durationMs: 1200,
    artifactPresent: true,
    artifactComplete: true,
    execution: { requestedRuns: 1, completedRuns: 1, totalAttempts: 1 },
    ...overrides,
  };
}

describe("buildCanarySummary + markdown", () => {
  test("aggregates counts, actuals, and the exit code from recorded evidence", () => {
    const summary = buildCanarySummary({
      plan: fakePlan(),
      invocations: [record(), record({ classification: "regression", exitCode: 1 })],
      redactionQuarantines: [],
      startedAt: "2026-02-10T00:00:00.000Z",
      completedAt: "2026-02-10T00:10:00.000Z",
    });
    expect(summary.classificationCounts.pass).toBe(1);
    expect(summary.classificationCounts.regression).toBe(1);
    expect(summary.exitCode).toBe(1);
    expect(summary.actuals.totalAttempts).toBe(2);
    expect(summary.actuals.tokenTelemetry).toBe("unavailable");
    expect(summary.actuals.costTelemetry).toBe("unavailable");
  });

  test("reports attempts as unavailable when any artifact lacks execution evidence", () => {
    const summary = buildCanarySummary({
      plan: fakePlan(),
      invocations: [record({ execution: null, classification: "provider-incident", exitCode: 2, artifactComplete: null })],
      redactionQuarantines: [],
      startedAt: "2026-02-10T00:00:00.000Z",
      completedAt: "2026-02-10T00:10:00.000Z",
    });
    expect(summary.actuals.totalAttempts).toBeNull();
    expect(summary.exitCode).toBe(2);
  });

  test("a redaction quarantine forces exit 2 even when every invocation passed", () => {
    const summary = buildCanarySummary({
      plan: fakePlan(),
      invocations: [record()],
      redactionQuarantines: [{ file: "opportunity--greeting-plain-prose.log", findings: ["env:OPENROUTER_API_KEY"] }],
      startedAt: "2026-02-10T00:00:00.000Z",
      completedAt: "2026-02-10T00:10:00.000Z",
    });
    expect(summary.exitCode).toBe(2);
  });

  test("markdown distinguishes all four alert classes, shows budget vs actuals, and leaks nothing", () => {
    const env = { OPENROUTER_API_KEY: "super-secret-value-123" };
    const summary = buildCanarySummary({
      plan: fakePlan(),
      invocations: [
        record(),
        record({ classification: "regression", exitCode: 1 }),
        record({ classification: "provider-incident", exitCode: 2, artifactComplete: false }),
        record({ classification: "baseline-incompatibility", exitCode: 2 }),
        record({ classification: "insufficient-evidence", exitCode: 3 }),
      ],
      redactionQuarantines: [],
      startedAt: "2026-02-10T00:00:00.000Z",
      completedAt: "2026-02-10T00:10:00.000Z",
    });
    const markdown = formatCanarySummaryMarkdown(summary);
    expect(markdown).toContain("regression");
    expect(markdown).toContain("provider incident");
    expect(markdown).toContain("baseline incompatibility");
    expect(markdown).toContain("insufficient evidence");
    expect(markdown).toContain("do not gate");
    expect(markdown).toContain("tokens/cost: unavailable");
    expect(scanForSecretLeaks(markdown, env)).toEqual([]);
  });
});
