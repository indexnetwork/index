---
name: finish-pr
description: "Finish a pull request end-to-end from the canonical/root session: investigate PR health, coordinate fixes in the existing visible Herdr-managed Pi or Codex worktree session, merge only after explicit confirmation, verify post-merge GitHub/Railway health, and close or update related issues. Use when the user says a PR is ready to finish, ship, merge, or close out."
---

# Finish PR

Use this workflow when a pull request is ready to ship and the user wants the surrounding GitHub, Linear, and deployment state finished too.

## Goal

Safely finish a PR end-to-end from the canonical/root session: identify the PR/issues, investigate PR health (base freshness, local build/test, checks, reviews, version bumps), make any needed fixes only in the verified PR worktree, merge only after explicit confirmation once no findings remain, verify post-merge CI and Railway deployment health, update/close related issues, clean the finished worktree, and summarize what shipped.

## Safety rules

- Do not merge without explicit user confirmation in the current session.
- Do not deploy, restart, rollback, or mutate Railway resources unless the user explicitly asked for that action. Verification is okay; mutation needs confirmation.
- Do not close Linear or GitHub issues until the PR is merged and post-merge deployment checks pass, unless the user explicitly asks to close them earlier.
- Never claim deployment success from a queued/in-progress status. Wait for a terminal success state or report that it is still pending.
- If Railway MCP tools are unavailable, report deployment as unverified; do not claim success or close related issues until it can be verified. GitHub merge safety does not depend on MCP availability.
- If checks fail, keep issues open and report the blocker.
- Never edit files or run mutating git commands (commit, rebase, push, force-push) from the canonical root. When a worktree change is needed, `index` first delegates through a dedicated canonical-root coordinator; that root sends one consolidated prompt to the existing visible Herdr-managed Pi or Codex session for the PR worktree. The root/child handoff is fire-and-return without `--wait`; while the bridge is removed, `index` explicitly ticks the dedicated root on a later natural turn. That child session verifies the worktree's absolute path and feature branch before mutation. GitHub-side actions (review-thread replies/resolutions, the merge itself, issue updates) and read-only verification (builds, tests, diffs against remote refs) are fine.
- Do not use hidden `Agent` subagents for implementation/fix rounds, and do not create a watcher process or watcher pane. Reuse the same Herdr workspace, pane, and agent.
- A PR-branch rebase is executed only from the verified PR worktree, and only ever on the PR's own feature branch — never a shared/long-lived head branch (`dev`, `main` — e.g. a release PR's head): that rewrites shared history and breaks other worktrees. Use `--force-with-lease`, never plain `--force`.
- Do not remove a git worktree until the PR is merged and every dirty/unpushed change has been inspected. A dirty tree may be force-removed only when each leftover is proven disposable or preserved elsewhere; keep it or ask when that cannot be established. Honor any user request to keep it.

## Supporting rpiv skills

Use other rpiv skills when they fit: `run-worktree-session` for the coordinator-managed visible Herdr handoff and fix loop, `manage-feature-flags` for env-flag flips across Railway/local surfaces, `validate` for rpiv-plan success criteria, `code-review` for risky/multi-round diffs, `changelog` for release notes, `commit` for finishing commits, and `verify-production-release` for dev→main releases. Do not invoke heavyweight skills for trivial PRs with already-green checks and no open review threads.

## Coordinating fixes in the visible Herdr session

When a fix or rebase is needed, reuse the PR's exact visible worktree session. Verify
its workspace, pane, cwd, branch, and recent output, then send one consolidated
fire-and-return prompt without `--wait`:

```bash
herdr agent get "$AGENT_NAME"
herdr agent read "$AGENT_NAME" --source recent-unwrapped --lines 200
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/fix-handoff.md)"
```

The orchestration bridge has been removed pending refactor. Reconcile only on a later
natural turn or explicit tick with one status/output pass; never poll, sleep, wait, or
create a watcher. If a structured prompt is active, answer it through the exact pane
instead of appending a new prompt. Independently verify every reported git/test/PR fact
before merging.

