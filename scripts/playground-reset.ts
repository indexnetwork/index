#!/usr/bin/env bun

const PROJECT_ID = "shiny-cloud-34341469";
const PLAYGROUND_BRANCH = "playground";

if (!process.argv.includes("--confirm")) {
  throw new Error("This discards all playground changes. Re-run with --confirm.");
}
if (!process.env.NEON_API_KEY) {
  throw new Error("NEON_API_KEY is required to reset the playground branch.");
}

const result = await Bun.spawn([
  "bunx",
  "--bun",
  "neonctl",
  "branches",
  "reset",
  PLAYGROUND_BRANCH,
  "--parent",
  `--project-id=${PROJECT_ID}`,
  "--no-color",
], { stdout: "inherit", stderr: "inherit" }).exited;

if (result !== 0) throw new Error(`Neon playground reset failed with exit code ${result}`);
