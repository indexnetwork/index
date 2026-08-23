#!/usr/bin/env bun
/**
 * Per-file test runner.
 *
 * Bun does not undo `mock.module()` between test files — module mocks
 * persist for the entire runner process. Specs that mock shared modules
 * (e.g. `tool.factory`, `opportunity.discover`, `model.config`) leak
 * those mocks into every subsequent file, cascading false failures into
 * unrelated specs. Running each spec in its own process gives clean
 * mock state per file.
 */
import { spawn } from "bun";
import { classifySpecFiles, parseConcurrency, runFiles, type ChildTestResult } from "./test-runner.js";

const ROOT = new URL("../src", import.meta.url).pathname;

/**
 * These suites make real model calls and use an LLM judge. They remain available
 * to the explicit live-evaluation workflow, but must never be picked up by the
 * credential-free source-test gate.
 */
export const LIVE_MODEL_SPECS = new Set([
  "capabilities/tests/intents.spec.ts",
  "negotiations/tests/insight.generator.spec.ts",
  "negotiations/tests/negotiator-discovery-query.spec.ts",
  "opportunities/tests/opportunity.graph.spec.ts",
  "premises/tests/premise.decomposer.spec.ts",
]);

type ChildTestInput = Pick<ChildTestResult, "file" | "exitCode" | "durationMs" | "output">;

async function runOne(file: string): Promise<ChildTestInput> {
  const started = Date.now();
  const childEnv = { ...process.env, NODE_ENV: "test" };
  delete childEnv.OPENROUTER_API_KEY;
  delete childEnv.OPENAI_API_KEY;
  const proc = spawn({
    cmd: ["bun", "--config=bunfig.source-test.toml", "--preload=./source-test-preload.ts", "--no-env-file", "test", file],
    env: childEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return {
    file: file.replace(ROOT + "/", "").replace(/^internal\//, ""),
    exitCode,
    durationMs: Date.now() - started,
    output: stdout + stderr,
  };
}

export async function main(): Promise<number> {
  let concurrency: number;
  try {
    concurrency = parseConcurrency(process.env.TEST_CONCURRENCY);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  const { providerFreeFiles: files, liveFiles } = classifySpecFiles(ROOT, LIVE_MODEL_SPECS);
  if (files.length === 0) {
    console.error("No provider-free spec files discovered");
    return 1;
  }

  console.log(`Running ${files.length} provider-free spec files with concurrency=${concurrency}`);
  if (liveFiles.length > 0) {
    console.log("Excluded explicit live-model specs (run through the live-evaluation workflow):");
    for (const file of liveFiles) console.log(`  ${file.replace(ROOT + "/", "").replace(/^internal\//, "")}`);
  }
  console.log();

  const started = Date.now();
  const results = await runFiles(files, {
    concurrency,
    runFile: runOne,
    onResult(result, completed, total) {
      const status = result.failureReasons.length === 0 ? "PASS" : "FAIL";
      const totals = result.totals ?? { pass: 0, fail: 0, error: 0 };
      console.log(`[${completed}/${total}] ${status} ${result.file} (${totals.pass}p/${totals.fail}f/${totals.error}e, ${result.durationMs}ms)`);
    },
  });
  const elapsed = Date.now() - started;

  const totals = results.reduce(
    (acc, result) => ({
      pass: acc.pass + (result.totals?.pass ?? 0),
      fail: acc.fail + (result.totals?.fail ?? 0),
      error: acc.error + (result.totals?.error ?? 0),
    }),
    { pass: 0, fail: 0, error: 0 },
  );

  const failedFiles = results.filter((result) => result.failureReasons.length > 0).sort((a, b) => a.file.localeCompare(b.file));
  if (failedFiles.length > 0) {
    console.log("\nFailing files:");
    for (const result of failedFiles) {
      console.log(`\n--- ${result.file} (${result.failureReasons.join(", ")}) ---`);
      console.log(result.output.trim());
    }
  }

  console.log(`\nTotals: ${totals.pass} pass, ${totals.fail} fail, ${totals.error} errors across ${files.length} files in ${(elapsed / 1000).toFixed(1)}s`);
  return failedFiles.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
