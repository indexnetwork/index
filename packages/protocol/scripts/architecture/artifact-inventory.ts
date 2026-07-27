#!/usr/bin/env bun
/** Ensures source-test helpers never ship in the published package artifact. */
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "../..");
const distRoot = resolve(packageRoot, "dist");

async function filesIn(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  }));
  return files.flat();
}

function isSourceTestArtifact(path: string): boolean {
  return /^dist\/(?:.*\/)?tests\//.test(path)
    || /\.spec\.[^/]+$/.test(path)
    || /\.test\.[^/]+$/.test(path);
}

const emittedPaths = (await filesIn(distRoot)).map((path) => relative(packageRoot, path));
const emittedTestArtifacts = emittedPaths.filter(isSourceTestArtifact);
if (emittedTestArtifacts.length > 0) {
  throw new Error(`Build emitted source-test artifacts:\n${emittedTestArtifacts.map((path) => `- ${path}`).join("\n")}`);
}

const proc = Bun.spawn(["bun", "pm", "pack", "--dry-run"], {
  cwd: packageRoot,
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (exitCode !== 0) throw new Error(`bun pm pack --dry-run failed:\n${stdout}${stderr}`);

const paths = stdout
  .split("\n")
  .map((line) => /^packed\s+(.+)$/.exec(line)?.[1])
  .filter((path): path is string => path !== undefined);
const testArtifacts = paths.filter(isSourceTestArtifact);

if (testArtifacts.length > 0) {
  throw new Error(`Published package contains source-test artifacts:\n${testArtifacts.map((path) => `- ${path}`).join("\n")}`);
}

const sourceMapArtifacts = paths.filter((path) => path.endsWith(".map"));
if (sourceMapArtifacts.length > 0) {
  throw new Error(`Published package contains source maps (the publication budget is zero):\n${sourceMapArtifacts.map((path) => `- ${path}`).join("\n")}`);
}

console.log(`Package artifact inventory OK (${paths.length} files; no source-test or source-map artifacts).`);
