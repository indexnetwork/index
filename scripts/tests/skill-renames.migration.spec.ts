import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const fixturePath = "scripts/tests/skill-renames.migration.spec.ts";

const retiredNames = [
  "bump-agentvillage-submodule-pointer",
  "cleaning-up-codebases",
  "connect-link-routing-safety",
  "debug-negotiation-summary-silent",
  "edge-city-telegram-changelog",
  "flag-rollout-consistency",
  "git-worktree-workflow",
  "neon-prod-data-backfill",
  "opportunity-presentation-safety",
  "pi-skill-authoring",
  "railway-headless-auth",
  "railway-mcp-edge-city",
  "receiving-code-review",
  "release-prod-safety",
  "web-persona-cutover-routing",
  "worktree-session-pipeline",
] as const;

describe("project-local skill rename migration", () => {
  it("leaves no retired name or path in tracked sources", async () => {
    const process = Bun.spawn(["git", "ls-files", "-z"], {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).arrayBuffer(),
      new Response(process.stderr).text(),
    ]);
    expect(code, stderr).toBe(0);

    const tracked = Buffer.from(stdout)
      .toString("utf8")
      .split("\0")
      .filter((path) => path && path !== fixturePath);
    const matches: string[] = [];

    for (const path of tracked) {
      for (const retiredName of retiredNames) {
        if (path.includes(retiredName)) matches.push(`${path}: ${retiredName}`);
      }
      let content: string;
      try {
        content = readFileSync(resolve(repositoryRoot, path), "utf8");
      } catch {
        continue;
      }
      for (const retiredName of retiredNames) {
        if (content.includes(retiredName)) matches.push(`${path}: ${retiredName}`);
      }
    }

    expect(matches).toEqual([]);
  });
});
