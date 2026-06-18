---
name: finish-pr
description: "Finish a pull request end-to-end: validate local build/run health, ensure GitHub checks and review threads are clear, merge the PR, verify post-merge GitHub/Railway deployment health, and close or update related GitHub and Linear issues. Use when the user says a PR is ready to finish, ship, merge, or close out."
---

# Finish PR

Use this workflow when a pull request is ready to ship and the user wants the surrounding GitHub, Linear, and deployment state finished too.

## Goal

Safely finish a PR end-to-end:

1. identify the PR and related issues,
2. verify the branch builds and runs locally,
3. ensure GitHub checks/reviews are green,
4. merge the PR only after explicit confirmation,
5. verify post-merge CI and Railway deployment health,
6. update or close related GitHub and Linear issues,
7. clean up the local worktree when nothing needs it anymore,
8. summarize exactly what shipped and what remains.

## Safety rules

- Do not merge without explicit user confirmation in the current session.
- Do not deploy, restart, rollback, or mutate Railway resources unless the user explicitly asked for that action. Verification is okay; mutation needs confirmation.
- Do not close Linear or GitHub issues until the PR is merged and post-merge deployment checks pass, unless the user explicitly asks to close them earlier.
- Never claim deployment success from a queued/in-progress status. Wait for a terminal success state or report that it is still pending.
- If Railway MCP tools are unavailable, stop and tell the user to configure/connect Railway MCP instead of pretending to verify deployment.
- If checks fail, keep issues open and report the blocker.
- Do not remove a git worktree without confirming the PR is merged, the working tree is clean (no uncommitted/unpushed work), and the user has not asked to keep it. When in doubt, ask before removing.

## Supporting rpiv skills

Use other rpiv skills when they fit the situation:

- `receiving-code-review`: use before finishing if unresolved Copilot or human review conversations remain.
- `validate`: use when the PR implements an rpiv plan and you need to verify plan success criteria before merge.
- `code-review`: use for an independent final review when the diff is large, risky, or has had multiple review rounds.
- `changelog`: use if the PR changes a released package or the user wants release notes updated before merge.
- `commit`: use if local finishing changes are needed and should be committed before push.

Do not invoke heavyweight skills for trivial PRs with already-green checks and no open review threads.

## Workflow

### 1. Identify the PR

If the user provides a PR number, use it. Otherwise infer from the current branch:

```bash
gh pr view --json number,title,headRefName,baseRefName,url,state,mergeStateStatus,reviewDecision,isDraft,author
```

Identify owner and repo:

```bash
gh repo view --json owner,name,url
```

Fetch fuller PR metadata:

```bash
gh pr view PR_NUMBER --json number,title,body,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,commits,files,closingIssuesReferences,latestReviews,statusCheckRollup
```

Stop if the PR is closed, merged, draft, or targeting the wrong base branch unless the user explicitly confirms how to proceed.

### 2. Identify related GitHub and Linear issues

Collect related issue references from:

- `closingIssuesReferences` from `gh pr view`,
- PR title/body,
- branch name,
- commit messages,
- Linear links or identifiers in the PR body/comments, e.g. `ABC-123`.

For GitHub issues, inspect each related issue:

```bash
gh issue view ISSUE_NUMBER --json number,title,state,url,labels,assignees
```

For Linear issues, use available Linear tools when present:

- `linear_indexnetwork_get_issue` for exact identifiers like `ABC-123`,
- `linear_indexnetwork_list_comments` to inspect issue discussion when needed,
- `linear_indexnetwork_save_comment` to add shipped/deployment notes,
- `linear_indexnetwork_save_issue` to move the issue to the appropriate done state.

If no related issues are discoverable, continue but mention that no linked GitHub/Linear issues were found.

### 3. Ensure the working tree is clean and pushed

Check local state:

```bash
git status --short --branch
git log --oneline --decorate -5
```

If there are uncommitted changes:

- inspect them,
- decide whether they are part of finishing the PR,
- commit them with the `commit` skill or ask the user what to do.

Push any local commits before checking remote PR state:

```bash
git push
```

### 4. Run local build/run verification

Use project guidance first. For this repository, prefer targeted commands:

```bash
cd packages/protocol && bun run build
cd backend && bun run build
cd frontend && bun run build
```

Run targeted tests relevant to the diff. Avoid full slow suites unless the PR is broad or the user asks.

If the user explicitly wants a local run/smoke test, start only the necessary service(s), capture logs, hit a lightweight health/page/API check, and then shut the process down. Do not leave dev servers running.

### 5. Check GitHub readiness before merge

Check PR status and reviews:

```bash
gh pr checks PR_NUMBER --watch
gh pr view PR_NUMBER --json mergeStateStatus,reviewDecision,statusCheckRollup,isDraft
```

