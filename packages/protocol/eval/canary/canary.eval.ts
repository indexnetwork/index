#!/usr/bin/env bun
/**
 * Budgeted live-eval canary entrypoint (IND-447).
 *
 * Executes the committed canary manifest — a small, representative,
 * budget-capped subset of the baseline-backed live suites (matching,
 * opportunity, premise, profile) — against real providers, producing the same
 * ER2-versioned run artifacts the harnesses always produce. Measurement-only:
 * it never passes `--update-baseline`, never writes to committed baselines,
 * and never changes production behavior.
 *
 * Usage (from packages/protocol):
 *   bun run eval:canary                    # live run (needs OPENROUTER_API_KEY)
 *   bun run eval:canary -- --plan          # provider-free plan/dry-run: validate + budget, execute nothing
 *   bun run eval:canary -- --out <dir>     # write artifacts to a specific directory
 *   bun run eval:canary -- --manifest <p>  # use an alternate manifest (tests only; CI uses the committed one)
 *
 * Exit codes (aggregated over invocations, reusing the governance contract):
 *   0 all pass · 1 measured regression · 2 provider incident / baseline
 *   incompatibility / execution error · 3 insufficient evidence
 */
import { appendFile, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import path from "path";
import { getModelName } from "../../src/shared/agent/model.config.js";
import { EVAL_EXIT_EXECUTION_ERROR, EVAL_RUN_REPORT_ARTIFACT_TYPE, arg, flagValue, has, isEvalArtifactV2, readEvalArtifact, readEvalGitProvenance, summarizeExecution, writeEvalJsonFile } from "../shared/index.js";
import { buildCanarySummary, classifyCanaryInvocation, formatCanarySummaryMarkdown, scanForSecretLeaks, type CanaryInvocationRecord, type CanaryRedactionQuarantine } from "./canary.classify.js";
import { parseCanaryManifest, resolveCanaryManifest } from "./canary.manifest.js";
import { buildCanaryPlan, formatCanaryPlanText, type CanaryPlan, type CanaryPlannedInvocation } from "./canary.plan.js";
import { CANARY_SUITE_DEFINITIONS, canaryCorpora } from "./canary.suites.js";

const PACKAGE_DIR = path.resolve(import.meta.dir, "../..");
const DEFAULT_MANIFEST_PATH = path.resolve(import.meta.dir, "canary.manifest.json");
const SUMMARY_FILE = "canary-summary.json";

function usage(): string {
  return `Budgeted live-eval canary (measurement-only)

Usage (from packages/protocol):
  bun run eval:canary [-- options]

Options:
  --plan              Provider-free plan/dry-run: validate the committed manifest,
                      caps, and budget math; print provenance; execute nothing
  --manifest <path>   Manifest path (default: eval/canary/canary.manifest.json)
  --out <dir>         Artifact output directory (default: eval/canary/runs/<stamp>)
  --help, -h          Show this help

Exit codes:
  0 pass · 1 measured regression · 2 provider incident / baseline incompatibility ·
  3 insufficient evidence

The canary NEVER updates baselines and never pushes commits. Making it a release
gate would be a separate, explicitly human decision (see eval/canary/README.md).
`;
}

async function appendStepSummary(markdown: string): Promise<void> {
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!stepSummaryPath) return;
  try {
    await appendFile(stepSummaryPath, `${markdown}\n`);
  } catch {
    // Step-summary rendering is best-effort; the console output is canonical.
  }
}

async function loadPlan(manifestPath: string, outDir: string): Promise<CanaryPlan> {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read canary manifest at ${manifestPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error(`Canary manifest at ${manifestPath} is not valid JSON`, { cause: err });
  }
  const manifest = parseCanaryManifest(manifestValue);
  const selection = resolveCanaryManifest(manifest, canaryCorpora());
  return buildCanaryPlan({
    manifest,
    selection,
    definitions: CANARY_SUITE_DEFINITIONS,
    outDir,
    resolveModelName: (agent) => getModelName(agent as Parameters<typeof getModelName>[0]),
    git: readEvalGitProvenance(import.meta.dir),
  });
}

interface SpawnResult {
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
}

