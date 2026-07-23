---
name: run-worktree-session
description: >-
  Run feature and fix implementation in a visible Herdr-managed Pi worktree session,
  with event-driven root-to-child coordination and a verify-commit-push-PR loop. Use when
  Index work moves from root investigation into implementation or returns for review
  and finish-pr fixes.
---

# run-worktree-session

The canonical/root Pi coordinates and remains active. The visible Pi in the exact Herdr
worktree workspace owns code mutations. Do not use hidden `Agent` subagents for
implementation or fix rounds, and do not create a watcher process or watcher pane.

## 1. Create or reuse the visible session

Follow `create-worktree` from the canonical root:

1. derive the semantic branch, dashed folder, and absolute worktree path;
2. create or reuse the exact Git worktree after collision checks;
3. run `bun run worktree:setup <folder>`;
4. open it with Herdr without changing the active `index` workspace;
5. launch Pi only if the returned root pane has no existing agent.

The installed CLI contract is:

```bash
herdr worktree open --path "$WORKTREE" --label "$FOLDER" --no-focus --json
# optional preselected model/thinking at launch:
herdr pane send-text "$PANE_ID" "pi --model provider/model:thinking"
herdr pane send-keys "$PANE_ID" enter
```

All pane reads, text, and keys are explicit-ID-targeted and non-focusing. Prefer this
pane launch path. Do not use `herdr agent start` normally; if an environment forces
that fallback, capture the active workspace first and immediately restore `index` so
focus is never left changed.

Capture the returned workspace and pane IDs. Reuse the existing workspace/Pi when
Herdr reports the worktree is already open. Reject a cwd, branch, workspace, pane, or
agent-name collision rather than sending work to the wrong checkout.

## 2. Deliver one complete handoff

Write one complete handoff with the absolute worktree, branch, scope, constraints,
verification commands, and requested RESULT. Inspect the exact pane before delivery,
then submit without waiting:

```bash
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/handoff.md)"
```

Do not use `--wait`, `herdr agent wait`, polling, sleeps, watcher processes, or watcher
panes. Do not commit task-specific handoff files under `.pi`.

## 3. Reconcile results manually

The orchestration bridge has been removed pending refactor, so no automatic child
callback exists. On a later natural user turn or explicit orchestration tick, perform
one `herdr agent get` plus recent pane read. If the child is still working, return
without repeated checks. If it is settled, inspect its `RESULT` and independently
verify branch/head/status, pushed commits, PR state, checks, and targeted tests.

For parallel work, inspect each owned child once per explicit tick. A missing callback
is expected in this temporary mode; do not replace it with polling.

## 4. Answer questions safely

For routine implementation questions, inspect the pane and choose the recommended or
safest project-compliant option automatically. Examples include ordinary file edits,
targeted tests, commits, pushes, and PR creation.

Escalate to the user only for:

- genuine product or architecture ambiguity;
- destructive operations;
- external infrastructure mutation;
- credentials or secrets;
- merge approval.

Never infer merge approval.

When Herdr shows a child `blocked` state or a durable blocked callback arrives, inspect
the active UI. If a structured question, selector, or editor draft is active, do
**not** use `herdr agent prompt`: it can append text to stale input. Read
the pane, then answer the active UI through its pane ID with targeted text/keys:

```bash
herdr pane read "$PANE_ID" --source visible --lines 120
herdr pane send-text "$PANE_ID" "<safe answer>"
herdr pane send-keys "$PANE_ID" enter
```

For a selector, send only the navigation/confirmation keys required by the visible UI.
Re-read the pane afterward to verify that the answer landed in the intended control.

## 5. Verify session identity and implementation

The visible Pi must run before mutation:

```bash
pwd
git branch --show-current
git status --short --branch
```

The path and branch must match the handoff. Keep changes within scope. Run targeted
tests, lint, typechecks, and manual checks appropriate to the diff. Update required
docs, package versions, and generated artifacts before committing. Report failures
honestly.

After verification succeeds, the visible Pi:

1. commits with a conventional commit message;
2. pushes the semantic branch;
3. opens or updates a PR into `dev` with exact verification results and caveats.

Opening a PR is not merge approval. The coordinator's `finish-pr` workflow owns
readiness, explicit merge confirmation, deployment verification, issue updates, and
cleanup — including closing this Herdr workspace (by verified ID, never the canonical
root) before removing the Git worktree, so no stale sidebar entry survives.

## 6. Reuse for fix rounds

For review or finish-pr findings, return to the same Herdr workspace, pane, and Pi
agent. Send one consolidated fix prompt under the same asymmetric handoff rule,
answer routine questions through the targeted pane, and reconcile the durable
checks/commit/push result without polling. Do not create a fresh worktree, agent, or
prompt per comment.

Parallel work uses separate visible Herdr workspaces and separate Git worktrees, with
one writer per worktree. Merge or reconcile those branches deliberately; never let two
agents mutate one checkout.

## 7. Manual compaction checkpoint

At a safe idle boundary, write a concise continuation checkpoint containing the exact
session, worktree/branch/head, dirty state, validation completed, and next action.
Then issue `/compact` and queue one explicit continuation prompt referencing that
checkpoint. Verify the same session resumes; if Pi stops, relaunch that exact session
file/model/worktree rather than creating a duplicate writer. Never compact during a
tool, write, test, rebase, migration, merge, deployment, or structured question.

## See also

- `create-worktree` — branch, setup, Herdr-open, and collision contracts.
- `run-agent-orchestration` — multi-task waves, role profiles, model routing, and the
  full blocked-question escalation ladder across agents.
- `address-code-review` — factual thread inspection and visible fix-loop workflow.
- `finish-pr` — merge approval and post-merge operations.
