---
name: create-worktree
description: >-
  Create or reuse an isolated Index worktree and open its visible Herdr-managed Pi,
  Codex, or Kimi session. Use before implementation from the canonical root, when resuming a branch
  session, or when validating branch/worktree/workspace identity before mutation.
---

# create-worktree

Keep the canonical root on `dev` and read-only for source changes. Create or reuse the
Git worktree there, run the mandatory setup, then open the exact checkout in Herdr.
Herdr is the default visible execution plane; do not launch a hidden implementation
subagent.

## Herdr preflight

Before worktree orchestration, verify the installed CLI, running server, and chosen
agent integration (Pi, Codex, or Kimi):

```bash
command -v herdr
herdr status server
herdr integration status
```

If the server/client is not running, have the user launch `herdr` from the repository
so the workspace remains visible. If the selected agent integration is missing or outdated, follow
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

## Open the Herdr surface without focus

Always preserve the user's active `index` workspace by opening without focus.
Two modes exist:

**Standalone session (no orchestration wave):** open the exact existing Git
worktree as its own workspace, with the dashed folder as the stable label:

```bash
herdr worktree open \
  --path "$WORKTREE" \
  --label "$FOLDER" \
  --no-focus \
  --json
```

Record the returned `.result.workspace.workspace_id` and
`.result.root_pane.pane_id`. **Nesting invariant (mandatory):** the returned
`.result.workspace.worktree` metadata must report `is_linked_worktree: true`
with `repo_root` equal to the canonical root — that metadata is what makes the
workspace collapse under `index` in the sidebar. If it is absent, close the
workspace and re-open via `herdr worktree open` rather than continuing with a
top-level orphan. The response may report `already_open: true`; that means
reuse, not permission to skip identity checks. Confirm the returned worktree
path and branch, and inspect the IDs directly when needed:

```bash
herdr workspace get "$WORKSPACE_ID"
herdr pane get "$PANE_ID"
herdr agent get "$PANE_ID"
```

**Wave child (an orchestration `ROOT_WS_ID` exists):** do not open a new
workspace. Create a named tab in the wave root's workspace, with the dashed
folder as the tab label and the worktree as cwd, and record the returned
`.result.tab.tab_id` and `.result.root_pane.pane_id`:

```bash
herdr tab create --workspace "$ROOT_WS_ID" --cwd "$WORKTREE" \
  --label "$FOLDER" --no-focus
```

Reuse an existing tab only when its label is `$FOLDER` and its pane cwd is
`$WORKTREE`; reject collisions.

**Prohibitions (both modes):** never use `herdr workspace create --cwd` for any
repository checkout — it records no worktree metadata and produces a permanent
top-level sidebar orphan. Never run `herdr worktree open --path` against the
canonical root — Herdr dedupes it into the user's `index` workspace and renames
it (recover with `herdr workspace rename <INDEX_WS_ID> index`).

If the root pane is an interactive shell with no agent, launch Codex, Pi, or Kimi through the
exact non-focusing pane ID. Choose the command and any supported model options before
launch; never switch models mid-implementation:

```bash
herdr pane send-text "$PANE_ID" "codex" # or: kimi, or: pi --model provider/model:thinking
herdr pane send-keys "$PANE_ID" enter
```

Pi, Codex, and Kimi are equally supported; exact launch lines, model routing, and
per-harness capabilities live in the `run-agent-orchestration` references
(`harness-matrix.md`, `model-routing.md`).

All pane reads, text, and keys are explicit-ID-targeted and non-focusing. If an agent
already exists in that pane, reuse it only when its cwd is `WORKTREE` and its identity
belongs to this workspace or tab. Never start a second writer in the same worktree. Do not
use `herdr agent start` as the normal launch path; if an environment forces that
fallback, capture the active workspace first and immediately restore `index` so focus
is never left changed.

## Verify before mutation

The first handoff must require the visible agent to run:

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
a separate semantic branch, Git worktree, Herdr surface (workspace or wave-root tab),
and agent session. One writer per worktree remains mandatory.

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
- `run-agent-orchestration` — multi-task waves: main/root/child tiers, role profiles, harness and model routing.
- `finish-pr` — explicit merge approval and post-merge verification.
