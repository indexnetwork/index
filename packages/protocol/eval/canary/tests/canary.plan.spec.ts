/**
 * Provider-free specs for canary plan building: budget math, argv shape,
 * measurement-only invariants, and the plan/dry-run subprocess (IND-447).
 */
import { describe, expect, test } from "bun:test";
import path from "path";
import { fingerprintEvalCorpus } from "../../shared/index.js";
import { CANARY_MAX_ATTEMPTS_PER_RUN, parseCanaryManifest, resolveCanaryManifest, type CanaryManifest, type CanarySuiteName } from "../canary.manifest.js";
import { buildCanaryPlan, canaryArtifactFileName, formatCanaryPlanText } from "../canary.plan.js";
import { CANARY_SUITE_DEFINITIONS, canaryCorpora, type CanarySuiteDefinition } from "../canary.suites.js";

const PACKAGE_DIR = path.resolve(import.meta.dir, "../../..");
const PROVIDER_ENV_VARS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY"];

const FAKE_GIT = { revision: "a".repeat(40), dirty: false as const };

function fakeDefinitions(): Record<CanarySuiteName, CanarySuiteDefinition> {
  return {
    ...CANARY_SUITE_DEFINITIONS,
    matching: {
      ...CANARY_SUITE_DEFINITIONS.matching,
      attemptTimeoutMs: 90_000,
      cases: [{ id: "a/b" }, { id: "c/d" }, { id: "e/f" }],
    },
    premise: {
      ...CANARY_SUITE_DEFINITIONS.premise,
      attemptTimeoutMs: 90_000,
      cases: [{ id: "p/q" }],
    },
  };
}

function fakeManifest(): CanaryManifest {
  return parseCanaryManifest({
    artifactType: "index-eval/canary-manifest",
    schemaVersion: 1,
    description: "plan spec manifest",
    runsPerCase: 2,
    alpha: 0.05,
    suites: { matching: { cases: ["a/b", "c/d"] }, premise: { cases: ["p/q"] } },
  });
}

function buildFakePlan() {
  const manifest = fakeManifest();
  const definitions = fakeDefinitions();
  const selection = resolveCanaryManifest(manifest, {
    matching: { suite: "matching", caseIds: definitions.matching.cases.map((c) => c.id) },
    premise: { suite: "premise", caseIds: definitions.premise.cases.map((c) => c.id) },
  });
  return buildCanaryPlan({
    manifest,
    selection,
    definitions,
    outDir: "eval/canary/runs/spec",
    resolveModelName: (agent) => `fake/${agent}`,
    git: FAKE_GIT,
    judgeModelId: "fake/judge",
  });
}

describe("buildCanaryPlan", () => {
  test("computes exact budget figures from cases × runs × retry ceiling", () => {
    const plan = buildFakePlan();
    // matching: 2 cases × 2 runs × 1 call, premise: 1 case × 2 runs × 2 calls ceiling.
    expect(plan.budget.totalCases).toBe(3);
    expect(plan.budget.requestedRunSlots).toBe(6);
    expect(plan.budget.primaryCallFloor).toBe(6);
    expect(plan.budget.primaryCallCeiling).toBe(4 * CANARY_MAX_ATTEMPTS_PER_RUN * 1 + 2 * CANARY_MAX_ATTEMPTS_PER_RUN * 2);
    expect(plan.budget.wallClockCeilingMs).toBe(6 * CANARY_MAX_ATTEMPTS_PER_RUN * 90_000);
    expect(plan.budget.tokenTelemetry).toBe("unavailable");
    expect(plan.budget.costTelemetry).toBe("unavailable");
  });

  test("plans one invocation per (suite, case) with the declared flags only", () => {
    const plan = buildFakePlan();
    expect(plan.invocations).toHaveLength(3);
    const first = plan.invocations[0];
    expect(first.argv[0]).toBe("eval/matching/matching.eval.ts");
    expect(first.argv).toContain("--case");
    expect(first.argv).toContain("a/b");
    expect(first.argv).toContain("--runs");
    expect(first.argv).toContain("2");
    expect(first.argv).toContain("--no-save");
    expect(first.argv).toContain("--report");
  });

  test("measurement-only: no invocation carries baseline-mutating or rerun-selective flags", () => {
    const plan = buildFakePlan();
    for (const invocation of plan.invocations) {
      expect(invocation.argv).not.toContain("--update-baseline");
      expect(invocation.argv).not.toContain("--force");
      expect(invocation.argv).not.toContain("--strict-evidence");
      expect(invocation.argv).not.toContain("--no-judge");
    }
  });

  test("per-invocation corpus fingerprint matches what the harness will record for that selection", () => {
    const plan = buildFakePlan();
    const definitions = fakeDefinitions();
    const first = plan.invocations[0];
    expect(first.corpusFingerprint).toBe(fingerprintEvalCorpus([definitions.matching.cases[0]]));
  });

  test("plan text prints provenance, pinned models, caps, and honest telemetry gaps", () => {
    const plan = buildFakePlan();
    const text = formatCanaryPlanText(plan);
    expect(text).toContain(FAKE_GIT.revision);
    expect(text).toContain("fake/opportunityEvaluator");
    expect(text).toContain("fake/judge");
    expect(text).toContain("embedding models: none");
    expect(text).toContain("run slots");
    expect(text).toContain("tokens: unavailable · cost: unavailable");
    expect(text).toContain("config fingerprint");
    expect(text).not.toContain("--update-baseline");
  });

  test("artifact file names are filesystem-safe and unique per case", () => {
    expect(canaryArtifactFileName("matching", "rule/case-id")).toBe("matching--rule-case-id.json");
    const plan = buildFakePlan();
    const names = plan.invocations.map((invocation) => invocation.artifactFile);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("committed manifest plan", () => {
  test("builds deterministically against the live corpora with injected models", async () => {
    const manifest = parseCanaryManifest(await Bun.file(path.resolve(import.meta.dir, "../canary.manifest.json")).json());
    const selection = resolveCanaryManifest(manifest, canaryCorpora());
    const build = () =>
      buildCanaryPlan({
        manifest,
        selection,
        definitions: CANARY_SUITE_DEFINITIONS,
        outDir: "eval/canary/runs/spec",
        resolveModelName: (agent) => `pinned/${agent}`,
        git: FAKE_GIT,
        judgeModelId: "pinned/judge",
      });
    const a = build();
    const b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.budget.requestedRunSlots).toBe(selection.totalCases * manifest.runsPerCase);
  });
});

describe("canary --plan subprocess (provider-free dry run)", () => {
  test(
    "exits 0, prints the plan, and executes nothing without provider credentials",
    async () => {
      const env: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
      for (const key of PROVIDER_ENV_VARS) delete env[key];
      const proc = Bun.spawn({
        cmd: ["bun", "eval/canary/canary.eval.ts", "--plan"],
        cwd: PACKAGE_DIR,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Eval canary plan (provider-free)");
      expect(stdout).toContain("Budget estimate");
      expect(stdout).toContain("Plan only — no provider calls were made, nothing was written.");
      expect(stderr).not.toContain("OPENROUTER_API_KEY is required");
    },
    30_000,
  );
});
