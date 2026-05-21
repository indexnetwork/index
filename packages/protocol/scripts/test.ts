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
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname;
const CONCURRENCY = Number(process.env.TEST_CONCURRENCY ?? 4);

function findSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findSpecFiles(full));
    else if (entry.endsWith(".spec.ts") || entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

type Result = {
  file: string;
  pass: number;
  fail: number;
  error: number;
  durationMs: number;
  output: string;
};

async function runOne(file: string): Promise<Result> {
  const started = Date.now();
  const proc = spawn({
    cmd: ["bun", "test", file],
    env: { ...process.env, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  const output = stdout + stderr;
  const passMatch = output.match(/(\d+)\s+pass/);
  const failMatch = output.match(/(\d+)\s+fail/);
  const errorMatch = output.match(/(\d+)\s+error/);
  return {
    file: file.replace(ROOT + "/", ""),
    pass: passMatch ? Number(passMatch[1]) : 0,
    fail: failMatch ? Number(failMatch[1]) : 0,
    error: errorMatch ? Number(errorMatch[1]) : 0,
    durationMs: Date.now() - started,
    output,
  };
}

async function runPool(files: string[], n: number): Promise<Result[]> {
  const results: Result[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++;
      const r = await runOne(files[idx]);
      results.push(r);
      const status = r.fail + r.error === 0 ? "PASS" : "FAIL";
      console.log(`[${results.length}/${files.length}] ${status} ${r.file} (${r.pass}p/${r.fail}f/${r.error}e, ${r.durationMs}ms)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, files.length) }, worker));
  return results;
}

const files = findSpecFiles(ROOT).sort();
console.log(`Running ${files.length} spec files with concurrency=${CONCURRENCY}\n`);
const started = Date.now();
const results = await runPool(files, CONCURRENCY);
const elapsed = Date.now() - started;

const totals = results.reduce(
  (acc, r) => ({ pass: acc.pass + r.pass, fail: acc.fail + r.fail, error: acc.error + r.error }),
  { pass: 0, fail: 0, error: 0 },
);

const failedFiles = results.filter((r) => r.fail + r.error > 0).sort((a, b) => a.file.localeCompare(b.file));
if (failedFiles.length > 0) {
  console.log("\nFailing files:");
  for (const r of failedFiles) console.log(`  ${r.file}  (${r.fail}f/${r.error}e)`);
}

console.log(`\nTotals: ${totals.pass} pass, ${totals.fail} fail, ${totals.error} errors across ${files.length} files in ${(elapsed / 1000).toFixed(1)}s`);
process.exit(totals.fail + totals.error > 0 ? 1 : 0);
