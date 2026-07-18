#!/usr/bin/env bun
/**
 * Provider-free eval verification gate (IND-441).
 *
 * Runs, for every eval suite in the manifest below:
 *   1. `tsc --noEmit -p eval/<suite>/tsconfig.json` — per-suite TypeScript project
 *   2. `bun test --timeout 30000 eval/<suite>/tests/` — provider-free unit specs
 *
 * The per-test timeout is raised from Bun's 5s default to 30s: some HyDE
 * specs deterministically recompute bootstrap/report evidence on CPU and
 * exceed 5s on slower CI runners while passing comfortably under 30s.
 *
 * Each suite's specs run in their own process so `mock.module()` state never
 * leaks across suites (same rationale as scripts/test.ts).
 *
 * Provider-free contract: this script never loads .env.test and strips
 * provider credentials from the child environment, so any spec that reaches
 * for a live model/embedder fails loudly here instead of passing by accident.
 * It never writes baselines or run artifacts.
 *
 * Inventory contract: SUITES is the explicit manifest. Directory discovery is
 * compared against it in both directions — a new eval/<dir> that is not listed
 * here fails the run, as does a manifest entry whose directory (or tsconfig or
 * tests/) has disappeared. Adding a suite therefore *requires* touching this
 * manifest, which is what keeps the CI inventory honest.
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Explicit suite manifest. Add new eval suites here (discovery check enforces it). */
const SUITES = [
  "canary",
  "clarification",
  "hyde",
  "matching",
  "opportunity",
  "premise",
  "profile",
  "shared",
  "viewer",
] as const;

const PROVIDER_ENV_VARS = ["OPENROUTER_API_KEY", "OPENAI_API_KEY"];

/**
 * Per-test timeout (ms) for suite specs. Bun's 5s default is too tight for
 * deterministic CPU-heavy HyDE evidence-recomputation specs on CI runners.
 */
const TEST_TIMEOUT_MS = 30_000;

const EVAL_DIR = new URL(".", import.meta.url).pathname;
const PACKAGE_DIR = join(EVAL_DIR, "..");

function fail(message: string): never {
  console.error(`\n❌ eval:verify — ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Inventory check: eval/* directories must match the manifest exactly.
// ---------------------------------------------------------------------------
const discovered = readdirSync(EVAL_DIR)
  .filter((entry) => statSync(join(EVAL_DIR, entry)).isDirectory())
  .sort();

const manifest: string[] = [...SUITES].sort();
const unlisted = discovered.filter((d) => !manifest.includes(d));
const missing = manifest.filter((m) => !discovered.includes(m));

if (unlisted.length > 0) {
  fail(
    `eval directory(ies) not in the verification manifest: ${unlisted.join(", ")}.\n` +
      `   Add them to SUITES in eval/verify.ts (with a tsconfig.json and tests/) so they are gated in CI.`,
  );
}
if (missing.length > 0) {
  fail(`manifest suite(s) have no directory under eval/: ${missing.join(", ")}. Remove them from SUITES or restore the directory.`);
}

for (const suite of manifest) {
  if (!existsSync(join(EVAL_DIR, suite, "tsconfig.json"))) {
    fail(`eval/${suite}/tsconfig.json is missing — every suite must have a per-suite TypeScript project.`);
  }
  if (!existsSync(join(EVAL_DIR, suite, "tests"))) {
    fail(`eval/${suite}/tests/ is missing — every suite must have provider-free specs.`);
  }
}

console.log(`eval:verify — inventory OK (${manifest.length} suites): ${manifest.join(", ")}\n`);

// ---------------------------------------------------------------------------
// 2. Per-suite typecheck + provider-free tests.
// ---------------------------------------------------------------------------
const childEnv: Record<string, string | undefined> = { ...process.env, NODE_ENV: "test" };
for (const key of PROVIDER_ENV_VARS) delete childEnv[key];

async function run(label: string, cmd: string[]): Promise<boolean> {
  const started = Date.now();
  const proc = Bun.spawn({ cmd, cwd: PACKAGE_DIR, env: childEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (exitCode === 0) {
    console.log(`  ✅ ${label} (${seconds}s)`);
    return true;
  }
  console.error(`  ❌ ${label} (${seconds}s)`);
  if (stdout.trim()) console.error(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
  return false;
}

let failures = 0;
for (const suite of manifest) {
  console.log(`suite: ${suite}`);
  const okTsc = await run(`tsc --noEmit -p eval/${suite}/tsconfig.json`, [
    "bunx",
    "tsc",
    "--noEmit",
    "-p",
    `eval/${suite}/tsconfig.json`,
  ]);
  const okTest = await run(`bun test --timeout ${TEST_TIMEOUT_MS} eval/${suite}/tests/`, [
    "bun",
    "test",
    "--timeout",
    String(TEST_TIMEOUT_MS),
    `eval/${suite}/tests/`,
  ]);
  if (!okTsc || !okTest) failures++;
}

if (failures > 0) fail(`${failures} suite(s) failed. See output above.`);
console.log(`\n✅ eval:verify — all ${manifest.length} suites type-checked and tested (provider-free).`);
