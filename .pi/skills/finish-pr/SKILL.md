---
name: finish-pr
description: "Finish a pull request end-to-end from the canonical/root session: investigate PR health (base freshness, checks, review threads, version bumps, local builds), hand off any needed worktree changes to the worktree session as a fix prompt — never mutating the worktree from this session — merge the PR after explicit confirmation, verify post-merge GitHub/Railway deployment health, and close or update related GitHub and Linear issues. Use when the user says a PR is ready to finish, ship, merge, or close out."
---

# Finish PR

Use this workflow when a pull request is ready to ship and the user wants the surrounding GitHub, Linear, and deployment state finished too.

## Goal

Safely finish a PR end-to-end from the canonical/root session: identify the PR/issues, investigate PR health (base freshness, local build/test, checks, reviews, version bumps), hand off any needed fixes to the worktree session as a fix prompt, merge only after explicit confirmation once no findings remain, verify post-merge CI and Railway deployment health, update/close related issues, clean finished worktrees, and summarize what shipped.

## Safety rules

- Do not merge without explicit user confirmation in the current session.
- Do not deploy, restart, rollback, or mutate Railway resources unless the user explicitly asked for that action. Verification is okay; mutation needs confirmation.
- Do not close Linear or GitHub issues until the PR is merged and post-merge deployment checks pass, unless the user explicitly asks to close them earlier.
- Never claim deployment success from a queued/in-progress status. Wait for a terminal success state or report that it is still pending.
- If Railway MCP tools are unavailable, stop and tell the user to configure/connect Railway MCP instead of pretending to verify deployment.
- If checks fail, keep issues open and report the blocker.
- Never edit files or run mutating git commands (commit, rebase, push, force-push) in a PR worktree from this session. This skill runs in the canonical/root session and is investigation-only toward worktree contents: every needed change — rebase, conflict resolution, check/review fixes, version bumps, unpushed commits — is handed to the worktree session as a fix prompt (see "Handing off fixes" below and the `worktree-session-pipeline` skill). GitHub-side actions (review-thread replies/resolutions, the merge itself, issue updates) and read-only verification (builds, tests, diffs against remote refs) are fine. Only exception: the user explicitly tells this session to make a fix itself.
- A PR-branch rebase is executed by the worktree session, and only ever on the PR's own feature branch — never a shared/long-lived head branch (`dev`, `main` — e.g. a release PR's head): that rewrites shared history and breaks other worktrees. Handoffs must require `--force-with-lease`, never plain `--force`.
- Do not remove a git worktree without confirming the PR is merged, the working tree is clean (no uncommitted/unpushed work), and the user has not asked to keep it. When in doubt, ask before removing.

## Supporting rpiv skills

Use other rpiv skills when they fit: `worktree-session-pipeline` for the two-session fix loop, `flag-rollout-consistency` for env-flag flips across Railway/local surfaces, `receiving-code-review` for unresolved review threads, `validate` for rpiv-plan success criteria, `code-review` for risky/multi-round diffs, `changelog` for release notes, `commit` for finishing commits, and `release-prod-safety` for dev→main releases. Do not invoke heavyweight skills for trivial PRs with already-green checks and no open review threads.

## Handing off fixes to the worktree session

This skill pairs with `worktree-session-pipeline`: finish-pr (main session) finds problems; the worktree session fixes them. Whenever any workflow step produces a finding that needs a worktree change, do not fix it here. Instead output one consolidated fix prompt the user can paste into the worktree Pi session, then stop touching that finding until the user returns.

A good fix prompt contains:

- a short stable handoff name;
- the absolute worktree path and branch;
- the concrete findings: failing check names + log excerpts, unresolved review-thread links, rebase behind-count and conflict-risk files, missing version bumps, unpushed commits;
- the requested actions, pointing at step 3b for rebase/conflict guidance and step 4b for version-bump rules;
- a closing instruction: fix, test, commit, push, then tell the user to return to the main session and re-invoke finish-pr — never merge from the worktree session.

While fixes are outstanding, continue only with work that is safe from the main session (GitHub-side review replies, issue notes). After the user returns from the worktree session, re-run the full readiness pass before asking for merge confirmation.

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

