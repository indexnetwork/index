---
name: git-worktree-workflow
description: Create and operate git worktrees in the index monorepo using the project's `bun run worktree:*` helpers instead of raw git. Use whenever you need an isolated branch checkout to make changes (the canonical root must stay on dev and is read-only for the assistant), or when a worktree is missing env files, node_modules, or git hooks. Covers the dashed-folder / slashed-branch naming convention and why `worktree:setup` is mandatory after creating a worktree.
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

## Running git/bash against the read-only root

The assistant's bash tool blocks commands whose cwd is the canonical root. Run from
`/tmp` (or the worktree) and target the root with `-C`:

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
