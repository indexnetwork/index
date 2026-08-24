#!/usr/bin/env bun
/**
 * Syncs workspace `version` fields from each package.json into the root `bun.lock`.
 *
 * `bun.lock` records a `version` for every workspace member, and Bun refreshes it
 * from package.json only unreliably. Verified against bun 1.3.14:
 *
 *   - When node_modules is already in sync with the lockfile — the normal case
 *     for a version-only bump, where nothing about the dependency graph changed —
 *     `bun install` leaves the recorded version stale. It will even rewrite other
 *     parts of bun.lock in the same run and still not correct it.
 *   - When the install has other work to do, the version usually is refreshed.
 *
 * So the outcome depends on unrelated local state, which makes it useless to rely
 * on either way: the same command updates the version on one machine and not on
 * the next. `bun install --frozen-lockfile` passes while the version is stale, so
 * nothing in the normal workflow catches the drift.
 *
 * The branch checklist requires bumping the version of every package a branch
 * touches and committing the regenerated lockfile. Without this script that step
 * is a hand edit of a generated file, which is easy to forget and easy to get
 * wrong. Run the sync after bumping; run `--check` in CI to catch drift.
 *
 * `bun.lock` is JSONC (trailing commas), and reserializing it would reformat the
 * whole file, so this rewrites just the matched `version` string in place.
 *
 * Usage:
 *   bun scripts/sync-lockfile-versions.ts            # rewrite bun.lock
 *   bun scripts/sync-lockfile-versions.ts --check    # report drift, exit 1
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const LOCKFILE_PATH = join(REPO_ROOT, 'bun.lock');

export interface WorkspaceVersionDrift {
  workspace: string;
  packageJsonVersion: string;
  lockfileVersion: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds the matcher for one workspace's `version` string.
 *
 * `[^}]*?` cannot cross a closing brace, so the match is confined to the
 * workspace's own header — `name` and `version` always precede the nested
 * dependency objects. A workspace that declares no version simply fails to
 * match rather than capturing the next workspace's.
 *
 * @param workspace - Workspace directory as keyed in the lockfile.
 * @returns Regex whose second group is the recorded version.
 */
export function buildWorkspaceVersionPattern(workspace: string): RegExp {
  return new RegExp(`("${escapeRegExp(workspace)}":\\s*\\{[^}]*?"version":\\s*")([^"]*)(")`);
}

/**
 * Reads the workspace directories declared by the root package.json.
 *
 * @param rootDirectory - Repository root.
 * @returns Declared workspace directories, wildcards excluded.
 */
export function readWorkspaceDirectories(rootDirectory: string): string[] {
  const manifest = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf8')) as {
    workspaces?: string[];
  };
  return (manifest.workspaces ?? []).filter((entry) => !entry.includes('*'));
}

/**
 * Reads a workspace's declared version from disk.
 *
 * @param rootDirectory - Repository root.
 * @returns Reader yielding the version, or null when absent or unversioned.
 */
export function createWorkspaceVersionReader(rootDirectory: string): (workspace: string) => string | null {
  return (workspace) => {
    const manifestPath = join(rootDirectory, workspace, 'package.json');
    if (!existsSync(manifestPath)) return null;
    const { version } = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
    return version ?? null;
  };
}

/**
 * Compares every workspace's package.json version against the lockfile.
 *
 * A workspace is skipped when it declares no version or the lockfile records
 * none for it — neither is drift, and neither is this script's business.
 *
 * @param lockfile - Raw `bun.lock` contents.
 * @param workspaces - Workspace directories to inspect.
 * @param readVersion - Yields the version each workspace declares.
 * @returns Workspaces whose recorded version is stale.
 */
export function findWorkspaceVersionDrift(
  lockfile: string,
  workspaces: readonly string[],
  readVersion: (workspace: string) => string | null,
): WorkspaceVersionDrift[] {
  const drift: WorkspaceVersionDrift[] = [];

  for (const workspace of workspaces) {
    const version = readVersion(workspace);
    if (!version) continue;

    const match = lockfile.match(buildWorkspaceVersionPattern(workspace));
    if (!match) continue;

    if (match[2] !== version) {
      drift.push({ workspace, packageJsonVersion: version, lockfileVersion: match[2] });
    }
  }

  return drift;
}

/**
 * Rewrites stale workspace versions in the lockfile text.
 *
 * @param lockfile - Raw `bun.lock` contents.
 * @param drift - Workspaces to correct.
 * @returns Updated lockfile contents.
 */
export function applyWorkspaceVersions(lockfile: string, drift: readonly WorkspaceVersionDrift[]): string {
  let updated = lockfile;
  for (const entry of drift) {
    updated = updated.replace(
      buildWorkspaceVersionPattern(entry.workspace),
      (_full, prefix: string, _recorded: string, suffix: string) =>
        `${prefix}${entry.packageJsonVersion}${suffix}`,
    );
  }
  return updated;
}

function main(): void {
  const checkOnly = process.argv.includes('--check');
  const lockfile = readFileSync(LOCKFILE_PATH, 'utf8');
  const drift = findWorkspaceVersionDrift(
    lockfile,
    readWorkspaceDirectories(REPO_ROOT),
    createWorkspaceVersionReader(REPO_ROOT),
  );

  if (drift.length === 0) {
    console.log('bun.lock workspace versions match package.json.');
    return;
  }

  for (const entry of drift) {
    console.log(`  ${entry.workspace}: bun.lock ${entry.lockfileVersion} -> package.json ${entry.packageJsonVersion}`);
  }

  if (checkOnly) {
    console.error(
      `\n${drift.length} workspace version(s) stale in bun.lock. Run "bun run sync:lockfile-versions" and commit the result.`,
    );
    process.exit(1);
  }

  writeFileSync(LOCKFILE_PATH, applyWorkspaceVersions(lockfile, drift));
  console.log(`\nUpdated ${drift.length} workspace version(s) in bun.lock.`);
}

if (import.meta.main) main();
