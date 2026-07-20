---
name: bump-agentvillage-submodule-pointer
description: Ship a change to the Edge-City agentvillage submodule end-to-end and bump the index monorepo's submodule pointer, without initializing the submodule in a worktree. Use after merging a PR in Edge-City/agentvillage (or when the pointer at packages/edge-city/agentvillage is stale) — covers the branch-in-submodule → PR-to-Edge-City → pointer-bump-PR-to-dev flow, the git update-index --cacheinfo 160000 plumbing trick for committing a gitlink from a worktree with an empty submodule dir, and restoring the root submodule to a clean detached checkout.
---

# bump-agentvillage-submodule-pointer

`packages/edge-city/agentvillage` is a **git submodule** (canonical repo:
`Edge-City/agentvillage`, its `main` is the deploy source for tenant sidecars). The
monorepo only records a pointer. Two distinct repos ⇒ two PRs.

## Phase 1 — change the submodule content

Work happens **inside the submodule checkout in the canonical root** (worktrees do NOT
have the submodule populated — the dir is empty there):

```bash
cd packages/edge-city/agentvillage        # its own repo; root-dev-guard does not track it
git checkout -b fix/<desc>                # this repo does NOT gpg-sign (unlike the monorepo)
# edit, test (bun test from the affected skills/*/scripts dir), commit
git push -u origin fix/<desc>
gh pr create --repo Edge-City/agentvillage --head fix/<desc> ...
# after merge (squash is the convention; repo has no CI checks):
git fetch origin --prune
git checkout --detach <merged-sha-on-main>   # restore clean detached state
git branch -D fix/<desc>
```

Leaving the submodule detached at the *old* pinned SHA vs the new one only affects
your local tree; the monorepo pointer is what matters.

## Phase 2 — bump the pointer in the monorepo (PR to dev)

Convention: `chore(agentvillage): bump submodule pointer to merged #NNN` (see git log
for prior art). Do it from a worktree **without initializing the submodule** — stage
the gitlink directly with plumbing. This is the explicit gitlink-only setup exception
in `git-worktree-workflow`: it needs no dependency install, but the worktree must have
its hooks path configured. The worktree implementation session/agent may make this
mechanical commit after verifying the worktree path and branch; use a named handoff only
when a user-operated session already owns that worktree:

```bash
git worktree add .worktrees/chore-bump-agentvillage -b chore/bump-agentvillage-submodule origin/dev
cd .worktrees/chore-bump-agentvillage
git config core.hooksPath "$PWD/scripts/hooks"
git update-index --add --cacheinfo 160000,<merged-sha>,packages/edge-city/agentvillage
git diff --cached --submodule=short        # verify: old-sha..new-sha 160000
git commit -m "chore(agentvillage): bump submodule pointer to merged #NNN"
git push -u origin chore/bump-agentvillage-submodule
gh pr create --base dev ...
```

No full `worktree:setup` needed — a pointer commit needs no deps, and CI (check/lint/test/
typecheck) doesn't check out the submodule; the direct hooks configuration above keeps
pre-push generation active. If commit signing fails, see
`git-worktree-workflow` → "Commit signing (GPG fails without a TTY)".

## Phase 3 — after the pointer PR merges

```bash
cd /Users/yanek/Projects/index && git pull --ff-only origin dev
git -C packages/edge-city/agentvillage checkout --detach <merged-sha>   # sync working copy
git status --short                        # must be clean (no "modified: packages/edge-city/agentvillage")
# then normal worktree cleanup (remove worktree, delete branches)
```

## Gotchas

- `git log -- packages/edge-city/agentvillage/<file>` from the monorepo fails with
  *"Pathspec is in submodule"* — run git commands inside the submodule dir instead.
- Rollout to tenants is driven by `Edge-City/agentvillage@main`, not the monorepo
  pointer — the pointer is dev-checkout convenience only.
- The nested `skills/` dir auto-syncs to `Edge-City/agentvillage-skills` via that
  repo's workflow; nothing extra to do.

## See also

- `git-worktree-workflow` — worktree conventions + GPG signing escape.
- `docs/guides/agentvillage-submodule.md` + CLAUDE.md → Subtrees → agentvillage submodule.
- `railway-mcp-edge-city` — verifying sidecar state after rollout.
