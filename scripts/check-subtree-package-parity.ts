#!/usr/bin/env bun
/**
 * Mirror parity check for subtree-published packages.
 *
 * Packages under `packages/*` are mirrored to standalone repos by
 * `.github/workflows/sync-subtrees.yml`, and those mirrors build and publish
 * themselves. A mirror only contains the package subtree — the monorepo
 * `bun.lock` lives at the repo root and is NOT part of the split — so the
 * mirror's `bun install` resolves every dependency range to the newest
 * matching version on the registry, while the monorepo builds whatever the
 * lockfile pinned. `--frozen-lockfile` does not help: there is no lockfile to
 * freeze.
 *
 * When those diverge the monorepo stays green and the mirror's publish
 * workflow fails — or worse, publishes an artifact never built here. That is
 * exactly how `@modelcontextprotocol/server@2.0.0` (released 2026-07-27) broke
 * the protocol publish build while the lockfile still held `2.0.0-alpha.2`.
 *
 * Since a mirror has no lockfile, the only way its install can be reproducible
 * is for the package to declare exact versions. This check enforces that, and
 * that each exact version matches what is installed here.
 *
 * Usage: bun scripts/check-subtree-package-parity.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');

/**
 * Packages split out to standalone repos that install without the monorepo
 * lockfile. Keep in sync with the `sync-subtrees.yml` matrix; entries without
 * a package.json or without dependencies are skipped automatically.
 */
export const MIRRORED_PACKAGE_DIRS = [
  'packages/protocol',
  'packages/cli',
  'packages/claude-plugin',
  'packages/hermes-plugin',
  'packages/agent',
] as const;

/** Dependency fields a mirror install resolves when building the package. */
const CHECKED_FIELDS = ['dependencies', 'devDependencies'] as const;

/** Ranges that never hit the registry, so they cannot drift. */
const NON_REGISTRY_RANGE = /^(workspace:|catalog:|file:|link:|git\+|github:|https?:|portal:)/;

/** A single exact semver literal — the only reproducible range for a mirror. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export interface DependencyRange {
  /** Package the range belongs to, e.g. `packages/protocol`. */
  packageDir: string;
  /** Dependency name, e.g. `@modelcontextprotocol/server`. */
  name: string;
  /** Declared range, e.g. `^2.0.0-alpha.2`. */
  range: string;
  /** package.json field the range was declared in. */
  field: (typeof CHECKED_FIELDS)[number];
}

export type ParityViolation = DependencyRange &
  (
    | { kind: 'floating'; installed: string | null }
    /** Pinned, but the monorepo has a different version installed. */
    | { kind: 'mismatch'; installed: string }
  );

/** True when a range names exactly one version, e.g. `2.0.0` or `2.0.0-alpha.2`. */
export function isExactVersion(range: string): boolean {
  return EXACT_VERSION.test(range);
}

/**
 * Pure comparison core. A mirrored package must declare exact versions, and
 * each pin must equal the version installed from the monorepo lockfile.
 */
export function findParityViolations(
  ranges: readonly DependencyRange[],
  installed: (dep: DependencyRange) => string | null,
): ParityViolation[] {
  const violations: ParityViolation[] = [];
  for (const dep of ranges) {
    const installedVersion = installed(dep);
    if (!isExactVersion(dep.range)) {
      violations.push({ ...dep, kind: 'floating', installed: installedVersion });
      continue;
    }
    // Not installed at all is an install problem, not a drift problem; the
    // build itself surfaces that far more clearly than this check would.
    if (installedVersion === null || installedVersion === dep.range) continue;
    violations.push({ ...dep, kind: 'mismatch', installed: installedVersion });
  }
  return violations;
}

/** Registry-bound ranges declared by the mirrored packages. */
export function collectRanges(
  packageDirs: readonly string[],
  readPackageJson: (packageDir: string) => Record<string, unknown> | null,
): DependencyRange[] {
  const ranges: DependencyRange[] = [];
  for (const packageDir of packageDirs) {
    const pkg = readPackageJson(packageDir);
    if (!pkg) continue;
    for (const field of CHECKED_FIELDS) {
      const deps = pkg[field];
      if (!deps || typeof deps !== 'object') continue;
      for (const [name, range] of Object.entries(deps as Record<string, string>)) {
        if (typeof range !== 'string' || NON_REGISTRY_RANGE.test(range)) continue;
        ranges.push({ packageDir, name, range, field });
      }
    }
  }
  return ranges;
}

/** Version resolved by walking `node_modules` up from the package directory. */
export function resolveInstalledVersion(packageDir: string, name: string): string | null {
  let dir = join(REPO_ROOT, packageDir);
  for (;;) {
    const manifest = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      const version = JSON.parse(readFileSync(manifest, 'utf8')).version;
      return typeof version === 'string' ? version : null;
    }
    const parent = dirname(dir);
    if (parent === dir || dir.length <= REPO_ROOT.length) return null;
    dir = parent;
  }
}

function readPackageJsonFromDisk(packageDir: string): Record<string, unknown> | null {
  const path = join(REPO_ROOT, packageDir, 'package.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function formatViolation(violation: ParityViolation): string {
  const header = `  ${violation.packageDir} · ${violation.name} (${violation.field})`;
  if (violation.kind === 'floating') {
    const installed = violation.installed ?? 'not installed';
    return (
      `${header}\n` +
      `    declared:  ${violation.range}  (floating — a mirror install picks the newest match)\n` +
      `    installed: ${installed}\n` +
      `    fix:       pin to "${installed}", or to the version you intend to publish against`
    );
  }
  return (
    `${header}\n` +
    `    declared:  ${violation.range}\n` +
    `    installed: ${violation.installed}  (monorepo bun.lock)\n` +
    '    fix:       run bun install so the lockfile matches the pin, or correct the pin'
  );
}

async function main(): Promise<void> {
  const ranges = collectRanges(MIRRORED_PACKAGE_DIRS, readPackageJsonFromDisk);
  const violations = findParityViolations(ranges, (dep) =>
    resolveInstalledVersion(dep.packageDir, dep.name),
  );

  if (violations.length === 0) {
    console.log(
      `✅ Mirror parity: ${ranges.length} dependency range(s) across ${MIRRORED_PACKAGE_DIRS.length} mirrored package(s) are exact-pinned and match the installed tree.`,
    );
    return;
  }

  console.log(
    '❌ Mirror parity violations — subtree mirrors install without the monorepo lockfile,\n' +
      '   so these dependencies can build against versions this repo never built:\n',
  );
  for (const violation of violations) console.log(formatViolation(violation));
  console.log(`\n${violations.length} violation(s). See ${import.meta.file} for the rationale.`);
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
