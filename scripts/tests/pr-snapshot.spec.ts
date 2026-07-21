import { describe, expect, it } from "bun:test";

import {
  collectPullRequestCommits,
  collectPullRequestFiles,
  collectReviewThreads,
  createSnapshot,
  normalizeGitHubRepository,
  normalizePullRequest,
  parseSnapshotArgs,
} from "../pr-snapshot";

describe("PR snapshot normalization", () => {
  it("normalizes and stably sorts factual PR data and both check variants", () => {
    const raw = {
      number: 42,
      title: "Foundation",
      body: null,
      url: "https://github.com/indexnetwork/index/pull/42",
      author: { login: "author" },
      isDraft: false,
      state: "OPEN",
      baseRefName: "dev",
      baseRefOid: "base",
      headRefName: "chore/foundation",
      headRefOid: "head",
      mergeStateStatus: "CLEAN",
      reviewDecision: null,
      mergedAt: null,
      mergeCommit: null,
      closingIssuesReferences: [
        { number: 9, title: "Nine", url: "issue/9", state: "OPEN" },
        { number: 2, title: "Two", url: "issue/2", state: "CLOSED" },
      ],
      commits: [
        { oid: "b", committedDate: "2026-01-02", messageHeadline: "B", authors: [] },
        { oid: "a", committedDate: "2026-01-01", messageHeadline: "A", authors: [] },
      ],
      files: [
        { path: "z.ts", additions: 1, deletions: 0 },
        { path: "a.ts", additions: 2, deletions: 1 },
      ],
      statusCheckRollup: [
        { __typename: "StatusContext", context: "deploy", state: "SUCCESS", targetUrl: null },
        {
          __typename: "CheckRun",
          name: "build",
          status: "COMPLETED",
          conclusion: "SUCCESS",
          detailsUrl: "checks/1",
          startedAt: null,
          completedAt: null,
          workflowName: "CI",
        },
      ],
      reviews: [
        { id: "R2", author: { login: "z" }, state: "APPROVED", submittedAt: "2026-01-02" },
        { id: "R1", author: { login: "a" }, state: "COMMENTED", submittedAt: "2026-01-01" },
      ],
    };

    const normalized = normalizePullRequest(raw, []);

    expect(normalized.closingIssues.map((issue) => issue.number)).toEqual([2, 9]);
    expect(normalized.commits.map((commit) => commit.oid)).toEqual(["a", "b"]);
    expect(normalized.files.map((file) => file.path)).toEqual(["a.ts", "z.ts"]);
    expect(normalized.checks).toEqual([
      {
        type: "check-run",
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "checks/1",
        startedAt: null,
        completedAt: null,
        workflowName: "CI",
      },
      {
        type: "status-context",
        name: "deploy",
        status: "SUCCESS",
        conclusion: null,
        detailsUrl: null,
        startedAt: null,
        completedAt: null,
        workflowName: null,
      },
    ]);
    expect(normalized.author).toEqual({ login: "author", name: null });
    expect(normalized.body).toBeNull();
    expect(normalized.reviewDecision).toBeNull();
  });

  it("emits facts only without collection time or judgment fields", () => {
    const normalized = normalizePullRequest({
      number: 1,
      isDraft: false,
      mergeCommit: null,
    }, []);
    const output = JSON.stringify({ schemaVersion: 1, pullRequest: normalized });

    for (const forbidden of ["readiness", "severity", "recommendation", "collectedAt", "generatedAt"]) {
      expect(output).not.toContain(`\"${forbidden}\"`);
    }
    expect(normalized.base).toEqual({ ref: null, oid: null });
    expect(normalized.head).toEqual({ ref: null, oid: null });
  });
});

describe("PR file and commit pagination", () => {
  it("collects and normalizes more than 100 files and commits across pages", () => {
    const calls: Array<{ kind: "files" | "commits"; cursor: string | number | undefined }> = [];
    const execute = (query: string, variables: Record<string, string | number>): unknown => {
      const kind = query.includes("PullFilesPage") ? "files" : "commits";
      calls.push({ kind, cursor: variables.cursor });
      const secondPage = variables.cursor !== undefined;
      const indexes = secondPage ? [100, 101] : Array.from({ length: 100 }, (_, index) => index);
      if (kind === "files") {
        return {
          data: {
            repository: {
              pullRequest: {
                files: {
                  pageInfo: secondPage
                    ? { hasNextPage: false, endCursor: null }
                    : { hasNextPage: true, endCursor: "FILES-2" },
                  nodes: indexes.map((index) => ({
                    path: `file-${String(index).padStart(3, "0")}.ts`, additions: index, deletions: 0,
                  })),
                },
              },
            },
          },
        };
      }
      return {
        data: {
          repository: {
            pullRequest: {
              commits: {
                pageInfo: secondPage
                  ? { hasNextPage: false, endCursor: null }
                  : { hasNextPage: true, endCursor: "COMMITS-2" },
                nodes: indexes.map((index) => ({
                  commit: {
                    oid: `oid-${String(index).padStart(3, "0")}`,
                    messageHeadline: `Commit ${index}`,
                    messageBody: "",
                    authoredDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
                    committedDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
                    authors: {
                      nodes: [{ name: `Author ${index}`, email: `${index}@example.com`, user: { login: `user-${index}` } }],
                    },
                  },
                })),
              },
            },
          },
        },
      };
    };

    const files = collectPullRequestFiles(execute, "indexnetwork", "index", 42);
    const commits = collectPullRequestCommits(execute, "indexnetwork", "index", 42);
    const normalized = normalizePullRequest({ number: 42, mergeCommit: null, files, commits }, []);

    expect(normalized.files).toHaveLength(102);
    expect(normalized.files[101].path).toBe("file-101.ts");
    expect(normalized.commits).toHaveLength(102);
    expect(normalized.commits.some((commit) => commit.oid === "oid-101")).toBe(true);
    expect(normalized.commits.find((commit) => commit.oid === "oid-101")?.authors).toEqual([{
      login: "user-101", name: "Author 101", email: "101@example.com",
    }]);
    expect(calls).toEqual([
      { kind: "files", cursor: undefined },
      { kind: "files", cursor: "FILES-2" },
      { kind: "commits", cursor: undefined },
      { kind: "commits", cursor: "COMMITS-2" },
    ]);
  });
});

