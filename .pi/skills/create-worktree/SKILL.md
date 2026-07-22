---
name: create-worktree
description: >-
  Create or reuse an isolated Index worktree and open its visible Herdr-managed Pi
  session. Use before implementation from the canonical root, when resuming a branch
  session, or when validating branch/worktree/workspace identity before mutation.
---

# create-worktree

Keep the canonical root on `dev` and read-only for source changes. Create or reuse the
Git worktree there, run the mandatory setup, then open the exact checkout in Herdr.
Herdr is the default visible execution plane; do not launch a hidden implementation
subagent.

## Herdr preflight

Before worktree orchestration, verify the installed CLI, running server, and Pi
integration:

```bash
command -v herdr
herdr status server
herdr integration status
```

If the server/client is not running, have the user launch `herdr` from the repository
so the workspace remains visible. If the Pi integration is missing or outdated, follow
`docs/guides/getting-started.md` and install it before starting the agent. Do not silently
fall back to hidden execution; use the legacy helper only when the user explicitly
chooses that fallback because Herdr is unavailable.

## Branch and folder policy

Branches must match:

```text
^(feat|fix|chore|refactor|docs|test|perf)/[a-z0-9]+(?:-[a-z0-9]+)*$
```

The description must explain the change. Opaque issue-only names such as
`chore/ind-422` are rejected. The only valid folder is the branch with `/` replaced by
`-`; never accept or invent a separate folder argument.

From the canonical root, derive the identities once:

```bash
ROOT=$(git rev-parse --show-toplevel)
BRANCH=feat/negotiation-evidence-shadow
FOLDER=${BRANCH/\//-}
WORKTREE="$ROOT/.worktrees/$FOLDER"
```

Before creating anything, verify the root and inspect all registered worktrees:

```bash
pwd
git branch --show-current
git status --short --branch
git worktree list --porcelain
```

The canonical root must be `ROOT` on `dev`. If `WORKTREE` already exists, reuse it only
when its registered path and branch exactly match. Reject a path collision, a branch
mounted at another path, or a mismatched checkout instead of mutating it.

When no matching worktree exists, create it from `origin/dev`. Use the existing local
branch when present; otherwise create the semantic branch:

```bash
git fetch origin dev
if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git worktree add "$WORKTREE" "$BRANCH"
else
  git worktree add -b "$BRANCH" "$WORKTREE" origin/dev
fi
```

Run setup for both new and reused worktrees:

```bash
bun run worktree:setup "$FOLDER"
```

Setup is mandatory: it installs dependencies and links the root environment files.

## Open or focus the Herdr workspace

Open the exact existing Git worktree and use the dashed folder as the stable workspace
label:

```bash
herdr worktree open \
  --path "$WORKTREE" \
  --label "$FOLDER" \
  --focus \
  --json
```

Record the returned `.result.workspace.workspace_id` and
`.result.root_pane.pane_id`. The response may report `already_open: true`; that means
reuse, not permission to skip identity checks. Confirm the returned worktree path and
branch, and inspect the IDs directly when needed:

```bash
herdr workspace get "$WORKSPACE_ID"
herdr pane get "$PANE_ID"
herdr agent get "$PANE_ID"
```

If the root pane is an interactive shell with no Pi agent, start one. The default
stable agent name is the dashed folder, but Herdr live agent names must match
`[a-z][a-z0-9_-]{0,31}` (32 chars max) — when the folder exceeds the limit, use a
shorter unique alias (e.g. `agent-orchestration`) and keep the longer dashed
workspace label unchanged; the label and the agent alias are independent:

```bash
herdr agent start "$AGENT_ALIAS" --kind pi --pane "$PANE_ID"
```

To preselect a model and thinking level at launch (chosen per
`run-agent-orchestration`'s model routing — never switched mid-implementation), pass
an explicit agent argument after `--`:

```bash
herdr agent start "$AGENT_ALIAS" --kind pi --pane "$PANE_ID" -- --model provider/model:thinking
```

If Pi already exists in that pane, reuse it only when its cwd is `WORKTREE` and its
identity belongs to this workspace. Never start a second writer in the same worktree.

## Verify before mutation

The first handoff must require the visible Pi to run:

```bash
pwd
git branch --show-current
git status --short --branch
```

The path and branch must match `WORKTREE` and `BRANCH`. Stop on any collision or
mismatch. Ordinary edits, tests, commits, pushes, and PR creation need no approval;
escalate only genuine product/architecture ambiguity, destructive actions, external
infrastructure mutation, credentials/secrets, or merge approval.

Parallel implementation is allowed only when it is genuinely useful: give each writer
a separate semantic branch, Git worktree, Herdr workspace, and Pi session. One writer
per worktree remains mandatory.

The repository's `bun run worktree:session` launcher remains a legacy fallback when
Herdr is unavailable; it is not the default orchestration path.

If GPG signing fails in a non-interactive shell, preserve repository-wide settings. A
worktree-local fallback is allowed when needed:

```bash
git config --worktree commit.gpgsign false
```

Never use plain `git config commit.gpgsign false`, which affects every worktree.

## See also

- `run-worktree-session` — visible handoff, event-driven waits, question handling, and fix loops.
- `run-agent-orchestration` — multi-task waves: one root orchestrator, role profiles, model routing.
- `finish-pr` — explicit merge approval and post-merge verification.
