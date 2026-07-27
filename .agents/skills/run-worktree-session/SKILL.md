---
name: run-worktree-session
description: >-
  Run feature or fix implementation in an isolated Index worktree inside a
  standalone visible Herdr-managed Pi, Codex, or Kimi session. Use for
  implementation, review fixes, and the verify-commit-push-PR loop.
---

# Run a worktree implementation session

This skill governs source implementation and the verify/commit/push/PR loop in a
standalone visible Herdr-managed session.

## 1. Set up the execution plane

Follow `create-worktree` from the canonical root to create/reuse the semantic
branch, run mandatory setup, and open its own non-focusing Herdr worktree
workspace. Record the workspace and pane IDs. Launch Pi, Codex, or Kimi only if no
matching agent already owns that exact worktree.

Do not use a hidden implementation subagent or watcher process/pane.

## 2. Verify identity before mutation

Run in the implementation checkout:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
```

The path and semantic branch must match the handoff. Stop on a cwd,
branch, worktree, workspace, pane, or writer collision. One writer owns one worktree.

Also confirm the handoff's task, scope, and non-goals. Do not broaden scope merely
because adjacent work is visible.

## 3. Execute the scoped implementation

Before editing, read the relevant `AGENTS.md`, `CLAUDE.md`, templates, and
path-specific skills. Keep changes within the assigned scope. Apply any role
checklist supplied in the handoff when present.

Ordinary edits, focused tests, commits, pushes, and PR creation need no additional
approval. Escalate only genuine product/architecture ambiguity, destructive actions,
external infrastructure mutation, credentials/secrets, or merge approval. Never infer
merge approval.

Run targeted tests, lint, typechecks, builds, and manual checks appropriate to the
diff. Update required docs, generated artifacts, and package versions before commit.
Report failures honestly; do not relabel unfinished implementation as verification.

## 4. Commit, push, and open/update the PR

After verification succeeds:

1. inspect the complete diff and worktree status;
2. commit with a conventional commit message;
3. push the semantic branch;
4. fetch that branch and confirm no upstream drift:

   ```bash
   git fetch origin <branch>
   git status --short --branch
   ```

5. open or update the requested PR into `dev`, with exact verification evidence and
   caveats.

A child may reconcile upstream drift only on its own feature branch. It never merges
`dev`, `main`, or another shared branch and never owns cross-branch manifest or
`bun.lock` reconciliation. Opening a PR is not merge approval.

## 5. Report completion through the owning channel

Send one concise terminal result to the parent pane recorded in the handoff, without
`--wait`, then leave the visible session available for independent verification and
possible fix rounds. The parent uses the existing pane/worktree rather than launching
a duplicate writer.

## 6. Fix rounds

For review or `finish-pr` findings, return to the same worktree and agent session.
Verify identity again, implement, rerun focused gates, commit/push, then send the
terminal result. Never create a new worktree or agent per review comment.

If a structured UI is active in a standalone Herdr pane, answer it through exact
pane-targeted text/keys rather than appending an agent prompt.

## 7. Cleanup ownership

The implementing session never cleans its own execution plane. `finish-pr` owns safe
feature worktree/branch cleanup after merge and after dirty/unpushed state is proven
preserved or disposable.

## See also

- `create-worktree` — standalone branch/worktree/setup/Herdr-open workflow only.
- `finish-pr` — merge confirmation, post-merge verification, issue updates, and safe
  cleanup.
