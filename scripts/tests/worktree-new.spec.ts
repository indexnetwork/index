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

/**
 * @param refs which of refs/heads/<branch> and refs/remotes/origin/<branch> exist
 */
function makeRunner(
  porcelain: string,
  refs: { local?: boolean; remote?: boolean } = {},
  calls: string[][] = [],
) {
  return (argv: string[]): Result => {
    calls.push(argv);
    if (argv[1] === "worktree" && argv[2] === "list") return result(0, porcelain);
    if (argv[1] === "fetch") return result(0);
    if (argv[1] === "rev-parse") return result(0, "abc\n");
    if (argv[1] === "show-ref") {
      const ref = argv[argv.length - 1];
      if (ref.startsWith("refs/heads/")) return result(refs.local ? 0 : 1);
      if (ref.startsWith("refs/remotes/")) return result(refs.remote ? 0 : 1);
    }
    return result(1);
  };
}

describe("worktree arguments", () => {
  it("derives the folder and defaults deterministically", () => {
    expect(deriveWorktreeFolder("chore/session-automation")).toBe("chore-session-automation");
    expect(parseWorktreeArgs(["chore/session-automation", "--dry-run", "--json"])).toEqual({
      branch: "chore/session-automation",
      base: "origin/dev",
      fetch: true,
      dryRun: true,
      json: true,
    });
  });

  it("defaults the base to origin/dev, not the local dev branch", () => {
    // The canonical root is routinely behind the remote; basing on local `dev`
    // silently cuts branches from a stale commit.
    expect(parseWorktreeArgs(["fix/useful-name"]).base).toBe("origin/dev");
  });

  it("accepts an explicit base ref and --no-fetch", () => {
    expect(parseWorktreeArgs(["fix/useful-name", "--base", "origin/main"]).base).toBe("origin/main");
    expect(parseWorktreeArgs(["fix/useful-name", "--no-fetch"]).fetch).toBe(false);
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

  it("fetches before resolving refs, then creates a new branch from origin/dev", () => {
    const calls: string[][] = [];
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["chore/session-automation", "--dry-run", "--json"]),
      makeRunner(DEV_ONLY, {}, calls),
    );

    expect(plan).toEqual({
      schemaVersion: 3,
      branch: "chore/session-automation",
      base: "origin/dev",
      folder: "chore-session-automation",
      worktreePath: "/repo/.worktrees/chore-session-automation",
      existingWorktree: false,
      branchSource: "new",
      dryRun: true,
      commands: [
        {
          cwd: "/repo",
          argv: [
            "git", "worktree", "add", "-b", "chore/session-automation",
            "/repo/.worktrees/chore-session-automation", "origin/dev",
          ],
        },
        { cwd: "/repo", argv: ["bun", "run", "worktree:setup", "chore-session-automation"] },
      ],
    });
    // The fetch must precede rev-parse and show-ref, or both read stale refs.
    expect(calls.map((argv) => argv[1])).toEqual([
      "worktree", "fetch", "rev-parse", "show-ref", "show-ref",
    ]);
  });

  it("skips the fetch under --no-fetch", () => {
    const calls: string[][] = [];
    buildWorktreePlan(
      parseWorktreeArgs(["chore/session-automation", "--no-fetch", "--dry-run"]),
      makeRunner(DEV_ONLY, {}, calls),
    );
    expect(calls.some((argv) => argv[1] === "fetch")).toBe(false);
  });

  it("skips the fetch when the base is a bare local ref", () => {
    const calls: string[][] = [];
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["chore/session-automation", "--base", "HEAD", "--dry-run"]),
      makeRunner(DEV_ONLY, {}, calls),
    );
    expect(calls.some((argv) => argv[1] === "fetch")).toBe(false);
    expect(plan.branchSource).toBe("new");
  });

  it("checks out an existing local branch instead of creating it", () => {
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["fix/session-launch", "--dry-run"]),
      makeRunner(DEV_ONLY, { local: true }),
    );

    expect(plan.branchSource).toBe("local");
    expect(plan.commands[0].argv).toEqual([
      "git", "worktree", "add", "/repo/.worktrees/fix-session-launch", "fix/session-launch",
    ]);
  });

  it("tracks a branch that exists only on the remote rather than recreating it at base", () => {
    // Recreating it with -b from origin/dev produces an empty divergent branch whose
    // first push is rejected as a non-fast-forward.
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["fix/session-launch", "--dry-run"]),
      makeRunner(DEV_ONLY, { remote: true }),
    );

    expect(plan.branchSource).toBe("remote");
    expect(plan.commands[0].argv).toEqual([
      "git", "worktree", "add", "--track", "-b", "fix/session-launch",
      "/repo/.worktrees/fix-session-launch", "origin/fix/session-launch",
    ]);
  });

  it("prefers the local branch when both a local and a remote ref exist", () => {
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["fix/session-launch", "--dry-run"]),
      makeRunner(DEV_ONLY, { local: true, remote: true }),
    );
    expect(plan.branchSource).toBe("local");
  });

  it("reuses a matching worktree and still runs setup", () => {
    const plan = buildWorktreePlan(
      parseWorktreeArgs(["fix/session-launch", "--dry-run"]),
      makeRunner(DEV_PLUS_FEATURE, { local: true }),
    );

    expect(plan.existingWorktree).toBe(true);
    expect(plan.commands).toEqual([
      { cwd: "/repo", argv: ["bun", "run", "worktree:setup", "fix-session-launch"] },
    ]);
  });

  it("rejects a branch already checked out at another path", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD abc",
      "branch refs/heads/dev",
      "",
      "worktree /elsewhere/fix-session-launch",
      "HEAD def",
      "branch refs/heads/fix/session-launch",
      "",
    ].join("\n");

    expect(() => buildWorktreePlan(
      parseWorktreeArgs(["fix/session-launch", "--dry-run"]),
      makeRunner(porcelain, { local: true }),
    )).toThrow(/branch collision/);
  });

  it("fails loudly when the fetch fails instead of silently using stale refs", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") return result(0, DEV_ONLY);
      if (argv[1] === "fetch") return result(128, "", "could not resolve host");
      return result(0, "abc\n");
    };

    expect(() => buildWorktreePlan(parseWorktreeArgs(["fix/useful-name", "--dry-run"]), runner))
      .toThrow(/cannot fetch origin/);
  });

  it("rejects a base ref that does not resolve", () => {
    const runner = (argv: string[]): Result => {
      if (argv[1] === "worktree") return result(0, DEV_ONLY);
      if (argv[1] === "fetch") return result(0);
      if (argv[1] === "rev-parse") return result(128);
      return result(1);
    };

    expect(() => buildWorktreePlan(parseWorktreeArgs(["fix/useful-name", "--base", "origin/nope"]), runner))
      .toThrow(/base ref does not resolve/);
  });
});
