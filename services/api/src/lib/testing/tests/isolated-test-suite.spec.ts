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

  it('dispatches E2E entries through their own explicit gates without filename skips', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../../..');
    const inventory = loadIsolatedTestInventory(apiRoot);
    const runner = readFileSync(path.join(apiRoot, 'scripts/test-isolated.sh'), 'utf8');
    const e2eFiles = inventory.files.filter((file) => file.includes('.e2e.')).sort();

    expect(e2eFiles).toEqual([
      'tests/contacts-disabled.e2e.isolated.ts',
      'tests/limiter.e2e.isolated.ts',
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
