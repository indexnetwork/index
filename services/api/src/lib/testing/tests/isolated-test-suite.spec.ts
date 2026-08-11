import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertNoDiscoverableModuleMocks, loadIsolatedTestInventory } from '../isolated-test-suite';

const temporaryDirectories: string[] = [];

function makeApiRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'isolated-suite-'));
  temporaryDirectories.push(root);
  mkdirSync(path.join(root, 'src/tests'), { recursive: true });
  mkdirSync(path.join(root, 'tests'), { recursive: true });
  return root;
}

function write(root: string, relativePath: string, content = ''): void {
  const destination = path.join(root, relativePath);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('isolated test inventory', () => {
  it('keeps the committed manifest in exact filesystem parity', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const inventory = loadIsolatedTestInventory(apiRoot);

    expect(inventory.files.length).toBeGreaterThan(0);
    expect(new Set(inventory.files).size).toBe(inventory.files.length);
  });

  it('keeps the budgeted Hermes database fixtures registered and synchronization evidence state-based', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const inventory = loadIsolatedTestInventory(apiRoot);
    const authority = readFileSync(
      path.join(apiRoot, 'tests/negotiation-runtime-authority.database.isolated.ts'),
      'utf8',
    );
    const lifecycle = readFileSync(
      path.join(apiRoot, 'tests/hermes-runtime-lifecycle.database.isolated.ts'),
      'utf8',
    );

    expect(inventory.files).toContain('tests/negotiation-runtime-authority.database.isolated.ts');
    expect(inventory.files).toContain('tests/hermes-runtime-lifecycle.database.isolated.ts');
    expect(authority.match(/\bit\.each\s*\(/g) ?? []).toHaveLength(0);
    expect(authority).toContain('const contenderOutcome = settlePromiseOutcome(contender());');
    expect(authority).not.toContain('contender: Promise<T>');
    expect(authority).toContain('await waitForOwnerRuntimeWaiters(responseBackendPid, 1);');
    expect(authority).not.toContain('await Bun.sleep(');
    expect(lifecycle).toContain('function createBarrier(parties: number)');
    expect(lifecycle).toContain("activation_state IN ('pending', 'active')");
    expect(lifecycle).toContain("sql`${schema.hermesAgentCredentials.expiresAt} <= now()`");
    expect(lifecycle).not.toContain('await Bun.sleep(');
    expect(lifecycle).toContain("for (const first of ['prepare', 'disconnect'] as const)");
    expect(lifecycle).toContain('await waitForOwnerRuntimeWaiters(held.backendPid, 2)');
    const lifecycleWaiterQuery = lifecycle.slice(
      lifecycle.indexOf('async function ownerRuntimeWaiters'),
      lifecycle.indexOf('async function waitForOwnerRuntimeWaiters'),
    );
    expect(lifecycleWaiterQuery).toContain(
      'SELECT DISTINCT waiter.pid AS pid, waiter.waitstart AS waitstart',
    );
    expect(lifecycleWaiterQuery).toContain('ORDER BY waiter.waitstart, waiter.pid');
    expect(lifecycleWaiterQuery).not.toContain('SELECT DISTINCT waiter.pid AS pid\n    FROM pg_locks');
    expect(lifecycle).toContain("throw new AggregateError(cleanupErrors, 'Hermes lifecycle fixture cleanup failed')");

    expect(authority).toContain('new HermesAuthorizationService(');
    expect(authority).toContain('resolveHermesAgentCredential(rawCredential)');
    expect(authority).toContain('rearmCalls.push({');
    expect(authority).not.toContain('authorizePickup: async () => true');
    expect(authority).toContain("throw new AggregateError(cleanupErrors, 'Negotiation authority fixture cleanup failed')");
  });

  it('keeps dedicated credential denial logging and assurance runner output identity-free', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const authGuard = readFileSync(path.join(apiRoot, 'src/guards/auth.guard.ts'), 'utf8');
    const runner = readFileSync(path.join(apiRoot, 'scripts/test-hermes-production-assurance.sh'), 'utf8');
    const denialLogger = authGuard.slice(
      authGuard.indexOf('function invalidHermesAgentCredential'),
      authGuard.indexOf('/** Resolve one exact active dedicated principal'),
    );

    expect(denialLogger).toContain("logger.warn('Hermes agent credential rejected', { reason })");
    expect(denialLogger).not.toContain('keyHashPrefix');
    expect(runner).toContain('API_TEST_HERMES_ASSURANCE_QUIET=1');
    expect(runner).toContain('sanitize-hermes-assurance-output.ts');
    expect(runner).toContain('exit "$status"');
  });

  it('parses every Hermes assurance target with Bun without importing database code', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const targets = [
      'tests/hermes-runtime-lifecycle.database.isolated.ts',
      'tests/negotiation-runtime-authority.database.isolated.ts',
    ];

    for (const target of targets) {
      const source = readFileSync(path.join(apiRoot, target), 'utf8');
      expect(() => transpiler.transformSync(source), target).not.toThrow();
    }
  });

  it('dispatches E2E entries through their own explicit gates without filename skips', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const inventory = loadIsolatedTestInventory(apiRoot);
    const runner = readFileSync(path.join(apiRoot, 'scripts/test-isolated.sh'), 'utf8');
    const e2eFiles = inventory.files.filter((file) => file.includes('.e2e.')).sort();

    expect(e2eFiles).toEqual([
      'tests/contacts-disabled.e2e.isolated.ts',
      'tests/limiter.e2e.isolated.ts',
      'tests/negotiation-polling-consultation.e2e.isolated.ts',
      'tests/negotiation.ask-user.e2e.isolated.ts',
      'tests/negotiation.e2e.isolated.ts',
      'tests/network-resend-invite.e2e.isolated.ts',
    ]);
    expect(runner).not.toContain('*.e2e.*');
    expect(runner).not.toContain('SKIP (not found)');
  });

  it('fails before execution when a manifest file is missing', () => {
    const root = makeApiRoot();
    write(root, '.test-isolated', 'tests/missing.isolated.ts\n');

    expect(() => loadIsolatedTestInventory(root)).toThrow(
      'Missing files: tests/missing.isolated.ts',
    );
  });

  it('fails for unregistered files, duplicate entries, and malformed paths', () => {
    const root = makeApiRoot();
    write(root, 'src/tests/registered.isolated.ts');
    write(root, 'tests/unregistered.isolated.ts');
    write(
      root,
      '.test-isolated',
      [
        'src/tests/registered.isolated.ts',
        'src/tests/registered.isolated.ts',
        '../outside.isolated.ts',
      ].join('\n'),
    );

    expect(() => loadIsolatedTestInventory(root)).toThrow('Duplicate entries');
    expect(() => loadIsolatedTestInventory(root)).toThrow('Malformed entries');
    expect(() => loadIsolatedTestInventory(root)).toThrow(
      'Unregistered files: tests/unregistered.isolated.ts',
    );
  });
});

