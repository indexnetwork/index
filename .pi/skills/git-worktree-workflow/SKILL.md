---
name: git-worktree-workflow
description: Create and operate git worktrees in the index monorepo using the project's `bun run worktree:*` helpers instead of raw git. Use whenever you need an isolated branch checkout to make changes (the canonical root must stay on dev and is read-only for the assistant, enforced by the root-dev-guard extension), or when a worktree is missing env files, node_modules, or git hooks, or when a tool/bash call is blocked for touching the canonical root. Covers the dashed-folder / slashed-branch naming convention and why `worktree:setup` is mandatory after creating a worktree.
---

# git-worktree-workflow

The canonical root `/Users/yanek/Projects/index` must stay on `dev` and is read-only
for the assistant. All changes happen in a worktree under `.worktrees/`. This repo
wraps `git worktree` with `bun run worktree:*` helpers (`scripts/worktree-*.sh`) that do
setup work raw git does **not**.

## Naming convention (non-negotiable)

- **Branch**: `<type>/<short-desc>` with slashes — e.g. `chore/track-agentvillage-main`.
- **Worktree folder**: same name with **dashes** — e.g. `.worktrees/chore-track-agentvillage-main`.

Keep them trivially derivable from each other: the `worktree:*` helpers take the **dashed
folder name** as their argument, so mirroring the branch in dashed form is what makes
`bun run worktree:dev <name>` work without guessing.

## Create + setup (always both)

```bash
git worktree add -b <type>/<desc> .worktrees/<type-desc> dev   # branch off dev
bun run worktree:setup <type-desc>                             # REQUIRED next step
```

Raw `git worktree add` alone is **not enough**. `worktree:setup` (`scripts/worktree-setup.sh`):

1. Installs `node_modules` for `backend` + `frontend` (`bun install --frozen-lockfile`).
2. Symlinks `.env*` (except `.env.example`) into `backend`, `frontend`,
   `packages/protocol`, `packages/cli` — secrets are linked, never copied.
3. Symlinks `.claude/settings.local.json`.
4. Sets `git config core.hooksPath → scripts/hooks` so the **pre-push hook**
   (regenerates `SKILL.md` files) actually fires on push.

Skipping setup most often bites via #4: a push from an unconfigured worktree silently
skips the pre-push hook. If you only need the hooks path (e.g. a doc/config-only worktree
where the heavy install is wasteful), set it directly:

```bash
git -C .worktrees/<type-desc> config core.hooksPath "$PWD/scripts/hooks"
```

## Run / build / inspect

```bash
bun run worktree:dev   <type-desc>   # start all dev servers (auto-runs setup if missing)
bun run worktree:build <type-desc>   # build in that worktree (no arg = build at root)
bun run worktree:list                # list worktrees + setup status
```

## Enforcement: the root-dev-guard extension

`.pi/extensions/root-dev-guard.ts` enforces all of the above automatically at runtime —
the skill documents the convention; the extension keeps it visible. It:

- **Keeps the root on `dev`**: on `session_start` it switches the canonical root back to
  `dev` if the tree is clean, or errors (telling you to move work to a worktree) if the
  root has tracked changes.
- **Flags `write`/`edit`** to any path inside the canonical root that is *not* under
  `.worktrees/`.
- **Flags mutating `bash`** run from the canonical root — `git add/commit/push/merge/
  reset/...`, `rm/mv/cp/mkdir/...`, `bun|npm install`, `bun run build/dev/db:*`, and
  output redirects (`>`, `| tee`). Read-only commands (`git status/log/diff`, `ls`,
  `cat`, `grep`, `find`) are **not** flagged — you do not need `cd /tmp` for inspection.
  `gh` (PRs/issues/reviews) and fast-forward-only `git pull --ff-only` are exempt.
- **Flags branch switches** in the root (only a bare `git switch dev` is allowed).

### Modes: warn (default) vs block

The guard is **advisory by default** (`INDEX_ROOT_GUARD_MODE=warn`): a flagged operation
is **allowed** but the agent gets an advisory appended to the tool result (and you get a
UI warning) nudging it to use a worktree. Root writes still dirty `dev`, so prefer a
worktree regardless. Set **`INDEX_ROOT_GUARD_MODE=block`** to restore the old hard-block
behavior (flagged operations are refused). Command classification strips quoted/heredoc
argument text before matching, so prose like a PR body mentioning `bun run build` no
longer trips it, and mutating verbs only match at a command position (so `grep -ln`
is fine).

**Sanctioned escapes the guard allows** (use these instead of fighting it):
- `git worktree ...` and `bun run worktree:*` from the root.
- Any command that targets a worktree — `cd .worktrees/<name> && ...` or
  `git -C .worktrees/<name> ...`.
- Read-only git against the root via `-C` from outside it (see below).
- `git pull --ff-only` from the root — the sanctioned way to bring the root current
  with `origin/dev` after a PR merges. It is allowed *only* with `--ff-only` (a
  fast-forward cannot create a merge commit or diverge the branch, and aborts harmlessly
  when no fast-forward is possible) and *only* as a standalone command — any chaining
  (`&&`, `;`, `|`), redirect, or command substitution disqualifies it. A bare `git pull`
  stays blocked.

Overridable via env: `INDEX_CANONICAL_ROOT` (root path), `INDEX_ROOT_BRANCH` (default `dev`).

## Running git/bash against the read-only root

The guard blocks mutating commands whose cwd is the canonical root. For inspection, run
from `/tmp` (or a worktree) and target the root with `-C`:

```bash
cd /tmp && git -C /Users/yanek/Projects/index worktree list
```

Read-only git queries (status, log, ls-tree) are fine this way; all mutating work
belongs in a worktree.

## Finishing up

After the branch's PR merges into `dev`, clean up:

```bash
git -C /Users/yanek/Projects/index worktree remove .worktrees/<type-desc>
git -C /Users/yanek/Projects/index branch -d <type>/<desc>
```

## See also

- **Submodules** (Edge-City `agentvillage` / `-controlplane` / `-landing`): work inside the
  submodule, branch + PR into the `Edge-City` org repo, then bump the monorepo pointer with
  `git add <submodule-path>`. `git submodule update` restores to the pinned SHA;
  `git submodule update --remote` advances to the tracked branch tip. See
  `docs/guides/agentvillage-submodule.md` and the Subtrees/submodule section of `CLAUDE.md`.
- Worktree conventions also summarized in `CLAUDE.md` → Git Workflow → Worktrees.
- Runtime enforcer: `.pi/extensions/root-dev-guard.ts` (see Enforcement above).
