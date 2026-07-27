---
name: run-worktree-session
description: >-
  Run feature or fix implementation in an isolated Index worktree, either inside an
  execution plane already created by pi-herdr-orchestrator or in a standalone visible
  Herdr-managed Pi, Codex, or Kimi session. Use for implementation, review fixes, and
  the verify-commit-push-PR loop. Never use it to manually create an orchestration
  root or wave child that the installed extension owns.
---

# Run a worktree implementation session

This skill governs source implementation and the verify/commit/push/PR loop. How the
execution plane is obtained depends on whether the installed orchestrator extension
already assigned this session.

## 1. Choose the execution mode

### Extension-managed child

When `ORCHESTRATOR_TIER=child` or the session has an orchestrator identity/assignment:

- the extension already created the semantic branch, Git worktree, named tab inside
  the root workspace,
  Pi session, active `/goal`, parent route, and durable task record;
- do **not** call `create-worktree`, open another Herdr workspace/tab, launch another
  agent, create a checkpoint protocol, or send a manual `CHILD_RESULT`;
- read the extension assignment file, verify the current worktree identity, implement
  the assigned scope, and finish through `orchestrator_report`.

When `ORCHESTRATOR_TIER=root`, do not implement source in the coordination worktree.
Use `run-agent-orchestration` and `orchestrator_delegate` instead.

### Standalone session

When no orchestrator identity exists, follow `create-worktree` from the canonical
root to create/reuse the semantic branch, run mandatory setup, and open its own
non-focusing Herdr worktree workspace. Record the workspace and pane IDs. Launch Pi,
Codex, or Kimi only if no matching agent already owns that exact worktree.

Do not use a hidden implementation subagent or watcher process/pane.

## 2. Verify identity before mutation

Run in the implementation checkout:

```bash
pwd
git rev-parse --show-toplevel
git branch --show-current
git status --short --branch
```

The path and semantic branch must match the assignment/handoff. Stop on a cwd,
branch, worktree, workspace, pane, or writer collision. One writer owns one worktree.

For an extension child, also confirm the assignment's task, role, scope, and non-goals.
Do not broaden scope merely because adjacent work is visible.

## 3. Execute the scoped implementation

Before editing, read the relevant `AGENTS.md`, `CLAUDE.md`, templates, and
path-specific skills. Keep changes within the assigned scope. Apply the primary role
checklist supplied by `run-agent-orchestration` when present.

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

### Extension-managed child

Before stopping, call `orchestrator_report`:

- `completed`: concise summary plus concrete verification, pushed branch/head, and
  PR, used only when no root verification/fix round remains;
- `blocked`: exact decision or external prerequisite needed;
- `failed`: attempted verification and remaining failure;
- `working`: meaningful nonterminal progress only when useful.

Do not separately prompt the root/main, send `CHILD_RESULT`, or close/remove the tab,
worktree, or branch. A report is a claim; the root verifies it.

### Standalone session

Send one concise terminal result to the parent pane recorded in the handoff, without
`--wait`, then leave the visible session available for independent verification and
possible fix rounds. The parent uses the existing pane/worktree rather than launching
a duplicate writer.

## 6. Fix rounds

For review or `finish-pr` findings, return to the same worktree and agent session.
In an extension request, keep the task nonterminal with a `working` report while a
root verification/fix round remains; the root may send one consolidated correction to
the exact tracked child pane because v0.1.0 has no correction tool. Verify identity
again, implement, rerun focused gates, commit/push, then send the one terminal report.
A terminal report is immutable: if a correction is discovered afterward, the root
verifies it directly and records the stale-report caveat rather than expecting an
updated report. Never create a new worktree or agent per review comment.

If a structured UI is active in a standalone Herdr pane, answer it through exact
pane-targeted text/keys rather than appending an agent prompt. In an extension-managed
request, the interactive root owns user decisions and routes the consolidated answer.

## 7. Cleanup ownership

The implementing child never cleans its own execution plane. `finish-pr` owns safe
feature worktree/branch cleanup after merge and after dirty/unpushed state is proven
preserved or disposable.

For extension-managed requests, the extension closes tracked Herdr tabs/workspaces
when the root goal completes. It intentionally leaves **all** root and child Git
worktrees/branches for later cleanup from another checkout after closure. Do not
compete with that lifecycle, manually close tracked surfaces, or remove a running
root's cwd.

## See also

- `run-agent-orchestration` — directs the installed orchestration tools and composes
  Index-aware root/child objectives.
- `create-worktree` — standalone branch/worktree/setup/Herdr-open workflow only.
- `finish-pr` — merge confirmation, post-merge verification, issue updates, and safe
  cleanup.
