#!/usr/bin/env bun
import { existsSync, realpathSync } from "node:fs";

import { parseWorktreePorcelain } from "./worktree-session";

type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandExecutor = (argv: string[], cwd?: string) => CommandResult;
export type GraphqlExecutor = (query: string, variables: Record<string, string | number>) => unknown;

type SnapshotOptions = {
  selector: string;
  repo: string | null;
  fetch: boolean;
  compact: boolean;
};

class UsageError extends Error {}
class SnapshotError extends Error {}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function boolean(value: unknown): boolean {
  return value === true;
}

function author(value: unknown): { login: string | null; name: string | null } | null {
  if (value === null || value === undefined) return null;
  const data = record(value);
  return { login: string(data.login), name: string(data.name) };
}

function compareNullable(left: string | number | null, right: string | number | null): number {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

export function normalizeChecks(value: unknown): Array<Record<string, unknown>> {
  return array(value)
    .map((item) => {
      const check = record(item);
      const typeName = string(check.__typename);
      if (typeName === "CheckRun") {
        return {
          type: "check-run",
          name: string(check.name),
          status: string(check.status),
          conclusion: string(check.conclusion),
          detailsUrl: string(check.detailsUrl),
          startedAt: string(check.startedAt),
          completedAt: string(check.completedAt),
          workflowName: string(check.workflowName),
        };
      }
      if (typeName === "StatusContext") {
        return {
          type: "status-context",
          name: string(check.context),
          status: string(check.state),
          conclusion: null,
          detailsUrl: string(check.targetUrl),
          startedAt: null,
          completedAt: null,
          workflowName: null,
        };
      }
      return null;
    })
    .filter((item) => item !== null)
    .sort((left, right) =>
      compareNullable(left.type as string, right.type as string)
      || compareNullable(left.name as string | null, right.name as string | null)
      || compareNullable(left.detailsUrl as string | null, right.detailsUrl as string | null));
}

function normalizeComments(value: unknown): Array<Record<string, unknown>> {
  return array(value)
    .map((item) => {
      const comment = record(item);
      return {
        id: string(comment.id),
        databaseId: number(comment.databaseId),
        author: author(comment.author),
        body: string(comment.body),
        path: string(comment.path),
        line: number(comment.line),
        startLine: number(comment.startLine),
        url: string(comment.url),
        diffHunk: string(comment.diffHunk),
        createdAt: string(comment.createdAt),
      };
    })
    .sort((left, right) =>
      compareNullable(left.createdAt as string | null, right.createdAt as string | null)
      || compareNullable(left.id as string | null, right.id as string | null));
}

const FILES_QUERY = `
query PullFilesPage($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      files(first:100, after:$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { path additions deletions }
      }
    }
  }
}`;

const COMMITS_QUERY = `
query PullCommitsPage($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      commits(first:100, after:$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          commit {
            oid messageHeadline messageBody authoredDate committedDate
            authors(first:100) {
              nodes { name email user { login } }
            }
          }
        }
      }
    }
  }
}`;

const THREADS_QUERY = `
query ReviewThreadsPage($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100, after:$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line startLine
          comments(first:100) {
            pageInfo { hasNextPage endCursor }
            nodes { id databaseId author { login } body path line startLine url diffHunk createdAt }
          }
        }
      }
    }
  }
}`;

const COMMENTS_QUERY = `
query ReviewThreadCommentsPage($threadId:ID!, $cursor:String) {
  node(id:$threadId) {
    ... on PullRequestReviewThread {
      comments(first:100, after:$cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id databaseId author { login } body path line startLine url diffHunk createdAt }
      }
    }
  }
}`;

function collectPullConnection(
  execute: GraphqlExecutor,
  query: string,
  connectionName: "files" | "commits",
  owner: string,
  repo: string,
  pullNumber: number,
): unknown[] {
  const nodes: unknown[] = [];
  let cursor: string | null = null;

  do {
    const variables: Record<string, string | number> = { owner, repo, number: pullNumber };
    if (cursor) variables.cursor = cursor;
    const response = record(execute(query, variables));
    const pullRequest = record(record(record(response.data).repository).pullRequest);
    const connection = record(pullRequest[connectionName]);
    nodes.push(...array(connection.nodes));

    const pageInfo = record(connection.pageInfo);
    cursor = string(pageInfo.endCursor);
    if (boolean(pageInfo.hasNextPage) && !cursor) {
      throw new SnapshotError(`${connectionName} page has no cursor`);
    }
    if (!boolean(pageInfo.hasNextPage)) cursor = null;
  } while (cursor !== null);

  return nodes;
}

export function collectPullRequestFiles(
  execute: GraphqlExecutor,
  owner: string,
  repo: string,
  pullNumber: number,
): Array<Record<string, unknown>> {
  return collectPullConnection(execute, FILES_QUERY, "files", owner, repo, pullNumber)
    .map((value) => {
      const file = record(value);
      return { path: string(file.path), additions: number(file.additions), deletions: number(file.deletions) };
    });
}

export function collectPullRequestCommits(
  execute: GraphqlExecutor,
  owner: string,
  repo: string,
  pullNumber: number,
): Array<Record<string, unknown>> {
  return collectPullConnection(execute, COMMITS_QUERY, "commits", owner, repo, pullNumber)
    .map((value) => {
      const commit = record(record(value).commit);
      const authors = array(record(commit.authors).nodes).map((authorValue) => {
        const authorData = record(authorValue);
        return {
          login: string(record(authorData.user).login),
          name: string(authorData.name),
          email: string(authorData.email),
        };
      });
      return {
        oid: string(commit.oid),
        messageHeadline: string(commit.messageHeadline),
        messageBody: string(commit.messageBody),
        authoredDate: string(commit.authoredDate),
        committedDate: string(commit.committedDate),
        authors,
      };
    });
}

export function collectReviewThreads(
  execute: GraphqlExecutor,
  owner: string,
  repo: string,
  pullNumber: number,
): Array<Record<string, unknown>> {
  const threads: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;

  do {
    const variables: Record<string, string | number> = { owner, repo, number: pullNumber };
    if (cursor) variables.cursor = cursor;
    const response = record(execute(THREADS_QUERY, variables));
    const connection = record(record(record(response.data).repository).pullRequest);
    const reviewThreads = record(connection.reviewThreads);

    for (const value of array(reviewThreads.nodes)) {
      const thread = record(value);
      const commentConnection = record(thread.comments);
      const comments = [...array(commentConnection.nodes)];
      let commentPageInfo = record(commentConnection.pageInfo);
      let commentCursor = string(commentPageInfo.endCursor);

      while (boolean(commentPageInfo.hasNextPage)) {
        if (!commentCursor) throw new SnapshotError(`thread ${string(thread.id) ?? "unknown"} has no comment cursor`);
        const commentResponse = record(execute(COMMENTS_QUERY, {
          threadId: string(thread.id) ?? "",
          cursor: commentCursor,
        }));
        const nextConnection = record(record(record(commentResponse.data).node).comments);
        comments.push(...array(nextConnection.nodes));
        commentPageInfo = record(nextConnection.pageInfo);
        commentCursor = string(commentPageInfo.endCursor);
      }

      threads.push({
        id: string(thread.id),
        isResolved: boolean(thread.isResolved),
        isOutdated: boolean(thread.isOutdated),
        path: string(thread.path),
        line: number(thread.line),
        startLine: number(thread.startLine),
        comments: normalizeComments(comments),
      });
    }

    const pageInfo = record(reviewThreads.pageInfo);
    cursor = string(pageInfo.endCursor);
    if (boolean(pageInfo.hasNextPage) && !cursor) throw new SnapshotError("review thread page has no cursor");
    if (!boolean(pageInfo.hasNextPage)) cursor = null;
  } while (cursor !== null);

  return threads.sort((left, right) =>
    compareNullable(left.path as string | null, right.path as string | null)
    || (Number(left.line ?? 0) - Number(right.line ?? 0))
    || compareNullable(left.id as string | null, right.id as string | null));
}

export function normalizePullRequest(rawValue: unknown, reviewThreads: Array<Record<string, unknown>>) {
  const raw = record(rawValue);
  const mergeCommit = raw.mergeCommit === null || raw.mergeCommit === undefined
    ? null
    : record(raw.mergeCommit);

  const closingIssues = array(raw.closingIssuesReferences)
    .map((value) => {
      const issue = record(value);
      return {
        number: number(issue.number),
        title: string(issue.title),
        url: string(issue.url),
        state: string(issue.state),
      };
    })
    .sort((left, right) => Number(left.number ?? 0) - Number(right.number ?? 0));

  const commits = array(raw.commits)
    .map((value) => {
      const commit = record(value);
      const authors = array(commit.authors)
        .map((entry) => {
          const item = record(entry);
          return { login: string(item.login), name: string(item.name), email: string(item.email) };
        })
        .sort((left, right) => compareNullable(left.login, right.login) || compareNullable(left.email, right.email));
      return {
        oid: string(commit.oid),
        messageHeadline: string(commit.messageHeadline),
        messageBody: string(commit.messageBody),
        authoredDate: string(commit.authoredDate),
        committedDate: string(commit.committedDate),
        authors,
      };
    })
    .sort((left, right) => compareNullable(left.committedDate, right.committedDate) || compareNullable(left.oid, right.oid));

  const files = array(raw.files)
    .map((value) => {
      const file = record(value);
      return { path: string(file.path), additions: number(file.additions), deletions: number(file.deletions) };
    })
    .sort((left, right) => compareNullable(left.path, right.path));

  const reviews = array(raw.reviews)
    .map((value) => {
      const review = record(value);
      return {
        id: string(review.id),
        author: author(review.author),
        state: string(review.state),
        body: string(review.body),
        submittedAt: string(review.submittedAt),
        commitOid: string(record(review.commit).oid) ?? string(review.commitOid),
      };
    })
    .sort((left, right) =>
      compareNullable(left.submittedAt, right.submittedAt)
      || compareNullable(left.author?.login ?? null, right.author?.login ?? null)
      || compareNullable(left.id, right.id));

  return {
    number: number(raw.number),
    title: string(raw.title),
    body: string(raw.body),
    url: string(raw.url),
    author: author(raw.author),
    isDraft: boolean(raw.isDraft),
    state: string(raw.state),
    base: { ref: string(raw.baseRefName), oid: string(raw.baseRefOid) },
    head: { ref: string(raw.headRefName), oid: string(raw.headRefOid) },
    mergeStateStatus: string(raw.mergeStateStatus),
    reviewDecision: string(raw.reviewDecision),
    mergedAt: string(raw.mergedAt),
    mergeCommit: mergeCommit === null
      ? null
      : { oid: string(mergeCommit.oid), url: string(mergeCommit.url) },
    closingIssues,
    commits,
    files,
    checks: normalizeChecks(raw.statusCheckRollup),
    reviews,
    reviewThreads,
  };
}

function parseRepoFromUrl(selector: string): string | null {
  const match = selector.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+(?:\/.*)?$/);
  return match?.[1] ?? null;
}

