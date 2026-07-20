---
name: worktree-session-pipeline
description: >-
  Coordinate feature and fix development across a canonical-root session and a
  user-mediated Pi session in a git worktree, using explicit named handoffs without
  unnecessary approval or verification delays. Keep the root on dev, set up only what
  the change needs, run targeted checks, then commit and open a PR. Use when Index work
  moves from investigation into implementation, when a PR needs fixes after review or
  finish-pr findings, or when working through Zed's worktree UI.
---

# Worktree session pipeline

Repository policy requires worktree-isolated implementation. Use explicit
user-mediated handoffs between the canonical-root coordinator and the worktree Pi
session: the root investigates and finishes PRs; the worktree session owns all code
mutations. The fast path removes unnecessary gates around that boundary, not the
boundary itself.

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
Linear identifiers are banned in branch names by repo convention).

## 2. Create a worktree and choose the required setup

From the canonical project root:

```bash
git worktree add -b <type>/<short-desc> .worktrees/<type-short-desc> dev
```

Run the full setup before runtime- or dependency-dependent work (source changes that
need tests/builds, dev servers, generated outputs, or environment files):

```bash
bun run worktree:setup <type-short-desc>
```

It installs dependencies, links root `.env*` files, and configures hooks. For a
mechanical docs/skill/gitlink-only change that needs neither dependencies nor runtime
environment, skip the expensive install but configure hooks before committing:

```bash
git -C .worktrees/<type-short-desc> config core.hooksPath "$PWD/scripts/hooks"
```

Do not run runtime commands from a minimally configured worktree. See
`git-worktree-workflow` for setup details and the explicit gitlink-pointer exception.

## 3. Hand off to the worktree Pi session

The canonical-root session stops implementation work here. The user switches Zed to the
new worktree and starts or resumes its Pi session; that session verifies its own checkout
before editing:

```bash
cd .worktrees/<type-short-desc>
pwd
git branch --show-current
git status --short --branch
```

Provide one concise, copyable handoff prompt containing:

- a stable handoff name, branch, and absolute worktree path;
- setup state and current base commit/PR when useful;
- verified findings, agreed scope, key files, constraints, and targeted verification;
- an instruction not to create another worktree and to verify `pwd`/branch before
  editing.

Do not create task-specific `.pi` handoff files. The named prompt in chat is the
handoff artifact. Reuse the same worktree session for review or finish-pr fixes rather
than creating a new one each round.

## 4. Implement and verify inside the worktree

The worktree session makes all mutations in the verified worktree. Run targeted checks
appropriate to the diff and report failures honestly. Keep the canonical checkout
untouched.

For user-visible or risky behavior, include a concise manual acceptance scenario in the
PR description. Ask the user before proceeding only when a product decision, ambiguous
scope, destructive action, or external-infrastructure mutation needs their choice—not
as a routine pre-commit gate.

## 5. Commit, push, and open the PR

After targeted verification succeeds:

- make required package/version/documentation updates;
- commit with a conventional commit message;
- push the feature branch;
- open a PR into `dev` with verification notes and any relevant acceptance scenario.

For routine fixes, tests, refactors, docs, and mechanical changes, no separate approval
is needed before commit or PR creation. Opening a PR is never permission to merge it.

## 6. Hand back to the canonical checkout

Tell the user to switch Zed back to the canonical/root checkout and invoke `finish-pr`
when ready to ship. It owns merge confirmation, GitHub/deployment verification, issue
updates, and cleanup. Do not remove the worktree merely because the PR is open.

## 7. Fix loop after finish-pr findings

`finish-pr` investigates from the canonical-root session. When it finds code, rebase, or
review fixes, it produces **one consolidated fix prompt** for the same worktree session:
handoff name, absolute path, branch, concrete findings/log excerpts, requested changes,
and targeted checks.

The user returns to that worktree session; it makes the focused change, resolves rebase
conflicts meaningfully, runs affected checks, commits, and pushes. Then the user returns
to `finish-pr` for GitHub readiness and explicit merge confirmation. Re-run the full
readiness pass after a rebase, broad change, or uncertain impact; otherwise rerun the
affected local checks plus PR-head, required-check, and unresolved-thread status.

The worktree stays until the PR is merged; `finish-pr` owns post-merge cleanup.

## See also

- `git-worktree-workflow` — naming, setup internals, root guard, and worktree-local Git
  troubleshooting.
- `finish-pr` — PR readiness, merge approval, deployment verification, issue updates,
  and safe cleanup.
- `receiving-code-review` — address and resolve review conversations before merging.