Stop if the PR is closed, merged, draft, or targeting the wrong base branch unless the user explicitly confirms how to proceed. Record the actual `headRefName`/`headRefOid`; do not assume the local worktree branch name is the PR head. Local worktree folders are dashed (`feat-something`) while branches are slashed (`feat/something`), and helper checkouts may lag the PR head.

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

### 3. Check working-tree and push state (read-only)

Check local state and the pushed head (all read-only):

```bash
git status --short --branch
git log --oneline --decorate -5
PR_HEAD=$(gh pr view PR_NUMBER --json headRefName --jq .headRefName)
gh pr view PR_NUMBER --json headRefOid --jq .headRefOid
```

This session does not commit or push into the worktree. If you find uncommitted changes, unpushed commits, or a push that went to a helper/review branch instead of `headRefName`, record them as findings and include them in the fix prompt for the worktree session (see "Handing off fixes"). Exception: the user explicitly asks this session to do it. An accidental helper branch can be cleaned up during final worktree cleanup if it is no longer needed.

### 3b. Check base freshness; hand off any rebase

The PR branch should be current with its base before merging, so CI validates the exact code that will ship. Detection is read-only and runs from the canonical root against remote refs — no worktree checkout or mutation needed. Use the PR's actual `headRefName`/`baseRefName` from step 1 (base is usually `dev` — do not hardcode):

```bash
git fetch origin
git rev-list --count origin/<head>..origin/<base>   # >0 means the PR is behind
```

Skip the rebase when:

- the head branch is shared/long-lived (`dev`, `main` — e.g. release PRs): never rewrite shared history; if it is behind, ask the user whether to merge the base into the head instead;
- the PR head is a fork the worktree session cannot push to: note it and continue;
- the branch is not behind (count `0`): record "up-to-date" and move on — a gratuitous rebase just retriggers CI.

When the branch is behind, gauge conflict risk (files changed on both sides), then hand the rebase to the worktree session via a fix prompt (see "Handing off fixes") — this session does not rebase:

```bash
comm -12 \
  <(git diff --name-only origin/<base>...origin/<head> | sort) \
  <(git diff --name-only origin/<head>...origin/<base> | sort)
```

The fix prompt tells the worktree session to: run `git rebase origin/<base>` from the worktree, resolve conflicts meaningfully per the guidance below, `git push --force-with-lease origin HEAD:<head>` (never plain `--force`), re-run targeted tests, and redirect the user back to this session to re-verify.

Conflict-resolution guidance to embed in the handoff — the worktree session executes it. Never blanket `git checkout --ours/--theirs` across files. For each conflict, read both sides and understand why each changed the region; if the intent of either side is unclear, stop and ask the user instead of guessing. Repo-specific guidance:

- `package.json` version collisions (very common here): take the base's version as the floor and re-apply the PR's semver bump on top — e.g. base went 4.4.1→4.5.0 and the PR also bumped to 4.5.0 → the PR becomes 4.6.0 (feat) or 4.5.1 (fix). Step 4b re-verifies the result.
- `bun.lock`: never hand-merge. Resolve `package.json` first, then regenerate with `bun install` and stage the result (a stale lockfile also fails prod builds under `--frozen-lockfile` — see `release-prod-safety`).
- Drizzle migrations (`services/api/drizzle/`): keep both sides' migration files; renumber the PR's new migration(s) after the base's latest, and update the entry `idx`/`tag` in `drizzle/meta/_journal.json` to match. Afterwards `bun run db:generate` must report "No schema changes".
- Generated files (e.g. bundled SKILL.md files from `scripts/build-skills.ts`): take either side textually, then regenerate with the build command rather than hand-merging.

Operational notes for the worktree session:

- A rebase replays commits one by one — expect conflicts in more than one commit; `git add` + `git rebase --continue` through them.
- Rebases re-sign every replayed commit; on `gpg: signing failed: Inappropriate ioctl for device`, follow the `git-worktree-workflow` skill (have the user cache their passphrase, or set worktree-local `git config --worktree commit.gpgsign false`), then retry.
- A textually clean rebase can still be semantically wrong (both sides touched different lines of the same logic) — re-run targeted builds/tests against the rebased tree before pushing. After the handoff returns, this session re-runs the step-4 verification.
- If the conflicts are unresolvable without product decisions, or the rebase goes sideways: `git rebase --abort`, restore the branch to its pre-rebase state, and send the user back to the main session with the conflict summary and options.

