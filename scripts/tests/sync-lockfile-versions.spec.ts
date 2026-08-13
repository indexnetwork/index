import { describe, expect, test } from 'bun:test';

import {
  applyWorkspaceVersions,
  buildWorkspaceVersionPattern,
  findWorkspaceVersionDrift,
} from '../sync-lockfile-versions.ts';

/** Shaped like the real bun.lock: JSONC, trailing commas, nested dependency objects. */
const LOCKFILE = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "index-monorepo",
      "devDependencies": {
        "eslint": "^9.39.1",
      },
    },
    "apps/web": {
      "name": "@indexnetwork/web",
      "version": "0.51.1",
      "dependencies": {
        "next": "16.0.1",
      },
    },
    "services/api": {
      "name": "@indexnetwork/api",
      "version": "0.84.3",
      "dependencies": {
        "postgres": "^3.4.5",
      },
    },
  },
  "packages": {
    "postgres": ["postgres@3.4.5", "", {}, "sha512-fake=="],
  },
}
`;

const readVersion = (versions: Record<string, string>) => (workspace: string) => versions[workspace] ?? null;

describe('buildWorkspaceVersionPattern', () => {
  test('captures the workspace own version', () => {
    expect(LOCKFILE.match(buildWorkspaceVersionPattern('services/api'))?.[2]).toBe('0.84.3');
    expect(LOCKFILE.match(buildWorkspaceVersionPattern('apps/web'))?.[2]).toBe('0.51.1');
  });

  test('does not reach past a versionless workspace into the next one', () => {
    // The root workspace declares no version. Matching must fail rather than
    // capture `apps/web`'s, which would rewrite the wrong entry.
    expect(LOCKFILE.match(buildWorkspaceVersionPattern(''))).toBeNull();
  });

  test('escapes regex metacharacters in workspace paths', () => {
    expect(() => buildWorkspaceVersionPattern('packages/a+b(c)')).not.toThrow();
    expect(LOCKFILE.match(buildWorkspaceVersionPattern('packages/a+b(c)'))).toBeNull();
  });
});

describe('findWorkspaceVersionDrift', () => {
  test('reports a workspace whose package.json moved ahead of the lockfile', () => {
    expect(findWorkspaceVersionDrift(
      LOCKFILE,
      ['services/api', 'apps/web'],
      readVersion({ 'services/api': '0.84.4', 'apps/web': '0.51.1' }),
    )).toEqual([
      { workspace: 'services/api', packageJsonVersion: '0.84.4', lockfileVersion: '0.84.3' },
    ]);
  });

  test('reports every drifted workspace, not just the first', () => {
    expect(findWorkspaceVersionDrift(
      LOCKFILE,
      ['services/api', 'apps/web'],
      readVersion({ 'services/api': '1.0.0', 'apps/web': '0.52.0' }),
    )).toHaveLength(2);
  });

  test('is silent when everything matches', () => {
    expect(findWorkspaceVersionDrift(
      LOCKFILE,
      ['services/api', 'apps/web'],
      readVersion({ 'services/api': '0.84.3', 'apps/web': '0.51.1' }),
    )).toEqual([]);
  });

  test('skips workspaces with no declared version and ones absent from the lockfile', () => {
    expect(findWorkspaceVersionDrift(
      LOCKFILE,
      ['', 'packages/cli', 'services/api'],
      readVersion({ 'packages/cli': '0.20.0', 'services/api': '0.84.3' }),
    )).toEqual([]);
  });
});

describe('applyWorkspaceVersions', () => {
  test('rewrites only the drifted version and leaves the file otherwise byte-identical', () => {
    const updated = applyWorkspaceVersions(LOCKFILE, [
      { workspace: 'services/api', packageJsonVersion: '0.84.4', lockfileVersion: '0.84.3' },
    ]);

    expect(updated).toBe(LOCKFILE.replace('"version": "0.84.3",', '"version": "0.84.4",'));
    expect(updated).toContain('"version": "0.51.1",');
    expect(updated.split('\n')).toHaveLength(LOCKFILE.split('\n').length);
  });

  test('rewrites several workspaces in one pass', () => {
    const updated = applyWorkspaceVersions(LOCKFILE, [
      { workspace: 'services/api', packageJsonVersion: '1.0.0', lockfileVersion: '0.84.3' },
      { workspace: 'apps/web', packageJsonVersion: '0.52.0', lockfileVersion: '0.51.1' },
    ]);

    expect(findWorkspaceVersionDrift(
      updated,
      ['services/api', 'apps/web'],
      readVersion({ 'services/api': '1.0.0', 'apps/web': '0.52.0' }),
    )).toEqual([]);
  });

  test('does not touch identically-valued versions elsewhere in the file', () => {
    // `postgres@3.4.5` in the packages section must survive a workspace bump.
    const updated = applyWorkspaceVersions(LOCKFILE, [
      { workspace: 'services/api', packageJsonVersion: '3.4.5', lockfileVersion: '0.84.3' },
    ]);

    expect(updated).toContain('"postgres": ["postgres@3.4.5", "", {}, "sha512-fake=="],');
  });
});
