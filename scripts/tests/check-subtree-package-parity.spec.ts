import { describe, expect, test } from 'bun:test';

import {
  collectRanges,
  findParityViolations,
  isExactVersion,
  resolveInstalledVersion,
  type DependencyRange,
} from '../check-subtree-package-parity.ts';

const range = (overrides: Partial<DependencyRange> = {}): DependencyRange => ({
  packageDir: 'packages/protocol',
  name: '@modelcontextprotocol/server',
  range: '2.0.0',
  field: 'dependencies',
  ...overrides,
});

describe('isExactVersion', () => {
  test('accepts exact releases and prereleases', () => {
    expect(isExactVersion('2.0.0')).toBe(true);
    expect(isExactVersion('2.0.0-alpha.2')).toBe(true);
    expect(isExactVersion('2.0.0+build.1')).toBe(true);
  });

  test('rejects every floating range form', () => {
    // `^2.0.0-alpha.2` is the shape that let the protocol mirror build against
    // 2.0.0 stable while this repo was still locked to the alpha.
    for (const floating of ['^2.0.0-alpha.2', '~1.2.3', '>=1.0.0', '1.x', '*', '', 'latest', '1.2.3 || 2.0.0']) {
      expect(isExactVersion(floating)).toBe(false);
    }
  });
});

describe('findParityViolations', () => {
  test('flags a floating range and reports the installed version to pin to', () => {
    const floating = range({ range: '^2.0.0-alpha.2' });
    expect(findParityViolations([floating], () => '2.0.0-alpha.2')).toEqual([
      { ...floating, kind: 'floating', installed: '2.0.0-alpha.2' },
    ]);
  });

  test('flags a floating range that is not installed at all', () => {
    const floating = range({ range: '^5.0.0', name: 'typescript', field: 'devDependencies' });
    expect(findParityViolations([floating], () => null)).toEqual([
      { ...floating, kind: 'floating', installed: null },
    ]);
  });

  test('passes an exact pin that matches the installed tree', () => {
    expect(findParityViolations([range()], () => '2.0.0')).toEqual([]);
  });

  test('flags an exact pin that the lockfile disagrees with', () => {
    expect(findParityViolations([range()], () => '2.0.1')).toEqual([
      { ...range(), kind: 'mismatch', installed: '2.0.1' },
    ]);
  });

  test('ignores an exact pin that is not installed', () => {
    expect(findParityViolations([range()], () => null)).toEqual([]);
  });
});

describe('collectRanges', () => {
  const manifests: Record<string, Record<string, unknown>> = {
    'packages/protocol': {
      dependencies: { '@modelcontextprotocol/server': '2.0.0', '@indexnetwork/x': 'workspace:*' },
      devDependencies: { typescript: '5.9.3' },
      // Peers are the consumer's resolution, not the mirror's build, so ranges
      // there are correct and must not be flagged.
      peerDependencies: { react: '^19.0.0' },
    },
    'packages/cli': {},
  };

  test('collects registry-bound dependency and devDependency ranges only', () => {
    const ranges = collectRanges(
      ['packages/protocol', 'packages/cli', 'packages/missing'],
      (dir) => manifests[dir] ?? null,
    );
    expect(ranges).toEqual([
      range(),
      range({ name: 'typescript', range: '5.9.3', field: 'devDependencies' }),
    ]);
  });

  test('skips workspace, file, and git protocols that never hit the registry', () => {
    const ranges = collectRanges(['p'], () => ({
      dependencies: {
        a: 'workspace:*',
        b: 'file:../b',
        c: 'github:indexnetwork/c',
        d: 'git+https://example.com/d.git',
        e: 'link:../e',
        f: 'catalog:default',
      },
    }));
    expect(ranges).toEqual([]);
  });
});

describe('resolveInstalledVersion', () => {
  test('resolves a real workspace dependency from the installed tree', () => {
    // Guards the node_modules walk itself: if it stopped resolving, every
    // mismatch check would silently pass.
    expect(resolveInstalledVersion('packages/protocol', '@modelcontextprotocol/server')).toBe('2.0.0');
  });

  test('returns null for a package that is not installed', () => {
    expect(resolveInstalledVersion('packages/protocol', '@indexnetwork/definitely-not-installed')).toBeNull();
  });
});