## Workflow

### 1. Identify and snapshot the PR

Use the deterministic factual snapshot as the first inspection. It accepts a PR number,
URL, or branch and returns repository/PR identity, checks, reviews, fully paginated
threads/comments, local matching worktree status, and ancestry facts:

```bash
bun run pr:snapshot -- <number|URL|branch> [--repo owner/repo]
```

Save or parse its JSON rather than repeating ad hoc `gh`/Git parsing. The helper makes
no readiness or severity judgment; this workflow still evaluates the facts. Use the
snapshot's actual head ref/OID and base ref/OID rather than assuming folder or branch
names. Local worktree folders are dashed while branches are slashed.

Stop if the snapshotted PR is closed, merged, draft, or targeting the wrong base unless
the user explicitly confirms how to proceed.

### 2. Identify related GitHub and Linear issues

Collect related issue references from:

- `pullRequest.closingIssuesReferences` from the step-1 snapshot,
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

Use the step-1 snapshot's matching-worktree status plus `headRefName`/`headRefOid` as
the source of truth. If a matching worktree exists, these read-only local commands may
add context without repeating GitHub queries:

```bash
git -C <matching-worktree> status --short --branch
git -C <matching-worktree> log --oneline --decorate -5
```

If you find uncommitted changes, unpushed commits, or a push that went to a helper/review branch instead of `headRefName`, treat them as findings and include them in the consolidated prompt for the existing worktree session (see "Coordinating fixes in the visible Herdr session"). An accidental helper branch can be cleaned up during final worktree cleanup if it is no longer needed.

### 3b. Check base freshness; hand off any rebase

The PR branch should be current with its base before merging, so CI validates the exact code that will ship. Detection is read-only and runs from the canonical root against remote refs — no worktree checkout or mutation needed. Use the PR's actual `headRefName`/`baseRefName` from step 1 (base is usually `dev` — do not hardcode):

```bash
git fetch origin
git rev-list --count origin/<head>..origin/<base>   # >0 means the PR is behind
```

Skip the rebase when:

- the head branch is shared/long-lived (`dev`, `main` — e.g. release PRs): never rewrite shared history; if it is behind, ask the user whether to merge the base into the head instead;
- the PR head is a fork the available worktree credentials cannot push to: note it and continue;
- the branch is not behind (count `0`): record "up-to-date" and move on — a gratuitous rebase just retriggers CI.

When the branch is behind, gauge conflict risk (files changed on both sides), then include the rebase in the consolidated prompt for the verified PR worktree session:

```bash
comm -12 \
  <(git diff --name-only origin/<base>...origin/<head> | sort) \
  <(git diff --name-only origin/<head>...origin/<base> | sort)
```

From that worktree: run `git rebase origin/<base>`, resolve conflicts meaningfully per the guidance below, `git push --force-with-lease origin HEAD:<head>` (never plain `--force`), and rerun targeted tests. Never blanket `git checkout --ours/--theirs` across files. For each conflict, read both sides and understand why each changed the region; if the intent of either side is unclear, stop and ask the user instead of guessing. Repo-specific guidance:

- `package.json` version collisions (very common here): take the base's version as the floor and re-apply the PR's semver bump on top — e.g. base went 4.4.1→4.5.0 and the PR also bumped to 4.5.0 → the PR becomes 4.6.0 (feat) or 4.5.1 (fix). Step 4b re-verifies the result.
- `bun.lock`: never hand-merge. Resolve `package.json` first, then regenerate with `bun install` and stage the result (a stale lockfile also fails prod builds under `--frozen-lockfile` — see `verify-production-release`).
- Drizzle migrations (`services/api/drizzle/`): keep both sides' migration files; renumber the PR's new migration(s) after the base's latest, and update the entry `idx`/`tag` in `drizzle/meta/_journal.json` to match. Afterwards `bun run db:generate` must report "No schema changes".
- Generated files (e.g. bundled SKILL.md files from `scripts/build-skills.ts`): take either side textually, then regenerate with the build command rather than hand-merging.