async function runInvocation(invocation: CanaryPlannedInvocation): Promise<SpawnResult> {
  const started = Date.now();
  try {
    const proc = Bun.spawn({
      cmd: ["bun", ...invocation.argv],
      cwd: PACKAGE_DIR,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, durationMs: Date.now() - started, stdout, stderr };
  } catch (err) {
    return {
      exitCode: null,
      durationMs: Date.now() - started,
      stdout: "",
      stderr: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function readInvocationArtifact(
  artifactPath: string,
  suite: string,
): Promise<{ present: boolean; complete: boolean | null; execution: CanaryInvocationRecord["execution"] }> {
  let present = false;
  try {
    const envelope = await readEvalArtifact(artifactPath, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE, expectedHarness: suite });
    if (!envelope) return { present: false, complete: null, execution: null };
    present = true;
    if (!isEvalArtifactV2(envelope)) return { present, complete: null, execution: null };
    const summary = summarizeExecution(envelope.execution);
    return {
      present,
      complete: envelope.completeness.complete,
      execution: {
        requestedRuns: summary.requestedRuns,
        completedRuns: summary.completedRuns,
        totalAttempts: summary.totalAttempts,
      },
    };
  } catch {
    // Unreadable/invalid artifact: retained on disk for inspection (post leak
    // scan), but classified without completeness evidence.
    return { present, complete: null, execution: null };
  }
}

async function main(): Promise<void> {
  if (has("--help") || has("-h")) {
    console.log(usage());
    process.exit(0);
  }
  const planOnly = has("--plan");
  const manifestPath = path.resolve(PACKAGE_DIR, flagValue("--manifest") ?? DEFAULT_MANIFEST_PATH);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.resolve(PACKAGE_DIR, flagValue("--out") ?? path.join("eval/canary/runs", stamp));
  if (arg("--manifest") && !flagValue("--manifest")) {
    console.error("--manifest requires a path value");
    process.exit(EVAL_EXIT_EXECUTION_ERROR);
  }
  if (arg("--out") && !flagValue("--out")) {
    console.error("--out requires a directory value");
    process.exit(EVAL_EXIT_EXECUTION_ERROR);
  }

  let plan: CanaryPlan;
  try {
    plan = await loadPlan(manifestPath, outDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(EVAL_EXIT_EXECUTION_ERROR);
  }

  // Measurement-only invariant: no spawned argv may carry baseline-mutating flags.
  for (const invocation of plan.invocations) {
    if (invocation.argv.includes("--update-baseline") || invocation.argv.includes("--force")) {
      console.error(`Refusing to run: planned invocation for ${invocation.caseId} carries a baseline-mutating flag`);
      process.exit(EVAL_EXIT_EXECUTION_ERROR);
    }
  }

  const planText = formatCanaryPlanText(plan);
  console.log(planText);
  if (planOnly) {
    console.log("\nPlan only — no provider calls were made, nothing was written.");
    await appendStepSummary(`## Eval canary plan\n\n\`\`\`\n${planText}\n\`\`\``);
    process.exit(0);
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY is required for a live canary run (use --plan for the provider-free dry run)");
    process.exit(EVAL_EXIT_EXECUTION_ERROR);
  }

  mkdirSync(outDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const records: CanaryInvocationRecord[] = [];

  for (const invocation of plan.invocations) {
    process.stdout.write(`\n[canary] ${invocation.suite} · ${invocation.caseId} … `);
    const result = await runInvocation(invocation);
    const artifactPath = path.resolve(PACKAGE_DIR, path.join(outDir, invocation.artifactFile));
    const artifact = await readInvocationArtifact(artifactPath, invocation.suite);
    const { classification, detail } = classifyCanaryInvocation({
      exitCode: result.exitCode,
      artifactPresent: artifact.present,
      artifactComplete: artifact.complete,
    });
    console.log(`exit ${result.exitCode ?? "?"} → ${classification} (${Math.round(result.durationMs / 1000)}s)`);
    // Harness output goes to a log next to the artifact; the post-run leak
    // scan below guards every uploaded byte on top of ER3 sanitization.
    const logPath = path.join(outDir, invocation.artifactFile.replace(/\.json$/, ".log"));
    await writeFile(logPath, `$ bun ${invocation.argv.join(" ")}\n\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}\n`);
    records.push({
      suite: invocation.suite,
      caseId: invocation.caseId,
      artifactFile: invocation.artifactFile,
      exitCode: result.exitCode,
      classification,
      detail,
      durationMs: result.durationMs,
      artifactPresent: artifact.present,
      artifactComplete: artifact.complete,
      execution: artifact.execution,
    });
  }

  // Final redaction guard: quarantine (delete) any output file containing a
  // secret-like env value or provider-key-shaped string before anything can be
  // uploaded. Descriptors only — never the values — reach the summary.
  const quarantines: CanaryRedactionQuarantine[] = [];
  for (const file of (await readdir(outDir)).sort()) {
    const filePath = path.join(outDir, file);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const findings = scanForSecretLeaks(content);
    if (findings.length > 0) {
      await unlink(filePath).catch(() => {});
      quarantines.push({ file, findings });
    }
  }

  const summary = buildCanarySummary({
    plan,
    invocations: records,
    redactionQuarantines: quarantines,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  await writeEvalJsonFile(path.join(outDir, SUMMARY_FILE), summary);

  const markdown = formatCanarySummaryMarkdown(summary);
  console.log(`\n${markdown}`);
  await appendStepSummary(markdown);
  console.log(`\nArtifacts in ${outDir}`);
  process.exit(summary.exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(EVAL_EXIT_EXECUTION_ERROR);
});
