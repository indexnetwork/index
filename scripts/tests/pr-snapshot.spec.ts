import { describe, expect, it } from "bun:test";

import {
  collectReviewThreads,
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
