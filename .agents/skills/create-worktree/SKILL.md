---
name: create-worktree
description: >-
  Create or reuse an isolated Index Git worktree for implementation. Use before
  implementation from the canonical root or when validating a branch/worktree
  identity.
---

# Create an isolated worktree

Keep the canonical root on `dev` and read-only for source changes. This workflow is
for implementation in an isolated Git worktree.

## Branch and folder policy

Branches must match:

```text
^(feat|fix|chore|refactor|docs|test|perf)/[a-z0-9]+(?:-[a-z0-9]+)*$
```

The description must explain the change; issue-only names are rejected. The only
valid folder is the branch with `/` replaced by `-`.

```bash
ROOT=$(git rev-parse --show-toplevel)
BRANCH=feat/negotiation-evidence-shadow
FOLDER=${BRANCH/\//-}
WORKTREE="$ROOT/.worktrees/$FOLDER"
```

Before creating anything:

```bash
pwd
git branch --show-current
git status --short --branch
git worktree list --porcelain
```

The canonical root must be `ROOT` on `dev`. Reuse an existing worktree only when its
registered path and branch match exactly. Reject path/branch collisions instead of
mutating them.

When no matching worktree exists, create it from `origin/dev`:

```bash
git fetch origin dev
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WORKTREE" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WORKTREE" origin/dev
fi
```

Run setup for new and reused worktrees:

```bash
bun run worktree:setup "$FOLDER"
```

Setup is mandatory: it installs dependencies and links root environment files.

## Choose the execution environment

After the checkout is verified, the caller chooses its normal execution environment.
Do not start a second writer in an existing worktree.

## Verify before mutation

The first handoff requires:

```bash
pwd
git branch --show-current
git status --short --branch
```

Path and branch must match. Ordinary edits, focused tests, commits, pushes, and PR
creation need no approval. Escalate only product/architecture ambiguity, destructive
actions, external infrastructure mutation, credentials/secrets, or merge approval.

If GPG signing fails, use only a worktree-local fallback:

```bash
git config --worktree commit.gpgsign false
```

Never disable signing repository-wide.

## See also

- `run-worktree-session` — implementation handoff and lifecycle.
- `manage-pr` — PR readiness, explicit merge approval, and post-merge verification.
