/**
 * Tiny argv helpers shared by every harness CLI. Each harness still owns its own
 * flag set and validation; these just read process.argv consistently.
 */

import type { EvalEvidencePolicy, EvalExecutionSummary } from "./runner.js";

export const EVAL_EXIT_PASS = 0;
export const EVAL_EXIT_REGRESSION = 1;
export const EVAL_EXIT_EXECUTION_ERROR = 2;
export const EVAL_EXIT_INSUFFICIENT_EVIDENCE = 3;

/** Pure exit-code policy shared by the baseline-backed harnesses. */
export function resolveEvalExitCode(options: {
  regressionCount: number;
  evidencePolicy: EvalEvidencePolicy;
  execution: EvalExecutionSummary;
}): number {
  if (!options.execution.complete) {
    return options.evidencePolicy === "strict"
      ? EVAL_EXIT_INSUFFICIENT_EVIDENCE
      : EVAL_EXIT_EXECUTION_ERROR;
  }
  return options.regressionCount > 0 ? EVAL_EXIT_REGRESSION : EVAL_EXIT_PASS;
}

/** Baselines are canonical evidence and therefore require every requested slot. */
export function assertBaselineEvidenceComplete(execution: EvalExecutionSummary): void {
  if (!execution.complete) {
    throw new Error(
      `Cannot update baseline from incomplete evidence: ${execution.completedRuns}/${execution.requestedRuns} requested runs completed`,
    );
  }
}

export interface EvalEvidenceFlowOptions<TComparison> {
  evidencePolicy: EvalEvidencePolicy;
  execution: EvalExecutionSummary;
  noComparison: TComparison;
  compareBaseline: () => Promise<TComparison>;
  regressionCount: (comparison: TComparison) => number;
  /** Present only when the CLI was asked to update its baseline. */
  updateBaseline?: () => Promise<void>;
  /** Persists an enabled automatic or explicit diagnostic report. */
  persistDiagnosticReport: () => Promise<void>;
}

export interface EvalEvidenceFlowResult<TComparison> {
  comparison: TComparison;
  exitCode: number;
  compared: boolean;
  baselineUpdated: boolean;
}

/**
 * Applies the shared complete-evidence gate around CLI comparison and writes.
 * Diagnostic reports remain persistable for incomplete runs, while neither a
 * baseline read/comparison nor baseline update can consume partial evidence.
 */
export async function runEvalEvidenceFlow<TComparison>(
  options: EvalEvidenceFlowOptions<TComparison>,
): Promise<EvalEvidenceFlowResult<TComparison>> {
  const compared = options.execution.complete;
  const comparison = compared ? await options.compareBaseline() : options.noComparison;
  let baselineUpdated = false;
  if (options.execution.complete && options.updateBaseline) {
    await options.updateBaseline();
    baselineUpdated = true;
  }
  await options.persistDiagnosticReport();
  const regressionCount = compared ? options.regressionCount(comparison) : 0;
  return {
    comparison,
    exitCode: resolveEvalExitCode({ regressionCount, evidencePolicy: options.evidencePolicy, execution: options.execution }),
    compared,
    baselineUpdated,
  };
}

export interface EvalProcessCancellation {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * Converts the first SIGINT/SIGTERM into evidence-preserving cancellation.
 * A second signal forces exit 2 so operators can still stop immediately.
 */
export function installEvalProcessCancellation(): EvalProcessCancellation {
  const controller = new AbortController();
  let signalCount = 0;
  const onSignal = (signal: "SIGINT" | "SIGTERM"): void => {
    signalCount += 1;
    if (signalCount > 1) process.exit(EVAL_EXIT_EXECUTION_ERROR);
    console.warn(`\nReceived ${signal}; cancelling active eval attempt and preserving incomplete evidence…`);
    controller.abort(new Error(`Eval cancelled by ${signal}`));
  };
  const onSigint = (): void => onSignal("SIGINT");
  const onSigterm = (): void => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return {
    signal: controller.signal,
    dispose: () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}

/** The value following `flag` in argv, or undefined. */
export function arg(flag: string, argv: string[] = process.argv): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** True when `flag` is present in argv. */
export function has(flag: string, argv: string[] = process.argv): boolean {
  return argv.includes(flag);
}

/** A flag's value only when it's a real value, not the next flag (e.g. `--report --runs`). */
export function flagValue(flag: string, argv: string[] = process.argv): string | undefined {
  const v = arg(flag, argv);
  return v && !v.startsWith("--") ? v : undefined;
}