describe('isolated import harness', () => {
  const harness = './src/lib/testing/isolated-test-import-harness.spec.ts';

  function runHarness(apiRoot: string, target: string, marker?: string) {
    const environment = {
      ...process.env,
      API_TEST_ISOLATED_CHILD: '1',
      API_TEST_ISOLATED_TARGET: target,
      ...(marker ? { API_TEST_ISOLATED_MARKER: marker } : {}),
    };
    delete environment.API_TEST_REQUIRE_DATABASE;
    delete environment.API_TEST_DATABASE_READY;
    delete environment.API_TEST_PARENT_PID;
    return Bun.spawnSync(['bun', 'test', harness], {
      cwd: apiRoot,
      env: environment,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  }

  it('executes a registered non-discoverable test in a real fresh Bun process', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const markerRoot = makeApiRoot();
    const marker = path.join(markerRoot, 'isolated-executed.txt');
    const child = runHarness(
      apiRoot,
      'src/lib/testing/tests/fixtures/isolated-import-target.isolated.ts',
      marker,
    );

    expect(child.exitCode).toBe(0);
    expect(readFileSync(marker, 'utf8')).toMatch(/^executed:\d+$/);
    const output = new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr);
    expect(output).toContain('1 pass');
  });

  it.each([
    ['invalid empty target', ''],
    ['path traversal', '../src/lib/testing/tests/fixtures/isolated-import-target.isolated.ts'],
    ['absolute path', '/tmp/isolated-import-target.isolated.ts'],
  ])('rejects %s before import', (_label, target) => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const child = runHarness(apiRoot, target);
    expect(child.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(child.stderr)).toContain('Invalid API_TEST_ISOLATED_TARGET');
  });

  it('rejects a well-formed but unregistered target', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const child = runHarness(apiRoot, 'src/lib/testing/tests/not-registered.isolated.ts');
    expect(child.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(child.stderr)).toContain('Target is not registered in .test-isolated');
  });
});

describe('discoverable module-mock audit', () => {
  it('accepts clean discoverable tests and isolated module mocks', () => {
    const root = makeApiRoot();
    write(root, 'src/tests/clean.spec.ts', 'expect(true).toBe(true);');
    write(
      root,
      'src/tests/mocked.isolated.ts',
      `${['mock', 'module'].join('.')}('dependency', () => ({}));`,
    );

    expect(() => assertNoDiscoverableModuleMocks(root)).not.toThrow();
  });

  it('rejects a process-global module mock in a discoverable test', () => {
    const root = makeApiRoot();
    write(
      root,
      'tests/contaminated.spec.ts',
      `${['mock', 'module'].join('.')}('dependency', () => ({}));`,
    );

    expect(() => assertNoDiscoverableModuleMocks(root)).toThrow(
      'tests/contaminated.spec.ts:1',
    );
  });
});