Operational notes for the session operating the verified worktree:

- A rebase replays commits one by one — expect conflicts in more than one commit; `git add` + `git rebase --continue` through them.
- Rebases re-sign every replayed commit; on `gpg: signing failed: Inappropriate ioctl for device`, follow the `create-worktree` skill (have the user cache their passphrase, or set worktree-local `git config --worktree commit.gpgsign false`), then retry.
- A textually clean rebase can still be semantically wrong (both sides touched different lines of the same logic) — re-run targeted builds/tests against the rebased tree before pushing, then re-run the full readiness pass.
- If the conflicts are unresolvable without product decisions, or the rebase goes sideways: `git rebase --abort`, restore the branch to its pre-rebase state, and present the conflict summary and options to the user.

### 4. Run local build/run verification

Builds and tests are verification, not source mutation. When a failure needs a change, include it in the consolidated prompt for the verified PR worktree session.

Use project guidance first and select checks from the changed surface: build `packages/protocol`, `services/api`, or `apps/web` only when that package or its dependent contract changed. Run targeted tests relevant to the diff. Avoid unrelated builds and full slow suites unless the PR is broad, rebased, or the user asks.

If the user explicitly wants a local run/smoke test, start only the necessary service(s), capture logs, hit a lightweight health/page/API check, and then shut the process down. Do not leave dev servers running.

### 4b. Verify semantic version bumps (mandatory repo convention)

Every substantive PR bumps the `version` field of **each package it touches, in the PR itself** (not after merge). This repo uses semantic versioning per package:

