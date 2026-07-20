---
name: worktree-session-pipeline
description: >-
  Develop Index features and fixes through an isolated worktree implementation
  session/agent without adding unnecessary user-mediated handoffs: keep the canonical
  root on dev, verify the worktree before mutation, run targeted checks, then commit
  and open a PR. Use when Index work moves from investigation into implementation,
  when a PR needs fixes after review or finish-pr findings, or when working through
  Zed's worktree UI.
---

# Worktree session pipeline

Repository policy requires subagent-driven development with worktree isolation. The
canonical root stays on `dev` and is read-only for implementation; a worktree
implementation session/agent owns all code mutations. The fast path removes manual
session-switch and pre-commit-approval delays—not that isolation boundary.

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

## 3. Start or resume the worktree implementation session

The coordinating canonical-root session starts or resumes the isolated implementation
session/agent. Do not edit implementation files from the root. When tooling can launch
a worktree-isolated subagent directly, do that instead of making the user switch Zed,
start another Pi session, and paste a handoff prompt.

The implementation session verifies its own checkout before editing:

```bash
cd .worktrees/<type-short-desc>
pwd
git branch --show-current
git status --short --branch
```

It must confirm that `pwd` is the intended worktree and the branch is the feature
branch. Never edit through a canonical-root path.

Use a named handoff only when a user-operated/Zed worktree session already owns the
change or direct agent launch is unavailable. Give it the absolute path, branch, setup
state, relevant findings/constraints, and one copyable continuation prompt. The
receiving session continues in the existing worktree; it does not create another.

## 4. Implement and verify inside the worktree

The implementation session makes all mutations in the verified worktree. Run targeted
checks appropriate to the diff and report failures honestly. Keep the canonical checkout
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

## 6. Finish the PR from the canonical checkout

When ready to ship, return to the canonical/root checkout and invoke `finish-pr`. It
owns merge confirmation, GitHub/deployment verification, issue updates, and cleanup.
Do not remove the worktree merely because the PR is open.

## 7. Fix loop after finish-pr findings

When `finish-pr` finds code, rebase, or review fixes, start or resume the PR's isolated
implementation session/agent in its existing worktree. A user-mediated named handoff is
optional only when that worktree is already owned by another session.

The implementation session makes the focused change, resolves rebase conflicts
meaningfully, runs affected checks, commits, and pushes. Then return to `finish-pr` for
GitHub readiness and explicit merge confirmation. Re-run the full readiness pass after a
rebase, broad change, or uncertain impact; otherwise rerun the affected local checks
plus PR-head, required-check, and unresolved-thread status.

The worktree stays until the PR is merged; `finish-pr` owns post-merge cleanup.

## See also

- `git-worktree-workflow` — naming, setup internals, root guard, and worktree-local Git
  troubleshooting.
- `finish-pr` — PR readiness, merge approval, deployment verification, issue updates,
  and safe cleanup.
- `receiving-code-review` — address and resolve review conversations before merging.