Check unresolved review threads. Use the `receiving-code-review` skill if unresolved Copilot or human review feedback remains.

Do not merge if:

- required checks are failing or pending,
- required reviews are missing,
- the PR is draft,
- unresolved blocking review conversations remain,
- local verification failed.

### 6. Confirm and merge

Before merging, summarize:

- PR title and URL,
- base branch,
- local verification results,
- GitHub checks/review state,
- related GitHub/Linear issues that will be updated after merge.

Ask the user for explicit confirmation to merge.

After confirmation, merge using the repository's preferred strategy. If unknown, inspect repo conventions or ask. Common command:

```bash
gh pr merge PR_NUMBER --squash --delete-branch
```

If the PR should use merge commit or rebase instead, use the user/repo preference.

### 7. Verify post-merge GitHub checks

After merge, identify the merge/base branch commit:

```bash
gh pr view PR_NUMBER --json state,mergedAt,mergeCommit,url
```

Check workflow runs for the target branch/commit:

```bash
gh run list --branch BASE_BRANCH --limit 10
```

If needed, watch the relevant run:

```bash
gh run watch RUN_ID
```

Do not proceed to issue closure until required post-merge checks have passed or the user explicitly accepts a pending state.

### 8. Verify Railway deployment with MCP

Use Railway MCP tools if available. First discover/connect them instead of guessing tool names:

```text
mcp({ search: "railway deployment project service environment logs status" })
mcp({ server: "railway" })
```

Then use the available Railway MCP tool(s) to verify:

- target project,
- target environment,
- target service(s),
- deployment triggered by the merged branch/commit,
- build status,
- deploy status,
- recent logs for startup/runtime errors,
- app health URL or smoke endpoint if available.

If a Railway deployment is still building/deploying, wait only as long as is reasonable, then report it as pending with the deployment URL/status. Do not claim success.

If Railway MCP is not configured or does not expose enough tools to verify status/logs, stop and report that deployment verification could not be completed.

### 9. Finish related GitHub issues

For GitHub issues auto-closed by PR keywords, verify state:

```bash
gh issue view ISSUE_NUMBER --json number,title,state,url
```

If an issue is not auto-closed but should be closed, confirm the PR merge and deployment succeeded, then close with a comment:

```bash
gh issue comment ISSUE_NUMBER --body "Shipped in PR PR_URL and verified after deployment: SUMMARY."
gh issue close ISSUE_NUMBER --reason completed
```

If deployment is pending or failed, leave the issue open and comment with the blocker/status only if useful.

### 10. Finish related Linear issues

For each related Linear issue:

1. Add a comment with PR URL, merge commit, verification commands, and Railway deployment status.
2. Move the issue to the appropriate done/completed status only after merge and deployment verification succeed.

Use Linear tools rather than guessing API calls:

- `linear_indexnetwork_get_issue` to inspect current issue state,
- `linear_indexnetwork_list_issue_statuses` if you need the team's done-state name,
- `linear_indexnetwork_save_comment` to add the shipment note,
- `linear_indexnetwork_save_issue` to update state.

If the correct done status is ambiguous, ask the user rather than guessing.

### 11. Clean up the worktree

This repo does implementation work in `.worktrees/<name>` worktrees. Once a PR is merged, its worktree is usually disposable. Remove it unless there is a reason to keep it.

First inspect worktrees and the current location:

```bash
git worktree list
pwd
```

Keep the worktree (do NOT remove) if any of these hold:

- the PR is not yet merged,
- the worktree has uncommitted changes or unpushed commits (`git -C PATH status --short --branch`),
- the user asked to keep it, or it hosts other in-flight work for a different branch,
- it is the canonical root worktree (`/Users/yanek/Projects/index`) — never remove the canonical root.

If the worktree is safe to remove:

1. Make sure you are not standing inside it — you cannot remove the worktree you are currently in. `cd` to the canonical root first:

   ```bash
   cd /Users/yanek/Projects/index
   ```

2. Confirm the branch is merged and the tree is clean, then remove it:

   ```bash
   git worktree remove .worktrees/WORKTREE_NAME
   ```

   If git refuses because of leftover state and you are certain it is disposable, confirm with the user before using `--force`.

3. Prune stale administrative entries:

   ```bash
   git worktree prune
   ```

If `gh pr merge --delete-branch` was used, the branch is already gone remotely; removing the worktree only cleans up local state. If you are unsure whether the worktree is still needed, ask the user instead of removing it.

### 12. Final summary

Report:

- PR number and URL,
- merge strategy and merge commit,
- local verification commands and results,
- GitHub post-merge checks and results,
- Railway project/environment/service/deployment status,
- GitHub issues closed or left open,
- Linear issues updated or left open,
- whether the worktree was removed or kept (and why),
- any remaining blockers or manual follow-up.
