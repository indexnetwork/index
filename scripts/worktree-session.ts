#!/usr/bin/env bun
import { existsSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const BRANCH_PATTERN = /^(feat|fix|chore|refactor|docs|test|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OPAQUE_ISSUE_PATTERN = /^[a-z]+-\d+$/;

type SessionOptions = {
  branch: string;
  base: string;
  promptFile: string | null;
  attach: boolean;
  dryRun: boolean;
  json: boolean;
};

type CommandFact = { cwd: string; argv: string[] };

type WorktreeRecord = {
  path: string;
  branch: string | null;
  head: string | null;
};

export type SessionPlan = {
  schemaVersion: 1;
  branch: string;
  base: string;
  folder: string;
  worktreePath: string;
  tmuxSession: string;
  piSessionName: string;
  promptFile: string | null;
  existingWorktree: boolean;
  existingTmuxSession: boolean;
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

export function parseSessionArgs(rawArgs: string[]): SessionOptions {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  const branch = args.shift();
  if (!branch || branch.startsWith("--")) throw new UsageError("missing branch");

  const options: SessionOptions = {
    branch,
    base: "dev",
    promptFile: null,
    attach: false,
    dryRun: false,
    json: false,
  };

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--base": {
        const value = args.shift();
        if (!value || value.startsWith("--")) throw new UsageError("--base requires a ref");
        options.base = value;
        break;
      }
      case "--prompt-file": {
        const value = args.shift();
        if (!value || value.startsWith("--")) throw new UsageError("--prompt-file requires an absolute path");
        options.promptFile = value;
        break;
      }
      case "--attach": options.attach = true; break;
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
  if (options.attach && options.json) throw new UsageError("--attach cannot be combined with --json");
  if (options.promptFile !== null) {
    if (!isAbsolute(options.promptFile)) throw new UsageError("--prompt-file must be absolute");
    if (!existsSync(options.promptFile) || !statSync(options.promptFile).isFile()) {
      throw new UsageError(`prompt file not found: ${options.promptFile}`);
    }
    options.promptFile = realpathSync(options.promptFile);
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

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function shellCommand(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
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

export function buildSessionPlan(options: SessionOptions, runner: CommandRunner): SessionPlan {
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
  const tmuxSession = `pi-${folder}`;
  const exactTmuxSession = `=${tmuxSession}`;
  const piSessionName = tmuxSession;
  const tmuxExists = runner(["tmux", "has-session", "-t", exactTmuxSession], canonicalRoot).code === 0;
  let existingPaneId: string | null = null;
  if (tmuxExists) {
    const paneIds = checked(
      runner,
      ["tmux", "list-panes", "-t", exactTmuxSession, "-F", "#{pane_id}"],
      canonicalRoot,
      "cannot resolve existing tmux pane",
    ).stdout.split("\n").map((value) => value.trim()).filter(Boolean);
    if (paneIds.length !== 1 || !/^%\d+$/.test(paneIds[0] ?? "")) {
      throw new OperationalError(`tmux session ${tmuxSession} must contain exactly one resolvable pane; found ${paneIds.length}`);
    }
    existingPaneId = paneIds[0];

    const paneFields = checked(
      runner,
      [
        "tmux", "display-message", "-p", "-t", existingPaneId,
        "#{pane_current_path}\t#{pane_current_command}\t#{pane_dead}\t#{pane_in_mode}",
      ],
      canonicalRoot,
      "cannot inspect existing tmux pane",
    ).stdout.trim().split("\t");
    if (paneFields.length !== 4) {
      throw new OperationalError(`tmux pane ${existingPaneId} returned an unexpected state`);
    }
    const [panePath, paneCommand, paneDead, paneInMode] = paneFields;
    if (!samePath(panePath, expectedPath)) {
      throw new OperationalError(`tmux session ${tmuxSession} has cwd ${panePath}, expected ${expectedPath}`);
    }
    if (paneCommand !== "pi" || paneDead !== "0" || paneInMode !== "0") {
      throw new OperationalError(
        `tmux pane ${existingPaneId} is not an active Pi prompt (command=${paneCommand || "unknown"}, dead=${paneDead || "unknown"}, mode=${paneInMode || "unknown"})`,
      );
    }
  }

  const commands: CommandFact[] = [];
  if (!expectedRecord) {
    commands.push(command(
      branchExists
        ? ["git", "worktree", "add", expectedPath, options.branch]
        : ["git", "worktree", "add", "-b", options.branch, expectedPath, options.base],
      canonicalRoot,
    ));
  }
  commands.push(command(["bun", "run", "worktree:setup", folder], canonicalRoot));
  if (!tmuxExists) {
    const piArgv = ["pi", "--name", piSessionName];
    if (options.promptFile) piArgv.push(`@${options.promptFile}`);
    commands.push(command(
      ["tmux", "new-session", "-d", "-s", tmuxSession, "-c", expectedPath, shellCommand(piArgv)],
      canonicalRoot,
    ));
  } else if (options.promptFile) {
    if (!existingPaneId) throw new OperationalError(`tmux session ${tmuxSession} has no resolved pane`);
    const buffer = `pi-prompt-${folder}`;
    commands.push(command(["tmux", "load-buffer", "-b", buffer, options.promptFile], canonicalRoot));
    commands.push(command(["tmux", "paste-buffer", "-p", "-b", buffer, "-t", existingPaneId, "-d"], canonicalRoot));
    commands.push(command(["tmux", "send-keys", "-t", existingPaneId, "Enter"], canonicalRoot));
  }
  if (options.attach) commands.push(command(["tmux", "attach-session", "-t", exactTmuxSession], canonicalRoot));

  return {
    schemaVersion: 1,
    branch: options.branch,
    base: options.base,
    folder,
    worktreePath: existsSync(expectedPath) ? realpathSync(expectedPath) : expectedPath,
    tmuxSession,
    piSessionName,
    promptFile: options.promptFile,
    existingWorktree: Boolean(expectedRecord),
    existingTmuxSession: tmuxExists,
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

function executePlan(plan: SessionPlan): void {
  for (let index = 0; index < plan.commands.length; index += 1) {
    const fact = plan.commands[index];
    if (fact.argv[0] === "tmux" && fact.argv[1] === "attach-session") {
      const attached = Bun.spawnSync(fact.argv, {
        cwd: fact.cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      if (attached.exitCode !== 0) throw new OperationalError(`command failed (${attached.exitCode}): ${fact.argv.join(" ")}`);
      continue;
    }

    const result = systemRunner(fact.argv, fact.cwd);
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code !== 0) throw new OperationalError(`command failed (${result.code}): ${fact.argv.join(" ")}`);

    if (fact.argv[0] === "bun" && fact.argv[2] === "worktree:setup") {
      plan.worktreePath = realpathSync(plan.worktreePath);
      for (const pending of plan.commands.slice(index + 1)) {
        if (pending.argv[0] !== "tmux" || pending.argv[1] !== "new-session") continue;
        const cwdIndex = pending.argv.indexOf("-c");
        if (cwdIndex !== -1) pending.argv[cwdIndex + 1] = plan.worktreePath;
      }
    }
  }
}

function usage(): string {
  return "usage: bun run worktree:session -- <type>/<description> [--base <ref>] [--prompt-file <absolute-path>] [--attach] [--dry-run] [--json]";
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const options = parseSessionArgs(argv);
    const plan = buildSessionPlan(options, systemRunner);
    if (!options.dryRun) executePlan(plan);

    if (options.json) {
      console.log(JSON.stringify(plan));
    } else {
      console.log(`${options.dryRun ? "Dry run" : "Ready"}: ${plan.branch}`);
      console.log(`Worktree: ${plan.worktreePath}`);
      console.log(`tmux: ${plan.tmuxSession}${plan.existingTmuxSession ? " (reused)" : ""}`);
      if (options.dryRun) {
        for (const fact of plan.commands) console.log(`- [${fact.cwd}] ${JSON.stringify(fact.argv)}`);
      } else if (!options.attach) {
        console.log(`Attach: tmux attach-session -t ${plan.tmuxSession}`);
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