### 4. Run local build/run verification

Builds and tests are verification, not source mutation — running them from this session is fine. Fixing what they reveal is not: failures become findings in the fix prompt for the worktree session.

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

If a bump is missing, include it in the fix prompt: the worktree session adds a `chore: bump <pkg> to X.Y.Z (…)` commit on the PR branch, then runs `bun install` and commits any root `bun.lock` change — a stale root lockfile fails the prod build under `--frozen-lockfile` (see `release-prod-safety`). Precedents: PR #1087 (feat, protocol 4.4.1→4.5.0), #1082 (fix, 4.4.0→4.4.1), #1081 (feat touching all three packages — all bumped).

### 4c. Check environment variable surfaces

If the PR adds, changes, or removes environment variables, surface them to the user before merging — never let a PR merge with a var that only exists on the author's machine. Detect:

```bash
git diff origin/<base>...origin/<head> --stat -- services/api/src/startup.env.ts .env.example
git diff origin/<base>...origin/<head> | grep -oE '^\+.*(process\.env|Bun\.env)\.[A-Z0-9_]+' | grep -oE '[A-Z0-9_]+$' | sort -u
```

If nothing changed, record "no env changes" and move on. Otherwise, for each affected variable:

1. **Explain it in plain English** — one or two sentences on what it does and its default/required-ness, derived from the `.env.example` comments and how the code uses it. Present this explanation to the user; do not assume they remember what their own flag does.
2. **Report its state on every surface:**
   - `startup.env.ts` registration and `.env.example` (committed — `tests/env-example-drift.spec.ts` keeps them in sync). Missing entries are committed-code gaps → they go into the worktree fix prompt, this session does not add them.
   - Root `.env.development` and `.env.test` (gitignored local files — `.env.development` mirrors Railway dev). Read them and report set/unset.
   - Railway dev service variables (query via Railway MCP; `bun scripts/audit-railway-env.ts` diffs a Railway service against the schema). For dev→main release PRs, check the production service too.
3. **Ask the user what to do**, per variable or as one batched question, with the plain-English explanations included: set/update a value in Railway, add it to `.env.development`/`.env.test`, or deliberately leave a flag off. Setting Railway variables is a mutation — it needs explicit user confirmation per the safety rules (use the `flag-rollout-consistency` skill for the mechanics: ship-dark→flip order, snake_case ids, auto-redeploy). Editing the gitignored root `.env.development`/`.env.test` is allowed from this session after confirmation — they are not worktree contents and not committed. Committed-file gaps (`.env.example`, `startup.env.ts`) always route to the worktree fix prompt.

Record the user's decisions for the step-6 summary.

### 5. Check GitHub readiness before merge

Check PR status and reviews:

```bash
gh pr checks PR_NUMBER --watch
gh pr view PR_NUMBER --json mergeStateStatus,reviewDecision,statusCheckRollup,isDraft
```

Check unresolved review threads. Use the `receiving-code-review` skill if unresolved Copilot or human review feedback remains. Replying to threads with technical reasoning and resolving them is GitHub-side and allowed from this session; any thread that requires a code change goes into the fix prompt for the worktree session instead.

Do not merge if required checks are failing/pending, required reviews are missing, the PR is draft, unresolved blocking review conversations remain, or local verification failed.

### 6. Confirm and merge

Before merging, summarize:

- PR title and URL,
- base branch,
- base-freshness/fix-loop outcome (up-to-date, or rebased and fixed by the worktree session — summarize what changed),
- local verification results,
- GitHub checks/review state,
- env variable decisions (what was set in Railway / `.env.development` / `.env.test`, what was deliberately left unset),
- related GitHub/Linear issues that will be updated after merge.

Do not ask for merge confirmation while any finding is outstanding — hand it off first and re-verify when the user returns. Ask the user for explicit confirmation to merge.

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
