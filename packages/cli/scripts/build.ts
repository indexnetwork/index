#!/usr/bin/env bun
/**
 * Cross-compilation build script for the Index CLI.
 *
 * Produces:
 *   1. A bundled JS fallback (`dist/index.js`) for Node runtime.
 *   2. Platform-specific Bun-compiled binaries for each supported target.
 *   3. Copies each binary into its corresponding `npm/{platform}/bin/` directory.
 *
 * Usage:
 *   bun scripts/build.ts           # Build all targets
 *   bun scripts/build.ts --current # Build only the current platform (fast dev builds)
 */

import { $ } from "bun";
import { copyFile, mkdir, readFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

const CLI_ROOT = resolve(import.meta.dir, "..");
const SRC_ENTRY = join(CLI_ROOT, "src", "main.ts");
const DIST_DIR = join(CLI_ROOT, "dist");

/** Platform compilation targets. */
interface Target {
  /** Bun's --target flag value (e.g. "bun-linux-x64"). */
  bunTarget: string;
  /** Output binary name (e.g. "index-linux-x64"). */
  outName: string;
  /** Corresponding npm/ directory name (e.g. "linux-x64"). */
  npmDir: string;
}

const TARGETS: Target[] = [
  { bunTarget: "bun-linux-x64", outName: "index-linux-x64", npmDir: "linux-x64" },
  { bunTarget: "bun-linux-arm64", outName: "index-linux-arm64", npmDir: "linux-arm64" },
  { bunTarget: "bun-darwin-x64", outName: "index-darwin-x64", npmDir: "darwin-x64" },
  { bunTarget: "bun-darwin-arm64", outName: "index-darwin-arm64", npmDir: "darwin-arm64" },
];

/**
 * Determine the current platform's target, if any.
 *
 * @returns The matching target for the current OS/arch, or undefined.
 */
function currentPlatformTarget(): Target | undefined {
  const key = `${process.platform}-${process.arch}`;
  return TARGETS.find((t) => t.npmDir === key);
}

/**
 * Build the JS bundle for Node fallback.
 */
async function buildJsFallback(): Promise<void> {
  console.log("[build] Bundling JS fallback → dist/index.js");
  await mkdir(DIST_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [SRC_ENTRY],
    outdir: DIST_DIR,
    target: "node",
    format: "esm",
    minify: false,
    naming: "index.js",
  });

  if (!result.success) {
    console.error("[build] JS bundle failed:");
    for (const log of result.logs) {
      console.error("  ", log);
    }
    process.exit(1);
  }

  console.log("[build] JS fallback built successfully");
}

/**
 * Compile a platform binary using `bun build --compile`.
 *
 * @param target - The target platform definition.
 */
async function compileBinary(target: Target): Promise<void> {
  const outFile = join(DIST_DIR, target.outName);
  console.log(`[build] Compiling ${target.bunTarget} → ${target.outName}`);

  await $`bun build ${SRC_ENTRY} --compile --target=${target.bunTarget} --outfile ${outFile}`.quiet();

  console.log(`[build] Compiled ${target.outName}`);
}

/**
 * Copy the compiled binary into the corresponding npm/ platform directory.
 *
 * @param target - The target platform definition.
 */
async function copyToNpmDir(target: Target): Promise<void> {
  const srcBin = join(DIST_DIR, target.outName);
  const destDir = join(CLI_ROOT, "npm", target.npmDir, "bin");
  const destBin = join(destDir, "index");

  await mkdir(destDir, { recursive: true });
  await copyFile(srcBin, destBin);
  await chmod(destBin, 0o755);

  console.log(`[build] Copied → npm/${target.npmDir}/bin/index`);
}

/**
 * Validate that all package versions match the main package.json.
 */
async function assertVersionsAligned(): Promise<void> {
  const mainPkgPath = join(CLI_ROOT, "package.json");
  const mainPkg = JSON.parse(await readFile(mainPkgPath, "utf-8")) as {
    version: string;
    optionalDependencies?: Record<string, string>;
  };
  const mismatches: string[] = [];

  for (const target of TARGETS) {
    const depName = `@indexnetwork/cli-${target.npmDir}`;
    const pkgPath = join(CLI_ROOT, "npm", target.npmDir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as { version: string };
    if (pkg.version !== mainPkg.version) {
      mismatches.push(`npm/${target.npmDir}/package.json=${pkg.version}`);
    }
    if (mainPkg.optionalDependencies?.[depName] !== mainPkg.version) {
      mismatches.push(`optionalDependencies.${depName}=${mainPkg.optionalDependencies?.[depName] ?? "missing"}`);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `[build] Package versions must match ${mainPkg.version}: ${mismatches.join(", ")}`,
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const currentOnly = process.argv.includes("--current");

console.log(`[build] Index CLI cross-compilation build`);
console.log(`[build] Root: ${CLI_ROOT}`);
console.log(`[build] Mode: ${currentOnly ? "current platform only" : "all targets"}`);
console.log();

// Step 1: Validate versions across all package.json files
await assertVersionsAligned();

// Step 2: Build JS fallback bundle
await buildJsFallback();

// Step 3: Compile platform binaries
const targets = currentOnly ? [currentPlatformTarget()].filter(Boolean) as Target[] : TARGETS;

if (targets.length === 0) {
  console.error(`[build] No matching target for ${process.platform}-${process.arch}`);
  process.exit(1);
}

for (const target of targets) {
  await compileBinary(target);
  await copyToNpmDir(target);
}

console.log();
console.log(`[build] Done! Built ${targets.length} target(s).`);