export function normalizeGitHubRepository(remoteUrl: string): string | null {
  const value = remoteUrl.trim();
  let repositoryPath: string | null = null;

  const scpStyle = value.match(/^(?:[^@/]+@)?github\.com:([^/]+\/[^/]+)\/?$/i);
  if (scpStyle) {
    repositoryPath = scpStyle[1];
  } else {
    try {
      const url = new URL(value);
      if (url.hostname.toLowerCase() !== "github.com") return null;
      repositoryPath = url.pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      return null;
    }
  }

  const parts = repositoryPath.replace(/\.git$/i, "").split("/");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) return null;
  return `${parts[0]}/${parts[1]}`;
}

export function parseSnapshotArgs(rawArgs: string[]): SnapshotOptions {
  const args = rawArgs[0] === "--" ? rawArgs.slice(1) : [...rawArgs];
  const selector = args.shift();
  if (!selector || selector.startsWith("--")) throw new UsageError("missing PR number, URL, or branch");
  const options: SnapshotOptions = { selector, repo: null, fetch: true, compact: false };
  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--repo") {
      const value = args.shift();
      if (!value || !/^[^/\s]+\/[^/\s]+$/.test(value)) throw new UsageError("--repo requires owner/repo");
      options.repo = value;
    } else if (flag === "--no-fetch") {
      options.fetch = false;
    } else if (flag === "--compact") {
      options.compact = true;
    } else {
      throw new UsageError(`unknown argument: ${flag ?? ""}`);
    }
  }
  return options;
}

