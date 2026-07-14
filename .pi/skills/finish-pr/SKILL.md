---
name: finish-pr
description: "Finish a pull request end-to-end: validate local build/run health, ensure GitHub checks and review threads are clear, merge the PR, verify post-merge GitHub/Railway deployment health, and close or update related GitHub and Linear issues. Use when the user says a PR is ready to finish, ship, merge, or close out."
---

# Finish PR

Use this workflow when a pull request is ready to ship and the user wants the surrounding GitHub, Linear, and deployment state finished too.

## Goal

Safely finish a PR end-to-end: identify the PR/issues, verify local build/test health, ensure GitHub checks/reviews are green, merge only after explicit confirmation, verify post-merge CI and Railway deployment health, update/close related issues, clean finished worktrees, and summarize what shipped.

## Safety rules

- Do not merge without explicit user confirmation in the current session.
- Do not deploy, restart, rollback, or mutate Railway resources unless the user explicitly asked for that action. Verification is okay; mutation needs confirmation.
- Do not close Linear or GitHub issues until the PR is merged and post-merge deployment checks pass, unless the user explicitly asks to close them earlier.
- Never claim deployment success from a queued/in-progress status. Wait for a terminal success state or report that it is still pending.
- If Railway MCP tools are unavailable, stop and tell the user to configure/connect Railway MCP instead of pretending to verify deployment.
- If checks fail, keep issues open and report the blocker.
- Do not remove a git worktree without confirming the PR is merged, the working tree is clean (no uncommitted/unpushed work), and the user has not asked to keep it. When in doubt, ask before removing.

## Supporting rpiv skills