describe("review thread pagination", () => {
  it("fully paginates thread pages and each thread's comment pages", () => {
    const calls: Array<{ query: string; variables: Record<string, string | number> }> = [];
    const execute = (query: string, variables: Record<string, string | number>): unknown => {
      calls.push({ query, variables });
      if (query.includes("ReviewThreadCommentsPage")) {
        return {
          data: {
            node: {
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: "C2", databaseId: 102, createdAt: "2026-01-02", author: { login: "human" } }],
              },
            },
          },
        };
      }
      if (variables.cursor === "THREADS-2") {
        return {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [{
                    id: "T1",
                    path: "a.ts",
                    line: 1,
                    isResolved: true,
                    isOutdated: false,
                    comments: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [{ id: "C3", databaseId: 103, createdAt: "2026-01-03" }],
                    },
                  }],
                },
              },
            },
          },
        };
      }
      return {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { hasNextPage: true, endCursor: "THREADS-2" },
                nodes: [{
                  id: "T2",
                  path: "z.ts",
                  line: 8,
                  isResolved: false,
                  isOutdated: false,
                  comments: {
                    pageInfo: { hasNextPage: true, endCursor: "COMMENTS-2" },
                    nodes: [{ id: "C1", databaseId: 101, createdAt: "2026-01-01" }],
                  },
                }],
              },
            },
          },
        },
      };
    };

    const threads = collectReviewThreads(execute, "indexnetwork", "index", 42);

    expect(threads.map((thread) => thread.id)).toEqual(["T1", "T2"]);
    expect((threads[1].comments as Array<{ id: string }>).map((comment) => comment.id)).toEqual(["C1", "C2"]);
    expect(calls).toHaveLength(3);
    expect(calls[0].variables).toEqual({ owner: "indexnetwork", repo: "index", number: 42 });
    expect(calls[1].variables).toEqual({ threadId: "T2", cursor: "COMMENTS-2" });
    expect(calls[2].variables.cursor).toBe("THREADS-2");
  });
});

describe("cross-repository local safety", () => {
  it("normalizes common GitHub HTTPS and SSH origin forms", () => {
    expect(normalizeGitHubRepository("https://github.com/indexnetwork/index.git")).toBe("indexnetwork/index");
    expect(normalizeGitHubRepository("git@github.com:indexnetwork/index.git")).toBe("indexnetwork/index");
    expect(normalizeGitHubRepository("ssh://git@github.com/indexnetwork/index.git")).toBe("indexnetwork/index");
    expect(normalizeGitHubRepository("https://gitlab.com/indexnetwork/index.git")).toBeNull();
  });

  it("keeps a foreign --repo snapshot remote-only and does not fetch or inspect local branches", () => {
    const calls: string[][] = [];
    const execute = (argv: string[]): { code: number; stdout: string; stderr: string } => {
      calls.push(argv);
      if (argv[0] === "gh" && argv[1] === "repo") {
        return { code: 0, stdout: JSON.stringify({
          nameWithOwner: "foreign/project",
          defaultBranchRef: { name: "main" },
        }), stderr: "" };
      }
      if (argv[0] === "gh" && argv[1] === "pr") {
        const fields = argv[argv.indexOf("--json") + 1];
        if (fields === "number") return { code: 0, stdout: JSON.stringify({ number: 7 }), stderr: "" };
        return { code: 0, stdout: JSON.stringify({
          number: 7,
          title: "Foreign PR",
          isDraft: false,
          state: "OPEN",
          baseRefName: "main",
          baseRefOid: "foreign-base",
          headRefName: "fix/foreign-change",
          headRefOid: "foreign-head",
          mergeCommit: null,
        }), stderr: "" };
      }
      if (argv[0] === "gh" && argv[1] === "api") {
        const query = argv.find((value) => value.startsWith("query=")) ?? "";
        const connection = query.includes("PullFilesPage")
          ? { files: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
          : query.includes("PullCommitsPage")
            ? { commits: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }
            : { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } };
        return { code: 0, stdout: JSON.stringify({
          data: { repository: { pullRequest: connection } },
        }), stderr: "" };
      }
      if (argv.join(" ") === "git remote get-url origin") {
        return { code: 0, stdout: "git@github.com:indexnetwork/index.git\n", stderr: "" };
      }
      throw new Error(`unexpected local command for foreign repository: ${argv.join(" ")}`);
    };

    const snapshot = createSnapshot({
      selector: "7", repo: "foreign/project", fetch: true, compact: false,
    }, execute);

    expect(snapshot.local).toEqual({
      worktree: null,
      ancestry: { mergeBaseOid: null, ahead: null, behind: null },
    });
    expect(calls.filter((argv) => argv[0] === "git")).toEqual([
      ["git", "remote", "get-url", "origin"],
    ]);
  });
});

describe("PR snapshot arguments", () => {
  it("accepts number, repository, no-fetch, and compact flags", () => {
    expect(parseSnapshotArgs(["42", "--repo", "indexnetwork/index", "--no-fetch", "--compact"])).toEqual({
      selector: "42",
      repo: "indexnetwork/index",
      fetch: false,
      compact: true,
    });
  });
});
