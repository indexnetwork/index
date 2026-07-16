---
name: zed-worktree-development-pipeline
description: >-
  Coordinate feature and fix development between Zed, Pi, and git worktrees through
  explicit handoffs: create and set up a worktree before implementation, pause for the
  user to switch Zed/Pi into it, present a user story and acceptance test before commit,
  then commit, push, open a PR, and hand back to the canonical checkout for finish-pr.
  Use whenever work is about to move from investigation or planning into code changes
  in the Index monorepo, especially when the user is working through Zed's worktree UI.
---

# Zed worktree development pipeline

Use explicit stop-and-handoff boundaries. Never start implementation in the canonical
root and never assume Zed or Pi has switched directories automatically.

## 1. Investigate and plan without mutations

Inspect the canonical checkout and agree on scope. Before the first code or config
mutation, choose a conventional branch (`<type>/<short-desc>`) and matching dashed
worktree folder (`<type>-<short-desc>`).

## 2. Create and fully set up the worktree

From the canonical project root:

```bash
git worktree add -b <type>/<short-desc> .worktrees/<type-short-desc> dev
bun run worktree:setup <type-short-desc>
```

`worktree:setup` is mandatory. It installs dependencies, links the root `.env*` files,
and configures hooks. Do not treat `git worktree add` alone—or Zed creating a checkout
without setup—as implementation-ready.

## 3. Hand off to Zed/Pi and stop

Tell the user to switch Zed to the new worktree and start or continue Pi there. Provide:

- branch name;
- absolute worktree path;
- confirmation that `bun run worktree:setup` completed;
- a concise implementation handoff: goal, agreed scope, key files, constraints, and
  verification plan;
- a copyable continuation prompt if a fresh Pi session is likely.

Then stop. Do not edit implementation files until the user confirms the active Pi
session's cwd is the worktree.

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
approved the implementation.

## See also

- `git-worktree-workflow` — naming, setup internals, root guard, and worktree-local Git
  troubleshooting.
- `finish-pr` — PR readiness, merge approval, deployment verification, issue updates,
  and safe cleanup after the user returns to the canonical checkout.
- `receiving-code-review` — address and resolve review conversations before merging.
