import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { stripAnsi } from "../src/output";

const CLI_ROOT = join(import.meta.dir, "..");

function renderHelp(): string {
  const result = spawnSync("bun", ["src/main.ts", "--help"], {
    cwd: CLI_ROOT,
    encoding: "utf-8",
  });

  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return stripAnsi(result.stdout);
}

describe("main help output", () => {
  it("documents supported command forms and options", () => {
    const help = renderHelp();

    for (const expected of [
      "index login --token <token>",
      "index logout",
      'index conversation "message"',
      "index conversation --session <id>",
      "index sync --json",
      "--app-url <url>",
      "--session <id>",
      "--archived",
      "--status <status>",
      "--since <date>",
      "--objective <text>",
      "--target <uid>",
      "--introduce <uid>",
      "--details <text>",
    ]) {
      expect(help).toContain(expected);
    }
  });
});
