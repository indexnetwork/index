import { describe, it, expect } from "bun:test";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVAL_EXIT_EXECUTION_ERROR, EVAL_EXIT_INSUFFICIENT_EVIDENCE, EVAL_EXIT_PASS, EVAL_EXIT_REGRESSION, arg, flagValue, has, resolveEvalExitCode, runEvalEvidenceFlow } from "../cli.js";

describe("cli helpers", () => {
  const argv = ["bun", "eval.ts", "--runs", "5", "--report", "--html", "out.html", "--rolling-baseline", "--alpha"];

  it("arg reads the value after a flag", () => {
    expect(arg("--runs", argv)).toBe("5");
    expect(arg("--missing", argv)).toBeUndefined();
  });

  it("has detects presence", () => {
    expect(has("--report", argv)).toBe(true);
    expect(has("--nope", argv)).toBe(false);
  });

  it("flagValue ignores a following flag as a value", () => {
    expect(flagValue("--html", argv)).toBe("out.html");
    expect(flagValue("--report", argv)).toBeUndefined(); // followed by --html
    expect(flagValue("--rolling-baseline", argv)).toBeUndefined(); // followed by --alpha
  });
});

describe("eval exit codes", () => {
  const complete = {
    requestedRuns: 3,
    completedRuns: 3,
    failedRuns: 0,
    recoveredRuns: 0,
    totalAttempts: 3,
    complete: true,
  };
  const incomplete = { ...complete, completedRuns: 2, failedRuns: 1, complete: false };

  it("distinguishes pass, regression, execution failure, and strict insufficiency", () => {
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "normal", execution: complete })).toBe(EVAL_EXIT_PASS);
    expect(resolveEvalExitCode({ regressionCount: 1, evidencePolicy: "normal", execution: complete })).toBe(EVAL_EXIT_REGRESSION);
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "normal", execution: incomplete })).toBe(EVAL_EXIT_EXECUTION_ERROR);
    expect(resolveEvalExitCode({ regressionCount: 1, evidencePolicy: "normal", execution: incomplete })).toBe(EVAL_EXIT_EXECUTION_ERROR);
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "strict", execution: incomplete })).toBe(EVAL_EXIT_INSUFFICIENT_EVIDENCE);
    expect(resolveEvalExitCode({ regressionCount: 1, evidencePolicy: "strict", execution: incomplete })).toBe(EVAL_EXIT_INSUFFICIENT_EVIDENCE);
  });

  for (const [policy, expectedExit] of [
    ["normal", EVAL_EXIT_EXECUTION_ERROR],
    ["strict", EVAL_EXIT_INSUFFICIENT_EVIDENCE],
  ] as const) {
    it(`persists incomplete ${policy} diagnostics while skipping compare and update`, async () => {
      const reportPath = join(tmpdir(), `eval-${policy}-incomplete-${Date.now()}-${Math.random()}.json`);
      let comparisons = 0;
      let updates = 0;
      const result = await runEvalEvidenceFlow({
        evidencePolicy: policy,
        execution: incomplete,
        noComparison: { regressions: [] as string[] },
        compareBaseline: async () => {
          comparisons += 1;
          return { regressions: ["must-not-run"] };
        },
        regressionCount: (comparison) => comparison.regressions.length,
        updateBaseline: async () => {
          updates += 1;
        },
        persistDiagnosticReport: async () => {
          await Bun.write(reportPath, JSON.stringify({ policy, complete: false }));
        },
      });

      expect(comparisons).toBe(0);
      expect(updates).toBe(0);
      expect(result).toMatchObject({ compared: false, baselineUpdated: false, exitCode: expectedExit });
      expect(await Bun.file(reportPath).json()).toEqual({ policy, complete: false });
      await unlink(reportPath);
    });
  }
});
