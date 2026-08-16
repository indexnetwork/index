#!/usr/bin/env bun
/**
 * worktree-new — create or reuse a linked worktree for branch work, collision-safe.
 *
 *   bun run worktree:new <type>/<description> [--base <ref>] [--dry-run] [--json]
 *
 * Enforces the branch/folder policy from CLAUDE.md, refuses path and branch
 * collisions rather than mutating them, and always runs the mandatory
 * `worktree:setup` (dependency install + root env symlinks) for new *and* reused
 * worktrees.
 */
import { existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export const BRANCH_PATTERN = /^(feat|fix|chore|refactor|docs|test|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPAQUE_ISSUE_PATTERN = /^[a-z]+-\d+$/;

type WorktreeOptions = {
  branch: string;
  base: string;
  dryRun: boolean;
  json: boolean;
};

type CommandFact = { cwd: string; argv: string[] };

type WorktreeRecord = {
  path: string;
  branch: string | null;
  head: string | null;
};

export type WorktreePlan = {
  schemaVersion: 2;
  branch: string;
  base: string;
  folder: string;
  worktreePath: string;
  existingWorktree: boolean;
  dryRun: boolean;
  commands: CommandFact[];
};

type CommandResult = { code: number; stdout: string; stderr: string };
type CommandRunner = (argv: string[], cwd: string) => CommandResult;

class UsageError extends Error {}
class OperationalError extends Error {}

export function deriveWorktreeFolder(branch: string): string {
  return branch.replace("/", "-");
}

export function parseWorktreeArgs(rawArgs: string[]): WorktreeOptions {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  const branch = args.shift();
  if (!branch || branch.startsWith("--")) throw new UsageError("missing branch");

  const options: WorktreeOptions = { branch, base: "dev", dryRun: false, json: false };

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--base": {
        const value = args.shift();
        if (!value || value.startsWith("--")) throw new UsageError("--base requires a ref");
        options.base = value;
        break;
      }
      case "--dry-run": options.dryRun = true; break;
      case "--json": options.json = true; break;
      default: throw new UsageError(`unknown argument: ${flag ?? ""}`);
    }
  }

  if (!BRANCH_PATTERN.test(options.branch)) {
    throw new UsageError(`branch must match ${BRANCH_PATTERN.source}`);
  }
  const description = options.branch.slice(options.branch.indexOf("/") + 1);
  if (OPAQUE_ISSUE_PATTERN.test(description)) {
    throw new UsageError("branch description must explain the change, not only name an issue");
  }
  return options;
}

export function parseWorktreePorcelain(output: string): WorktreeRecord[] {
  return output
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split("\n")) {
        const separator = line.indexOf(" ");
        if (separator === -1) fields.set(line, "");
        else fields.set(line.slice(0, separator), line.slice(separator + 1));
      }
      const branchRef = fields.get("branch");
      return {
        path: fields.get("worktree") ?? "",
        branch: branchRef?.replace(/^refs\/heads\//, "") ?? null,
        head: fields.get("HEAD") ?? null,
      };
    });
}

function command(argv: string[], cwd: string): CommandFact {
  return { cwd, argv };
}

function checked(runner: CommandRunner, argv: string[], cwd: string, label: string): CommandResult {
  const result = runner(argv, cwd);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
    throw new OperationalError(`${label}: ${detail}`);
  }
  return result;
}

function samePath(left: string, right: string): boolean {
  const normalize = (path: string) => existsSync(path) ? realpathSync(path) : resolve(path);
  return normalize(left) === normalize(right);
}

export function buildWorktreePlan(options: WorktreeOptions, runner: CommandRunner): WorktreePlan {
  const worktreeResult = checked(runner, ["git", "worktree", "list", "--porcelain"], process.cwd(), "cannot list worktrees");
  const worktrees = parseWorktreePorcelain(worktreeResult.stdout);
  const canonicalRoot = worktrees[0]?.path;
  if (!canonicalRoot) throw new OperationalError("git did not report a canonical worktree");

  const folder = deriveWorktreeFolder(options.branch);
  const expectedPath = join(canonicalRoot, ".worktrees", folder);
  const expectedRecord = worktrees.find((record) => samePath(record.path, expectedPath));
  const branchRecord = worktrees.find((record) => record.branch === options.branch);

  if (expectedRecord && expectedRecord.branch !== options.branch) {
    throw new OperationalError(`worktree path collision: ${expectedPath} uses ${expectedRecord.branch ?? "a detached HEAD"}`);
  }
  if (branchRecord && !samePath(branchRecord.path, expectedPath)) {
    throw new OperationalError(`branch collision: ${options.branch} is checked out at ${branchRecord.path}`);
  }
  if (!expectedRecord && existsSync(expectedPath)) {
    throw new OperationalError(`path collision: ${expectedPath} exists but is not a registered worktree`);
  }

  const baseResult = runner(["git", "rev-parse", "--verify", `${options.base}^{commit}`], canonicalRoot);
  if (baseResult.code !== 0) throw new OperationalError(`base ref does not resolve to a commit: ${options.base}`);

  const branchExists = runner(["git", "show-ref", "--verify", "--quiet", `refs/heads/${options.branch}`], canonicalRoot).code === 0;

  const commands: CommandFact[] = [];
  if (!expectedRecord) {
    commands.push(command(
      branchExists
        ? ["git", "worktree", "add", expectedPath, options.branch]
        : ["git", "worktree", "add", "-b", options.branch, expectedPath, options.base],
      canonicalRoot,
    ));
  }
  // Mandatory for new AND reused worktrees: installs deps and links root env files.
  commands.push(command(["bun", "run", "worktree:setup", folder], canonicalRoot));

  return {
    schemaVersion: 2,
    branch: options.branch,
    base: options.base,
    folder,
    worktreePath: existsSync(expectedPath) ? realpathSync(expectedPath) : expectedPath,
    existingWorktree: Boolean(expectedRecord),
    dryRun: options.dryRun,
    commands,
  };
}

function systemRunner(argv: string[], cwd: string): CommandResult {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function executePlan(plan: WorktreePlan): void {
  for (const fact of plan.commands) {
    const result = systemRunner(fact.argv, fact.cwd);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code !== 0) throw new OperationalError(`command failed (${result.code}): ${fact.argv.join(" ")}`);
  }
  if (existsSync(plan.worktreePath)) plan.worktreePath = realpathSync(plan.worktreePath);
}

function usage(): string {
  return "usage: bun run worktree:new -- <type>/<description> [--base <ref>] [--dry-run] [--json]";
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const options = parseWorktreeArgs(argv);
    const plan = buildWorktreePlan(options, systemRunner);
    if (!options.dryRun) executePlan(plan);

    if (options.json) {
      console.log(JSON.stringify(plan));
    } else {
      console.log(`${options.dryRun ? "Dry run" : "Ready"}: ${plan.branch}${plan.existingWorktree ? " (reused)" : ""}`);
      console.log(`Worktree: ${plan.worktreePath}`);
      if (options.dryRun) {
        for (const fact of plan.commands) console.log(`- [${fact.cwd}] ${JSON.stringify(fact.argv)}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (error instanceof UsageError) {
      console.error(usage());
      process.exit(2);
    }
    process.exit(1);
  }
}

if (import.meta.main) main();
