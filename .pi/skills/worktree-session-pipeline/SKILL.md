---
name: worktree-session-pipeline
description: >-
  Coordinate feature and fix development across two Pi sessions — a main session in
  the canonical root checkout and a worktree session in a git worktree — through
  explicit named-prompt handoffs: create and set up a worktree with a semantic branch
  name, hand implementation to a new worktree session, request acceptance before
  commit, open the PR, hand back to the main session for finish-pr, and run the fix
  loop where finish-pr findings return as prompts that the worktree session fixes
  before redirecting the user back. Use when Index work moves from investigation into
  implementation, when a PR needs fixes after review or finish-pr findings, or when
  working through Zed's worktree UI.
---

# Worktree session pipeline

Use explicit stop-and-handoff boundaries between two sessions: a main session in the
canonical root checkout and a worktree session in the worktree. Never start
implementation in the canonical root and never assume Zed or Pi has switched
directories automatically.

## 1. Investigate and plan without mutations

Inspect the canonical checkout and agree on scope. Before the first code or config
mutation, choose a branch and matching dashed worktree folder.

Branch names must be **semantic**: `<type>/<short-description>` with a conventional
type (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `perf`) and a description
that explains the change to a reader with zero context. The worktree folder is the
dashed mirror of the branch (`feat/negotiation-evidence-shadow` →
`feat-negotiation-evidence-shadow`).

Correct: `feat/negotiation-evidence-shadow`, `refactor/eval-artifact-contracts`,
`chore/dead-code-safe-deletes`, `chore/eval-verification-ci`.

Incorrect: `review/pr-1147-hardening` (PR number + vague noun — name what the change
*does*, e.g. `fix/opportunity-scope-hardening`) and `chore/ind-422` (opaque issue ID —
Linear identifiers are banned in branch names by repo convention). If the work started
as "review PR X" or "ticket Y", translate it: what does the diff actually change? Name
the branch for that.

## 2. Create and fully set up the worktree

From the canonical project root:

```bash
git worktree add -b <type>/<short-desc> .worktrees/<type-short-desc> dev
bun run worktree:setup <type-short-desc>
```

`worktree:setup` is mandatory. It installs dependencies, links the root `.env*` files,
and configures hooks. Do not treat `git worktree add` alone—or Zed creating a checkout
without setup—as implementation-ready.

## 3. Hand off to a new worktree Pi session and stop

The default Zed workflow is cross-session:

1. The current Pi session remains in the canonical/root checkout and ends after the
   handoff.
2. The user switches Zed to the new worktree.
3. From Zed's terminal in that worktree, the user launches a **new Pi session**.
4. The new session verifies its own cwd and continues implementation.

Do **not** ask the user to change the current Pi session's cwd, and do not wait for the
new session to report its cwd back to the old session. Only use same-session cwd
confirmation when the user explicitly says they intend to continue in the current Pi
session.

Provide:

- a short, stable **handoff name** the user can mention in the new session;
- branch name and absolute worktree path;
- confirmation that `bun run worktree:setup` completed;
- the current base commit or relevant PR/issue when useful;
- a concise implementation handoff: verified findings, agreed scope, key files,
  constraints, and verification plan;
- one copyable continuation prompt that tells the new session not to create another
  worktree and to verify `pwd` before editing.

Persist reusable workflow learnings through `learn-skill` only when they generalize
beyond this task. Do not create task-specific skills, references, or `.pi` handoff files;
the named prompt in chat is the handoff artifact.

Then stop. Do not edit implementation files in the old/root session.

## 4. Implement and verify inside the worktree

Make all mutations in the worktree. Follow the repository's targeted-test guidance and
report failures honestly. Keep the canonical checkout untouched.

## 5. Request acceptance before publishing

When implementation and automated verification are complete, do not commit yet. Give
the user an acceptance handoff containing:

1. A user story in the form: “As a …, I can …, so that …”.
2. A short manual test or acceptance scenario when the change has observable behavior.
3. Automated checks run and their outcomes.
4. A concise change summary and any known limitations.

Ask the user to approve the result or request revisions. If a meaningful user story or
manual test does not apply (for example, internal documentation-only maintenance), say
why and provide the closest concrete verification instead.

## 6. Commit, push, and open the PR after approval

Only after explicit approval:

- make required package/version/documentation updates;
- commit with a conventional commit message;
- push the branch;
- open a PR into `dev` with verification and acceptance notes.

Report the PR URL and leave the worktree intact. Opening the PR is not permission to
merge it.

## 7. Hand back to the canonical checkout

Tell the user to switch Zed back to the canonical/root checkout (the `dev` checkout in
this repository), exit the worktree Pi session, and invoke `finish-pr` from the canonical
checkout when ready to ship. The `finish-pr` workflow owns final checks, explicit merge
confirmation, post-merge verification, and safe worktree/branch cleanup.

Do not remove the worktree during this handoff and do not merge merely because the user
approved the implementation. If finish-pr later finds problems, it hands back a fix
prompt — see the fix loop below.

## 8. The fix loop after finish-pr findings

`finish-pr` runs in the main session and is investigation-only with respect to the
worktree: it never edits files or runs mutating git commands (commit, rebase, push)
there. When it finds problems — failing checks, unresolved review threads needing code
changes, a branch behind its base, missing version bumps, unpushed work — it hands the
user a fix prompt for the worktree session instead of fixing anything itself.

The loop:

1. Main session (finish-pr) investigates and produces a fix prompt: handoff name,
   absolute worktree path, branch, the concrete findings, and the requested fixes.
2. The user switches Zed to the worktree and pastes the prompt into the worktree Pi
   session (reopening it if needed).
3. The worktree session owns all decisions and mutations: it makes the fixes, rebases,
   resolves conflicts meaningfully, runs targeted tests, commits, and pushes.
4. The worktree session then redirects the user back to the main session to re-invoke
   finish-pr. It never merges from the worktree session.
5. Repeat until finish-pr reports no findings; only then does the main session ask for
   merge confirmation.

The worktree stays until the PR is merged; finish-pr owns post-merge cleanup.

## See also

- `git-worktree-workflow` — naming, setup internals, root guard, and worktree-local Git
  troubleshooting.
- `finish-pr` — PR readiness investigation, fix handoffs back to the worktree session,
  merge approval, deployment verification, issue updates, and safe cleanup after the
  user returns to the canonical checkout.
- `receiving-code-review` — address and resolve review conversations before merging.
