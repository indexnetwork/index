---
name: create-worktree
description: >-
  Create or reuse an isolated Index worktree and open its standalone visible
  Herdr-managed Pi, Codex, or Kimi session. Use before standalone implementation
  from the canonical root or when validating a standalone branch/worktree/workspace
  identity. Do not use for roots or children owned by pi-herdr-orchestrator.
---

# Create a standalone worktree session

Keep the canonical root on `dev` and read-only for source changes. This workflow is
for a **standalone** implementation session only.

If the installed orchestrator extension owns the request:

- `orchestrator_start` creates the root worktree-backed workspace;
- `orchestrator_delegate` creates child semantic branches, worktrees, and named tabs;
- this skill must not pre-create, reopen, or relaunch either surface.

Use `run-agent-orchestration` instead. Never recreate extension mechanics with Herdr
CLI commands.

## Herdr preflight

Before standalone worktree work, verify the installed CLI, running server, and chosen
agent integration:

```bash
command -v herdr
herdr status server
herdr integration status
```

If Herdr is unavailable, ask the user to launch/fix it. Do not silently fall back to a
hidden implementation subagent. The legacy helper is used only when the user
explicitly chooses that fallback.

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

## Open the standalone Herdr surface without focus

Open the exact linked worktree as its own nested workspace:

```bash
herdr worktree open \
  --path "$WORKTREE" \
  --label "$FOLDER" \
  --no-focus \
  --json
```

Record `.result.workspace.workspace_id` and `.result.root_pane.pane_id`. The returned
worktree metadata must report `is_linked_worktree: true` and the canonical `repo_root`.
If absent, close that accidental surface and reopen through `herdr worktree open`.
`already_open: true` means reuse after identity checks, not permission to skip them.

Never:

- use `herdr workspace create --cwd` for a repository checkout;
- open the canonical root itself with `herdr worktree open`;
- manually create a wave root or child tab for an extension-managed request;
- start a second writer in an existing worktree.

If the pane is an interactive shell with no agent, launch the chosen standalone
harness through the exact pane ID without focusing it:

```bash
herdr pane send-text "$PANE_ID" "pi" # or codex/kimi when explicitly chosen
herdr pane send-keys "$PANE_ID" enter
```

Do not use `herdr agent start` as the normal standalone launch path. All pane reads,
text, and keys remain exact-ID-targeted and non-focusing.

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

- `run-worktree-session` — standalone handoff and implementation lifecycle, or child
  execution after the extension has already created a worktree.
- `run-agent-orchestration` — project policy adapter for extension-managed roots and
  children.
- `finish-pr` — explicit merge approval and post-merge verification.
