import path from 'node:path';

import { ensureTestDatabaseReady } from '../drizzle/test-database-readiness';
import { loadIsolatedTestInventory } from './isolated-test-suite';

const CHILD_TIMEOUT_MS = 180_000;
const CHILD_TIMEOUT_OVERRIDES: Readonly<Record<string, number>> = {
  'src/adapters/tests/database.adapter.isolated.ts': 300_000,
  'src/controllers/tests/chat.negotiator.isolated.ts': 300_000,
  'src/services/tests/negotiation-polling.seat.isolated.ts': 300_000,
  'src/services/tests/opportunity-delivery.isolated.ts': 300_000,
  'tests/negotiation-runtime-authority.database.isolated.ts': 300_000,
  'tests/experiment-signup-lookup.isolated.ts': 300_000,
  'tests/network-scoped-import.isolated.ts': 240_000,
};
export const ISOLATED_SUITE_TIMEOUT_MS = 4 * 60 * 60 * 1_000;

export interface IsolatedTestSummary {
  failed: number;
  files: number;
  passed: number;
  skipped: number;
}

function readCount(output: string, label: 'pass' | 'skip' | 'fail'): number {
  const match = output.match(new RegExp(`^\\s*(\\d+)\\s+${label}(?:ed)?\\b`, 'm'));
  return match ? Number(match[1]) : 0;
}

export interface BoundedChildResult {
  exitCode: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

/**
 * Runs a child with bounded TERM→KILL escalation and output draining.
 *
 * @param command - Executable and arguments.
 * @param options - Working directory, environment, timeout, and kill grace.
 * @returns Exit status, output, and whether the timeout fired.
 */
export async function runBoundedChild(
  command: string[],
  options: {
    cwd: string;
    env: Record<string, string | undefined>;
    timeoutMs: number;
    terminationGraceMs?: number;
  },
): Promise<BoundedChildResult> {
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdoutPromise = new Response(child.stdout).text();
  const stderrPromise = new Response(child.stderr).text();
  const outcome = await Promise.race([
    child.exited.then((exitCode) => ({ exitCode, timedOut: false as const })),
    Bun.sleep(options.timeoutMs).then(() => ({ exitCode: -1, timedOut: true as const })),
  ]);
  const terminationGraceMs = options.terminationGraceMs ?? 2_000;

  if (outcome.timedOut) {
    signalProcessTree(child.pid, 'SIGTERM');
    const exitedAfterTerm = await exitsWithin(child, terminationGraceMs);
    if (!exitedAfterTerm) {
      signalProcessTree(child.pid, 'SIGKILL');
      await exitsWithin(child, terminationGraceMs);
    }
  }

  const exitCode = outcome.timedOut
    ? await Promise.race([
      child.exited,
      Bun.sleep(terminationGraceMs).then(() => -1),
    ])
    : outcome.exitCode;
  const [stdout, stderr] = await Promise.all([
    drainWithin(stdoutPromise, terminationGraceMs),
    drainWithin(stderrPromise, terminationGraceMs),
  ]);
  return { exitCode, stderr, stdout, timedOut: outcome.timedOut };
}

async function runIsolatedFile(apiRoot: string, file: string): Promise<IsolatedTestSummary> {
  const environment = { ...process.env };
  delete environment.API_TEST_REQUIRE_DATABASE;
  environment.API_TEST_DATABASE_READY = '1';
  environment.API_TEST_ISOLATED_CHILD = '1';
  environment.API_TEST_PARENT_PID = String(process.pid);
  environment.API_TEST_ISOLATED_TARGET = file;
  environment.NODE_ENV = 'test';

  const childTimeoutMs = CHILD_TIMEOUT_OVERRIDES[file] ?? CHILD_TIMEOUT_MS;
  const child = await runBoundedChild([
    'bun',
    'test',
    './src/lib/testing/isolated-test-import-harness.spec.ts',
  ], {
    cwd: apiRoot,
    env: environment,
    timeoutMs: childTimeoutMs,
  });
  const output = `${child.stdout}${child.stderr}`;
  process.stdout.write(`\n=== isolated: ${file} ===\n${output}`);
  if (child.timedOut) {
    throw new Error(`[isolated-tests] ${file} exceeded ${childTimeoutMs}ms.`);
  }
  if (child.exitCode !== 0) {
    throw new Error(`[isolated-tests] ${file} exited with status ${child.exitCode}.`);
  }

  return {
    failed: readCount(output, 'fail'),
    files: 1,
    passed: readCount(output, 'pass'),
    skipped: readCount(output, 'skip'),
  };
}

/**
 * Executes the strict isolated-test manifest serially in fresh Bun processes.
 *
 * The parent validates database readiness once and children reuse that result;
 * direct child invocations without both internal markers still fail closed.
 *
 * @param apiRoot - Absolute services/api package path.
 * @returns Aggregate child file and test counts.
 * @throws When any child times out, exits nonzero, or reports a failed test.
 */
export async function runIsolatedTestSuite(apiRoot: string): Promise<IsolatedTestSummary> {
  if (process.env.API_TEST_ISOLATED_CHILD === '1') {
    throw new Error('[isolated-tests] Refusing recursive isolated-suite execution.');
  }

  const inventory = loadIsolatedTestInventory(path.resolve(apiRoot));
  await ensureTestDatabaseReady();
  const totals: IsolatedTestSummary = {
    failed: 0,
    files: inventory.files.length,
    passed: 0,
    skipped: 0,
  };
  const failedFiles: string[] = [];

  for (const file of inventory.files) {
    try {
      const summary = await runIsolatedFile(apiRoot, file);
      totals.passed += summary.passed;
      totals.skipped += summary.skipped;
      totals.failed += summary.failed;
    } catch (error) {
      totals.failed += 1;
      failedFiles.push(file);
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      process.stderr.write(`${message}\n`);
    }
  }

  process.stdout.write(
    `[isolated-tests] files=${totals.files} passed=${totals.passed} skipped=${totals.skipped} failed=${totals.failed}\n`,
  );
  if (failedFiles.length > 0 || totals.failed > 0) {
    throw new Error(`[isolated-tests] Failed files: ${failedFiles.join(', ')}`);
  }
  return totals;
}

async function exitsWithin(
  child: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<boolean> {
  return Promise.race([
    child.exited.then(() => true),
    Bun.sleep(timeoutMs).then(() => false),
  ]);
}

async function drainWithin(output: Promise<string>, timeoutMs: number): Promise<string> {
  return Promise.race([
    output,
    Bun.sleep(timeoutMs).then(() => '[isolated-tests] output drain timed out\n'),
  ]);
}

function signalProcessTree(pid: number, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32') {
    for (const descendant of collectDescendantPids(pid).reverse()) {
      try {
        process.kill(descendant, signal);
      } catch {
        // The descendant may have exited between discovery and signaling.
      }
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // The direct child may already have exited.
  }
}

function collectDescendantPids(parentPid: number): number[] {
  try {
    const result = Bun.spawnSync(['pgrep', '-P', String(parentPid)]);
    if (result.exitCode !== 0) return [];
    const children = new TextDecoder()
      .decode(result.stdout)
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter(Number.isFinite);
    return children.flatMap((childPid) => [
      ...collectDescendantPids(childPid),
      childPid,
    ]);
  } catch {
    return [];
  }
}