- `packages/protocol/package.json`
- `packages/cli/package.json` (published subtree — CLAUDE.md requires bumping it like protocol)
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
git diff origin/BASE...HEAD --stat -- packages/protocol packages/cli services/api apps/web | tail -5
git diff origin/BASE...HEAD -- packages/protocol/package.json packages/cli/package.json services/api/package.json apps/web/package.json | grep '"version"'
```

If a bump is missing, include it in the consolidated worktree prompt: add a `chore: bump <pkg> to X.Y.Z (…)` commit, then run `bun install` and commit any root `bun.lock` change — a stale root lockfile fails the prod build under `--frozen-lockfile` (see `verify-production-release`). Historical precedents (versions long since superseded — the pattern is what matters): PR #1087 (feat, protocol minor bump), #1082 (fix, patch bump), #1081 (feat touching all packages — all bumped).

### 4c. Check environment variable surfaces

If the PR adds, changes, or removes environment variables, surface them to the user before merging — never let a PR merge with a var that only exists on the author's machine. Detect:

```bash
git diff origin/<base>...origin/<head> --stat -- services/api/src/startup.env.ts .env.example
git diff origin/<base>...origin/<head> | grep -oE '^\+.*(process\.env|Bun\.env)\.[A-Z0-9_]+' | grep -oE '[A-Z0-9_]+$' | sort -u
```

If nothing changed, record "no env changes" and move on. Otherwise, for each affected variable:

1. **Explain it in plain English** — one or two sentences on what it does and its default/required-ness, derived from the `.env.example` comments and how the code uses it. Present this explanation to the user; do not assume they remember what their own flag does.
2. **Report its state on every surface:**
   - `startup.env.ts` registration and `.env.example` (committed — `tests/env-example-drift.spec.ts` keeps them in sync). Missing entries are committed-code gaps → add them only from the verified PR worktree.
   - Root `.env.development` and `.env.test` (gitignored local files — `.env.development` mirrors Railway dev). Read them and report set/unset.
   - Railway dev service variables: query live values via Railway MCP. Separately, when an authenticated Railway CLI is installed and linked to the intended project/environment, `bun scripts/audit-railway-env.ts` can diff that service against the schema. Do not present the CLI audit as an MCP call. For dev→main release PRs, check the production service too.
3. **Ask the user what to do**, per variable or as one batched question, with the plain-English explanations included: set/update a value in Railway, add it to `.env.development`/`.env.test`, or deliberately leave a flag off. Setting Railway variables is a mutation — it needs explicit user confirmation per the safety rules (use the `manage-feature-flags` skill for the mechanics: ship-dark→flip order, snake_case ids, auto-redeploy). Editing the gitignored root `.env.development`/`.env.test` is allowed from this session after confirmation — they are not worktree contents and not committed. Make committed-file fixes (`.env.example`, `startup.env.ts`) only from the verified PR worktree.

Record the user's decisions for the step-6 summary.

### 5. Check GitHub readiness before merge

Wait for checks when needed, then refresh the same factual snapshot before each
readiness decision and after every pushed fix/rebase:

```bash
gh pr checks PR_NUMBER --watch
bun run pr:snapshot -- PR_NUMBER [--repo owner/repo]
```

Evaluate the refreshed checks, review decision, local worktree status, ancestry, and
unresolved review threads. Inspect each human or automated-review thread on its merits:
reply with technical reasoning when no fix is needed, and include every required code
change in the consolidated worktree prompt before resolving the thread.

Do not merge if required checks are failing/pending, required reviews are missing, the PR is draft, unresolved blocking review conversations remain, or local verification failed.

### 6. Confirm and merge

Before merging, summarize:

- PR title and URL,
- base branch,
- base-freshness/fix-loop outcome (up-to-date, or rebased and fixed in the verified worktree — summarize what changed),
- local verification results,
- GitHub checks/review state,
- env variable decisions (what was set in Railway / `.env.development` / `.env.test`, what was deliberately left unset),
- related GitHub/Linear issues that will be updated after merge.

Do not ask for merge confirmation while any finding is outstanding — hand it to the existing visible Herdr session through one fire-and-return prompt, reconcile it once on a later natural turn or explicit tick, then re-verify proportionally. Ask the user for explicit confirmation to merge in the coordinator session.

After confirmation, merge using the repository's preferred strategy. If unknown, inspect repo conventions or ask. In multi-worktree repos where the base branch is checked out in the canonical root, run the merge from that canonical root (not from the feature worktree): `gh pr merge --delete-branch` may complete the server-side merge but fail local branch cleanup if it tries to check out a base branch already used by another worktree.

Common command:

```bash
gh pr merge PR_NUMBER --squash --delete-branch
```

**Expected exit-code-1 "failure" in this repo:** when the PR's feature branch is checked out in a `.worktrees/` worktree (the normal case here), `--delete-branch` deletes the remote branch and completes the server-side merge, but the local branch deletion fails with:

```
failed to delete local branch <branch>: ... cannot delete branch '<branch>' used by worktree at '.../.worktrees/<name>'
Command exited with code 1
```

This is **not a merge failure**. Do not retry the merge and do not treat the nonzero exit as a blocker. Immediately verify the actual merge state and use it as the source of truth:

```bash
gh pr view PR_NUMBER --json state,mergedAt,mergeCommit,url
```

If `state` is `MERGED`, proceed; the leftover local branch is removed later during step-8 worktree cleanup (`git worktree remove` + `git branch -d`). If you want to avoid the noisy exit entirely, merge without `--delete-branch` and delete the remote branch during cleanup instead: `git push origin --delete <branch>`.

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
- Remove the finished PR worktree, prune, and report it. Report other apparently finished worktrees for separate cleanup; do not turn this PR closeout into an unrelated sweep.

### 12. Final summary

Report PR number/URL, merge strategy/commit, local verification, post-merge GitHub checks, Railway project/environment/service/deployment status, GitHub/Linear issue updates, worktrees removed/kept, and any remaining blockers or manual follow-up.