function systemExecutor(argv: string[], cwd = process.cwd()): CommandResult {
  const result = Bun.spawnSync(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function requiredJson(execute: CommandExecutor, argv: string[], label: string): unknown {
  const result = execute(argv);
  if (result.code !== 0) throw new SnapshotError(`${label}: ${result.stderr.trim() || result.stdout.trim()}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new SnapshotError(`${label}: command returned invalid JSON`);
  }
}

function graphqlExecutor(execute: CommandExecutor): GraphqlExecutor {
  return (query, variables) => {
    const argv = ["gh", "api", "graphql", "-f", `query=${query}`];
    for (const key of Object.keys(variables).sort()) {
      const value = variables[key];
      argv.push(typeof value === "number" ? "-F" : "-f", `${key}=${value}`);
    }
    return requiredJson(execute, argv, "cannot query GitHub GraphQL");
  };
}

function gitFact(execute: CommandExecutor, argv: string[], cwd: string): string | null {
  const result = execute(argv, cwd);
  return result.code === 0 ? result.stdout.trim() : null;
}

function localFacts(
  execute: CommandExecutor,
  headRef: string | null,
  baseOid: string | null,
  headOid: string | null,
): { worktree: Record<string, unknown> | null; ancestry: Record<string, unknown> } {
  const listing = execute(["git", "worktree", "list", "--porcelain"]);
  let matchingWorktree: Record<string, unknown> | null = null;
  if (listing.code === 0 && headRef) {
    const match = parseWorktreePorcelain(listing.stdout).find((entry) => entry.branch === headRef);
    if (match && existsSync(match.path)) {
      const path = realpathSync(match.path);
      matchingWorktree = {
        path,
        branch: match.branch,
        headOid: gitFact(execute, ["git", "rev-parse", "HEAD"], path),
        status: gitFact(execute, ["git", "status", "--short", "--branch"], path),
      };
    }
  }

  const mergeBaseOid = baseOid && headOid
    ? gitFact(execute, ["git", "merge-base", baseOid, headOid], process.cwd())
    : null;
  const aheadText = baseOid && headOid
    ? gitFact(execute, ["git", "rev-list", "--count", `${baseOid}..${headOid}`], process.cwd())
    : null;
  const behindText = baseOid && headOid
    ? gitFact(execute, ["git", "rev-list", "--count", `${headOid}..${baseOid}`], process.cwd())
    : null;

  return {
    worktree: matchingWorktree,
    ancestry: {
      mergeBaseOid,
      ahead: aheadText === null ? null : Number(aheadText),
      behind: behindText === null ? null : Number(behindText),
    },
  };
}

export function createSnapshot(options: SnapshotOptions, execute: CommandExecutor = systemExecutor) {
  const repoHint = options.repo ?? parseRepoFromUrl(options.selector);
  const currentRepo = repoHint
    ? null
    : record(requiredJson(execute, ["gh", "repo", "view", "--json", "nameWithOwner,defaultBranchRef"], "cannot resolve repository"));
  const repoName = repoHint ?? string(currentRepo?.nameWithOwner);
  if (!repoName) throw new SnapshotError("cannot resolve owner/repo");

  const repoRaw = record(requiredJson(
    execute,
    ["gh", "repo", "view", repoName, "--json", "nameWithOwner,defaultBranchRef"],
    "cannot inspect repository",
  ));
  const identity = record(requiredJson(
    execute,
    ["gh", "pr", "view", options.selector, "--repo", repoName, "--json", "number"],
    "cannot resolve pull request",
  ));
  const pullNumber = number(identity.number);
  if (pullNumber === null) throw new SnapshotError("pull request has no number");

  const fields = [
    "number", "title", "body", "url", "author", "isDraft", "state", "baseRefName", "baseRefOid",
    "headRefName", "headRefOid", "mergeStateStatus", "reviewDecision", "mergedAt", "mergeCommit",
    "closingIssuesReferences", "reviews", "statusCheckRollup",
  ].join(",");
  const pullRaw = record(requiredJson(
    execute,
    ["gh", "pr", "view", String(pullNumber), "--repo", repoName, "--json", fields],
    "cannot inspect pull request",
  ));
  const repoParts = repoName.split("/");
  const graphql = graphqlExecutor(execute);
  pullRaw.files = collectPullRequestFiles(graphql, repoParts[0], repoParts[1], pullNumber);
  pullRaw.commits = collectPullRequestCommits(graphql, repoParts[0], repoParts[1], pullNumber);
  const threads = collectReviewThreads(graphql, repoParts[0], repoParts[1], pullNumber);
  const pullRequest = normalizePullRequest(pullRaw, threads);

  const origin = execute(["git", "remote", "get-url", "origin"]);
  const originRepo = origin.code === 0 ? normalizeGitHubRepository(origin.stdout) : null;
  const localRepoMatches = originRepo !== null && originRepo.toLowerCase() === repoName.toLowerCase();

  if (options.fetch && localRepoMatches) {
    const baseRef = pullRequest.base.ref;
    const fetchArgs = ["git", "fetch", "origin"];
    if (typeof baseRef === "string") fetchArgs.push(baseRef);
    fetchArgs.push(`pull/${pullNumber}/head`);
    const fetched = execute(fetchArgs);
    if (fetched.code !== 0) console.error(`fetch warning: ${fetched.stderr.trim() || fetched.stdout.trim()}`);
  }

  const local = localRepoMatches
    ? localFacts(execute, pullRequest.head.ref, pullRequest.base.oid, pullRequest.head.oid)
    : {
        worktree: null,
        ancestry: { mergeBaseOid: null, ahead: null, behind: null },
      };
  return {
    schemaVersion: 1,
    repository: {
      nameWithOwner: string(repoRaw.nameWithOwner) ?? repoName,
      defaultBranch: string(record(repoRaw.defaultBranchRef).name),
    },
    pullRequest,
    local,
  };
}

function usage(): string {
  return "usage: bun run pr:snapshot -- <number|URL|branch> [--repo <owner/repo>] [--no-fetch] [--compact]";
}

export function main(argv = process.argv.slice(2)): void {
  try {
    const options = parseSnapshotArgs(argv);
    const snapshot = createSnapshot(options);
    console.log(options.compact ? JSON.stringify(snapshot) : JSON.stringify(snapshot, null, 2));
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
