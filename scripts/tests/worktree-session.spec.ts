import { describe, expect, it } from "bun:test";

import {
  buildSessionPlan,
  deriveWorktreeFolder,
  parseSessionArgs,
  parseWorktreePorcelain,
} from "../worktree-session";

type Result = { code: number; stdout: string; stderr: string };

function result(code = 0, stdout = "", stderr = ""): Result {
  return { code, stdout, stderr };
}

describe("worktree session arguments", () => {
  it("derives the folder and defaults deterministically", () => {
    expect(deriveWorktreeFolder("chore/session-automation")).toBe("chore-session-automation");
    expect(parseSessionArgs(["chore/session-automation", "--dry-run", "--json"])).toEqual({
      branch: "chore/session-automation",
      base: "dev",
      promptFile: null,
      attach: false,
      dryRun: true,
      json: true,
    });
  });

  it("rejects malformed, opaque issue-only, and attach-plus-json branches", () => {
    expect(() => parseSessionArgs(["feature/not-valid"])).toThrow(/branch must match/);
    expect(() => parseSessionArgs(["chore/ind-422"])).toThrow(/not only name an issue/);
    expect(() => parseSessionArgs(["fix/useful-name", "--attach", "--json"])).toThrow(/cannot be combined/);
  });
});

describe("worktree session dry-run plan", () => {
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
      if (argv.join(" ") === "git worktree list --porcelain") {
        return result(0, "worktree /repo\nHEAD abc\nbranch refs/heads/dev\n");
      }
      if (argv[0] === "git" && argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[0] === "git" && argv[1] === "show-ref") return result(1);
      if (argv[0] === "tmux" && argv[1] === "has-session") return result(1);
      throw new Error(`unexpected inspection command: ${argv.join(" ")}`);
    };

    const plan = buildSessionPlan(parseSessionArgs(["chore/session-automation", "--dry-run", "--json"]), runner);

    expect(plan).toEqual({
      schemaVersion: 1,
      branch: "chore/session-automation",
      base: "dev",
      folder: "chore-session-automation",
      worktreePath: "/repo/.worktrees/chore-session-automation",
      tmuxSession: "pi-chore-session-automation",
      piSessionName: "pi-chore-session-automation",
      promptFile: null,
      existingWorktree: false,
      existingTmuxSession: false,
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
        {
          cwd: "/repo",
          argv: [
            "tmux", "new-session", "-d", "-s", "pi-chore-session-automation", "-c",
            "/repo/.worktrees/chore-session-automation", "pi --name pi-chore-session-automation",
          ],
        },
      ],
    });
    expect(calls.map((call) => call.argv.slice(0, 2))).toEqual([
      ["git", "worktree"],
      ["git", "rev-parse"],
      ["git", "show-ref"],
      ["tmux", "has-session"],
    ]);
  });

  it("reuses a matching worktree and rejects a tmux pane with another cwd", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") {
        return result(0, [
          "worktree /repo",
          "HEAD abc",
          "branch refs/heads/dev",
          "",
          "worktree /repo/.worktrees/fix-session-launch",
          "HEAD def",
          "branch refs/heads/fix/session-launch",
          "",
        ].join("\n"));
      }
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref") return result(0);
      if (argv[1] === "has-session") return result(0);
      if (argv[1] === "display-message") return result(0, "/another/path\n");
      return result(1);
    };

    expect(() => buildSessionPlan(parseSessionArgs(["fix/session-launch", "--dry-run"]), runner))
      .toThrow(/has cwd \/another\/path/);
  });
});
