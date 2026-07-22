import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const tempDirs: string[] = [];

function multilinePrompt(): { path: string; content: string } {
  const dir = mkdtempSync(join(tmpdir(), "worktree-session-"));
  tempDirs.push(dir);
  const path = join(dir, "multiline prompt's file.md");
  const content = "First line\nSecond line with $(unsafe)\nThird line";
  writeFileSync(path, content);
  return { path, content };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

  it("passes a multiline prompt file reference as the new Pi session's initial prompt", () => {
    const prompt = multilinePrompt();
    const calls: Array<string[]> = [];
    const runner = (argv: string[]): Result => {
      calls.push(argv);
      if (argv[1] === "worktree") return result(0, "worktree /repo\nHEAD abc\nbranch refs/heads/dev\n");
      if (argv[1] === "rev-parse") return result(0, "abc\n");
      if (argv[1] === "show-ref" || argv[1] === "has-session") return result(1);
      throw new Error(`unexpected inspection command: ${argv.join(" ")}`);
    };

    const plan = buildSessionPlan(parseSessionArgs([
      "chore/session-automation", "--prompt-file", prompt.path, "--dry-run",
    ]), runner);
    const tmuxCommands = plan.commands.filter((fact) => fact.argv[0] === "tmux");

    expect(tmuxCommands).toHaveLength(1);
    expect(tmuxCommands[0].argv[1]).toBe("new-session");
    const promptArg = `@${plan.promptFile}`;
    const quotedPromptArg = `'${promptArg.replaceAll("'", `'\\''`)}'`;
    expect(tmuxCommands[0].argv.at(-1)).toContain(quotedPromptArg);
    expect(tmuxCommands[0].argv.at(-1)).not.toContain(prompt.content);
    expect(tmuxCommands[0].argv.at(-1)).not.toContain("First line");
    expect(calls.every((argv) => !["new-session", "load-buffer", "paste-buffer", "send-keys"].includes(argv[1] ?? ""))).toBe(true);
  });

  it("targets one resolved pane ID and bracket-pastes a multiline prompt once", () => {
    const prompt = multilinePrompt();
    const calls: string[][] = [];
    const runner = (argv: string[]): Result => {
      calls.push(argv);
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
      if (argv[1] === "show-ref" || argv[1] === "has-session") return result(0);
      if (argv[1] === "list-panes") return result(0, "%17\n");
      if (argv[1] === "display-message") {
        return result(0, "/repo/.worktrees/fix-session-launch\tpi\t0\t0\n");
      }
      return result(1);
    };

    const plan = buildSessionPlan(parseSessionArgs([
      "fix/session-launch", "--prompt-file", prompt.path, "--dry-run",
    ]), runner);

    expect(calls.find((argv) => argv[1] === "has-session")).toEqual([
      "tmux", "has-session", "-t", "=pi-fix-session-launch",
    ]);
    expect(calls.find((argv) => argv[1] === "list-panes")).toEqual([
      "tmux", "list-panes", "-t", "=pi-fix-session-launch", "-F", "#{pane_id}",
    ]);
    expect(calls.find((argv) => argv[1] === "display-message")?.includes("%17")).toBe(true);
    expect(plan.commands.filter((fact) => fact.argv[1] === "paste-buffer")).toEqual([{
      cwd: "/repo",
      argv: [
        "tmux", "paste-buffer", "-p", "-b", "pi-prompt-fix-session-launch", "-t", "%17", "-d",
      ],
    }]);
    expect(plan.commands.filter((fact) => fact.argv[1] === "send-keys")).toEqual([{
      cwd: "/repo",
      argv: ["tmux", "send-keys", "-t", "%17", "Enter"],
    }]);
    expect(JSON.stringify(plan.commands)).not.toContain(prompt.content);
    expect(JSON.stringify(plan.commands)).not.toContain(":0.0");
  });

  it("rejects ambiguous panes and non-Pi pane state instead of targeting a prefix", () => {
    const baseRunner = (argv: string[]): Result => {
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
      if (argv[1] === "show-ref" || argv[1] === "has-session") return result(0);
      return result(1);
    };

    expect(() => buildSessionPlan(parseSessionArgs(["fix/session-launch", "--dry-run"]), (argv) => {
      if (argv[1] === "list-panes") return result(0, "%1\n%2\n");
      return baseRunner(argv);
    })).toThrow(/exactly one resolvable pane/);

    expect(() => buildSessionPlan(parseSessionArgs(["fix/session-launch", "--dry-run"]), (argv) => {
      if (argv[1] === "list-panes") return result(0, "%21\n");
      if (argv[1] === "display-message") {
        return result(0, "/repo/.worktrees/fix-session-launch\tzsh\t0\t0\n");
      }
      return baseRunner(argv);
    })).toThrow(/not an active Pi prompt/);
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
      if (argv[1] === "show-ref" || argv[1] === "has-session") return result(0);
      if (argv[1] === "list-panes") return result(0, "%3\n");
      if (argv[1] === "display-message") return result(0, "/another/path\tpi\t0\t0\n");
      return result(1);
    };

    expect(() => buildSessionPlan(parseSessionArgs(["fix/session-launch", "--dry-run"]), runner))
      .toThrow(/has cwd \/another\/path/);
  });
});