Use other rpiv skills when they fit: `receiving-code-review` for unresolved review threads, `validate` for rpiv-plan success criteria, `code-review` for risky/multi-round diffs, `changelog` for release notes, `commit` for finishing commits, and `release-prod-safety` for dev→main releases. Do not invoke heavyweight skills for trivial PRs with already-green checks and no open review threads.

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
gh pr view PR_NUMBER --json number,title,body,url,state,isDraft,headRefName,headRefOid,headRepository,headRepositoryOwner,baseRefName,mergeStateStatus,reviewDecision,commits,files,closingIssuesReferences,latestReviews,statusCheckRollup
```

Stop if the PR is closed, merged, draft, or targeting the wrong base branch unless the user explicitly confirms how to proceed. Record the actual `headRefName`/`headRefOid`; do not assume the local worktree branch name is the PR head. Review worktrees often use names like `review/pr-123`, while the PR may track `feat/something`.

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

Push any local commits before checking remote PR state. Push to the actual PR head branch from `gh pr view`, not merely the current local branch, then verify the PR head SHA moved:

```bash
PR_HEAD=$(gh pr view PR_NUMBER --json headRefName --jq .headRefName)
git push origin HEAD:$PR_HEAD
gh pr view PR_NUMBER --json headRefOid --jq .headRefOid
```

If a previous push went to a review/helper branch instead, push the same commit to `headRefName` before trusting CI; clean up the accidental helper branch during final worktree cleanup if it is no longer needed.

### 4. Run local build/run verification

Use project guidance first. For this repository, prefer targeted commands:

```bash
cd packages/protocol && bun run build
cd services/api && bun run build
cd apps/web && bun run build
```

Run targeted tests relevant to the diff. Avoid full slow suites unless the PR is broad or the user asks.

If the user explicitly wants a local run/smoke test, start only the necessary service(s), capture logs, hit a lightweight health/page/API check, and then shut the process down. Do not leave dev servers running.

### 4b. Verify semantic version bumps (mandatory repo convention)

Every substantive PR bumps the `version` field of **each package it touches, in the PR itself** (not after merge). This repo uses semantic versioning per package:

- `packages/protocol/package.json`
- `services/api/package.json`
- `apps/web/package.json`

Rules (per touched package):

- `feat` → **minor** bump
- `fix` → **patch** bump
- breaking change (`feat!` / `refactor!`) → **major** bump (pre-1.0 packages: minor)
- pure `docs`/`chore`/`test`-only diffs → bump optional; skip unless the user asks
- refactors that change exported symbols/file layout without behavior change → treat as minor for `packages/protocol` (it is a published contract), patch otherwise

Check which packages the PR touches and whether each got a bump:

```bash
git diff origin/BASE...HEAD --stat -- packages/protocol services/api apps/web | tail -5
git diff origin/BASE...HEAD -- packages/protocol/package.json services/api/package.json apps/web/package.json | grep '"version"'
```

If a bump is missing, add it as a `chore: bump <pkg> to X.Y.Z (…)` commit on the PR branch before merging. After bumping, run `bun install` and commit any root `bun.lock` change — a stale root lockfile fails the prod build under `--frozen-lockfile` (see `release-prod-safety`). Precedents: PR #1087 (feat, protocol 4.4.1→4.5.0), #1082 (fix, 4.4.0→4.4.1), #1081 (feat touching all three packages — all bumped).

### 5. Check GitHub readiness before merge

Check PR status and reviews:

```bash
gh pr checks PR_NUMBER --watch
gh pr view PR_NUMBER --json mergeStateStatus,reviewDecision,statusCheckRollup,isDraft
```

Check unresolved review threads. Use the `receiving-code-review` skill if unresolved Copilot or human review feedback remains.

Do not merge if required checks are failing/pending, required reviews are missing, the PR is draft, unresolved blocking review conversations remain, or local verification failed.

### 6. Confirm and merge

Before merging, summarize:

- PR title and URL,
- base branch,
- local verification results,
- GitHub checks/review state,
- related GitHub/Linear issues that will be updated after merge.

Ask the user for explicit confirmation to merge.

After confirmation, merge using the repository's preferred strategy. If unknown, inspect repo conventions or ask. In multi-worktree repos where the base branch is checked out in the canonical root, run the merge from that canonical root (not from the feature worktree): `gh pr merge --delete-branch` may complete the server-side merge but fail local branch cleanup if it tries to check out a base branch already used by another worktree.

Common command:

```bash
gh pr merge PR_NUMBER --squash --delete-branch
```

If the PR should use merge commit or rebase instead, use the user/repo preference.

### 7. Verify post-merge GitHub checks

After merge, identify the merge/base branch commit:

```bash
gh pr view PR_NUMBER --json state,mergedAt,mergeCommit,url
```

#### Release PR ancestry reconciliation

For `dev` → `main` release PRs that are squash-merged, reconcile `main` back into `dev` after the main-branch checks pass. Otherwise `main` contains only the release squash commit while `dev` still contains the individual commits, and the next release PR can re-include already-shipped changes with merge conflicts. Follow `../_shared/squash-release-reconciliation.md`: verify matching trees + clean merge simulation, create the no-content merge, push `dev`, then wait for the normal `dev` workflows triggered by that push.

Check workflow runs for the target branch/commit:

```bash
gh run list --branch BASE_BRANCH --limit 10
```

If needed, watch the relevant run:

```bash
gh run watch RUN_ID
```

Do not proceed to issue closure until required post-merge checks have passed or the user explicitly accepts a pending state.

### 8. Verify post-merge deployment, finish issues, and clean up worktrees

Follow `references/post-merge-operations.md` for the detailed Railway MCP verification, GitHub/Linear issue closure, and mandatory worktree cleanup procedure. Key invariants:

- Verify Railway with MCP only; do not mutate Railway resources without explicit user approval.
- Wait for terminal deployment success before closing issues or claiming the deploy is healthy.
- For squash-merged PRs, the local branch may not appear in `git branch --merged`; use the PR merged state and merge commit as the source of truth.
- Before removing a finished worktree, restore any external local pointers that target it (for example `~/.hermes/plugins/index-network` symlinked to a PR worktree).
- Remove the finished PR worktree and any other finished worktrees, then prune and report what was removed.

### 12. Final summary

Report PR number/URL, merge strategy/commit, local verification, post-merge GitHub checks, Railway project/environment/service/deployment status, GitHub/Linear issue updates, worktrees removed/kept, and any remaining blockers or manual follow-up.
