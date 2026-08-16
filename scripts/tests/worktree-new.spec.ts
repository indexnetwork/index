import { describe, expect, it } from "bun:test";

import {
  buildWorktreePlan,
  deriveWorktreeFolder,
  parseWorktreeArgs,
  parseWorktreePorcelain,
} from "../worktree-new";

type Result = { code: number; stdout: string; stderr: string };

function result(code = 0, stdout = "", stderr = ""): Result {
  return { code, stdout, stderr };
}

const DEV_ONLY = "worktree /repo\nHEAD abc\nbranch refs/heads/dev\n";

const DEV_PLUS_FEATURE = [
  "worktree /repo",
  "HEAD abc",
  "branch refs/heads/dev",
  "",
  "worktree /repo/.worktrees/fix-session-launch",
  "HEAD def",
  "branch refs/heads/fix/session-launch",
  "",
].join("\n");

describe("worktree arguments", () => {
  it("derives the folder and defaults deterministically", () => {
    expect(deriveWorktreeFolder("chore/session-automation")).toBe("chore-session-automation");
    expect(parseWorktreeArgs(["chore/session-automation", "--dry-run", "--json"])).toEqual({
      branch: "chore/session-automation",
      base: "dev",
      dryRun: true,
      json: true,
    });
  });

  it("accepts an explicit base ref", () => {
    expect(parseWorktreeArgs(["fix/useful-name", "--base", "origin/main"]).base).toBe("origin/main");
  });

  it("rejects malformed and opaque issue-only branches", () => {
    expect(() => parseWorktreeArgs(["feature/not-valid"])).toThrow(/branch must match/);
    expect(() => parseWorktreeArgs(["chore/ind-422"])).toThrow(/not only name an issue/);
    expect(() => parseWorktreeArgs(["fix/useful-name", "--nope"])).toThrow(/unknown argument/);
  });
});

describe("worktree dry-run plan", () => {
  it("parses detached and named worktree records", () => {
    expect(parseWorktreePorcelain(
      "worktree /repo\nHEAD abc\nbranch refs/heads/dev\n\nworktree /repo/.worktrees/test\nHEAD def\ndetached\n",
    )).toEqual([
      { path: "/repo", head: "abc", branch: "dev" },
      { path: "/repo/.worktrees/test", head: "def", branch: null },
    ]);
  });

  it("produces ordered mutation argv without executing them", () => {
    const calls: Array<{ argv: string[]; cwd: string }> = [];
    const runner = (argv: string[], cwd: string): Result => {
      calls.push({ argv, cwd });
      if (argv.join(" ") === "git worktree list --porcelain") return result(0, DEV_ONLY);
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref") return result(1);
      throw new Error(`unexpected inspection command: ${argv.join(" ")}`);
    };

    const plan = buildWorktreePlan(parseWorktreeArgs(["chore/session-automation", "--dry-run", "--json"]), runner);

    expect(plan).toEqual({
      schemaVersion: 2,
      branch: "chore/session-automation",
      base: "dev",
      folder: "chore-session-automation",
      worktreePath: "/repo/.worktrees/chore-session-automation",
      existingWorktree: false,
      dryRun: true,
      commands: [
        {
          cwd: "/repo",
          argv: [
            "git", "worktree", "add", "-b", "chore/session-automation",
            "/repo/.worktrees/chore-session-automation", "dev",
          ],
        },
        { cwd: "/repo", argv: ["bun", "run", "worktree:setup", "chore-session-automation"] },
      ],
    });
    expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
      ["git", "worktree"],
      ["git", "rev-parse"],
      ["git", "show-ref"],
    ]);
  });

  it("checks out an existing branch instead of creating it", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") return result(0, DEV_ONLY);
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref") return result(0);
      return result(1);
    };

    const plan = buildWorktreePlan(parseWorktreeArgs(["fix/session-launch", "--dry-run"]), runner);

    expect(plan.commands[0].argv).toEqual([
      "git", "worktree", "add", "/repo/.worktrees/fix-session-launch", "fix/session-launch",
    ]);
  });

  it("reuses a matching worktree and still runs setup", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") return result(0, DEV_PLUS_FEATURE);
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref") return result(0);
      return result(1);
    };

    const plan = buildWorktreePlan(parseWorktreeArgs(["fix/session-launch", "--dry-run"]), runner);

    expect(plan.existingWorktree).toBe(true);
    expect(plan.commands).toEqual([
      { cwd: "/repo", argv: ["bun", "run", "worktree:setup", "fix-session-launch"] },
    ]);
  });

  it("rejects a branch already checked out at another path", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") {
        return result(0, [
          "worktree /repo",
          "HEAD abc",
          "branch refs/heads/dev",
          "",
          "worktree /elsewhere/fix-session-launch",
          "HEAD def",
          "branch refs/heads/fix/session-launch",
          "",
        ].join("\n"));
      }
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref") return result(0);
      return result(1);
    };

    expect(() => buildWorktreePlan(parseWorktreeArgs(["fix/session-launch", "--dry-run"]), runner))
      .toThrow(/branch collision/);
  });

  it("rejects a base ref that does not resolve", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") return result(0, DEV_ONLY);
      if (argv[1] === "rev-parse") return result(128);
      return result(1);
    };

    expect(() => buildWorktreePlan(parseWorktreeArgs(["fix/useful-name", "--base", "origin/nope"]), runner))
      .toThrow(/base ref does not resolve/);
  });
});
