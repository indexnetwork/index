# CLAUDE.md

## Session roles: root orchestrates, worktrees implement

We work via worktrees, one Zed window and one agent session per worktree.

- **Root session** (working directory is the repo root): orchestrate, never implement.
  1. Create the worktree with the script — `bun run worktree:new <type>/<description>` —
     which validates the branch name, bases it on `origin/dev`, and runs the mandatory setup.
  2. Write a handoff prompt for the task and copy it to the clipboard (`pbcopy`), then give
     the user the worktree path (`.worktrees/<type>-<description>`) so they can open it in
     Zed, start a session there, and paste the handoff.
- **Worktree session**: implement the change and finish by opening a PR into `dev`.
- **Follow-up changes go through a handoff too**: if the PR or worktree needs more work
  (review feedback, failing checks, scope additions), the root session writes another
  clipboard handoff for that worktree — it does not make the changes itself.
- **Merging the PR is the root session's responsibility** — the worktree session never
  merges, and merge approval from the user is always explicit.
