---
name: finish-pr
description: "Finish a pull request end-to-end: rebase the PR branch onto its target branch (usually dev) and resolve any conflicts meaningfully, validate local build/run health, ensure GitHub checks and review threads are clear, merge the PR, verify post-merge GitHub/Railway deployment health, and close or update related GitHub and Linear issues. Use when the user says a PR is ready to finish, ship, merge, or close out."
---

# Finish PR

Use this workflow when a pull request is ready to ship and the user wants the surrounding GitHub, Linear, and deployment state finished too.

## Goal

Safely finish a PR end-to-end: identify the PR/issues, rebase the PR branch onto its target branch (usually `dev`) and resolve any conflicts meaningfully, verify local build/test health, ensure GitHub checks/reviews are green, merge only after explicit confirmation, verify post-merge CI and Railway deployment health, update/close related issues, clean finished worktrees, and summarize what shipped.

## Safety rules

- Do not merge without explicit user confirmation in the current session.
- Do not deploy, restart, rollback, or mutate Railway resources unless the user explicitly asked for that action. Verification is okay; mutation needs confirmation.
- Do not close Linear or GitHub issues until the PR is merged and post-merge deployment checks pass, unless the user explicitly asks to close them earlier.
- Never claim deployment success from a queued/in-progress status. Wait for a terminal success state or report that it is still pending.
- If Railway MCP tools are unavailable, stop and tell the user to configure/connect Railway MCP instead of pretending to verify deployment.
- If checks fail, keep issues open and report the blocker.
- Only rebase the PR's own feature branch onto its base. Never rebase a shared/long-lived head branch (`dev`, `main` — e.g. a release PR's head): that rewrites shared history and breaks other worktrees. Always force-push a rebased branch with `--force-with-lease`, never plain `--force`.
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

### 3b. Rebase onto the target branch

Before merging, bring the PR branch current with its base so the merge is a fast-forward in content terms and CI validates the exact code that will ship. Use the PR's actual `baseRefName` from step 1 (usually `dev` — do not hardcode) and run the rebase from the worktree where the PR head branch is checked out.

Skip the rebase when:

- the head branch is shared/long-lived (`dev`, `main` — e.g. release PRs): never rewrite shared history; if it is behind, ask the user whether to merge the base into the head instead;
- the PR head is a fork you cannot push to: skip and tell the user;
- the branch is not behind: check `git rev-list --count HEAD..origin/<base>` after `git fetch origin`; if `0`, do nothing — a gratuitous rebase + force-push just retriggers CI.

Procedure:

```bash
git fetch origin
git rebase origin/<base>
```

If the rebase is clean, force-push with lease to the PR head branch and verify the head SHA moved (CI will restart; step 5 waits on it):

```bash
git push --force-with-lease origin HEAD:$PR_HEAD
gh pr view PR_NUMBER --json headRefOid --jq .headRefOid
```

If there are conflicts, resolve them meaningfully — never blanket `git checkout --ours/--theirs` across files. For each conflict, read both sides and understand why each changed the region; if you cannot explain both sides' intent, stop and ask the user instead of guessing. Repo-specific guidance:

- `package.json` version collisions (very common here): take the base's version as the floor and re-apply the PR's semver bump on top — e.g. base went 4.4.1→4.5.0 and the PR also bumped to 4.5.0 → the PR becomes 4.6.0 (feat) or 4.5.1 (fix). Step 4b re-verifies the result.
- `bun.lock`: never hand-merge. Resolve `package.json` first, then regenerate with `bun install` and stage the result (a stale lockfile also fails prod builds under `--frozen-lockfile` — see `release-prod-safety`).
- Drizzle migrations (`services/api/drizzle/`): keep both sides' migration files; renumber the PR's new migration(s) after the base's latest, and update the entry `idx`/`tag` in `drizzle/meta/_journal.json` to match. Afterwards `bun run db:generate` must report "No schema changes".
- Generated files (e.g. bundled SKILL.md files from `scripts/build-skills.ts`): take either side textually, then regenerate with the build command rather than hand-merging.

Operational notes:

- A rebase replays commits one by one — expect conflicts in more than one commit; `git add` + `git rebase --continue` through them.
- Rebases re-sign every replayed commit; on `gpg: signing failed: Inappropriate ioctl for device`, follow the `git-worktree-workflow` skill (have the user cache their passphrase, or set worktree-local `git config --worktree commit.gpgsign false`), then retry.
- A textually clean rebase can still be semantically wrong (both sides touched different lines of the same logic). After any rebase — clean or not — re-run the targeted builds/tests in step 4 against the rebased tree before merging.
- If the conflicts are unresolvable without product decisions, or the rebase goes sideways: `git rebase --abort`, restore the branch to its pre-rebase state, and report the conflict summary and options to the user.

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
- rebase outcome (skipped/up-to-date, clean rebase, or conflicts resolved and how),
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

For `dev` → `main` release PRs that are squash-merged, reconcile `main` back into `dev` after the main-branch checks pass. Otherwise `main` contains only the release squash commit while `dev` still contains the individual commits, and the next release PR can re-include already-shipped changes with merge conflicts. Follow `references/squash-release-reconciliation.md`: verify matching trees + clean merge simulation, create the no-content merge, push `dev`, then wait for the normal `dev` workflows triggered by that push.

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
