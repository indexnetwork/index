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

Prepare one prompt file outside the repository containing:

- a stable handoff name, branch, dashed folder, and expected absolute worktree path;
- verified findings and agreed scope;
- key files, constraints, and exclusions;
- targeted verification commands;
- instructions to verify cwd/branch, commit, push, and open/update the PR;
- an instruction not to create another worktree or hidden implementation subagent.

Before delivery, inspect the exact pane and recent visible output:

```bash
herdr pane read "$PANE_ID" --source visible --lines 200
```

Send the full handoff as one atomic prompt only when the agent is ready and no
structured question or editor draft is active. The wait rule depends on the
coordinator: the interactive main workspace dynamically identified by label `index`
must submit `herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/handoff.md)"`
without `--wait` and return idle; it reconciles durable root state only on a later
natural turn or explicit orchestration tick. A dedicated root orchestrator outside
`index` may and should instead use exactly one server-owned, indefinite root → child
handoff:

```bash
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/handoff.md)" --wait
```

Do not add a timeout. Do not commit task-specific handoff files under `.pi`.

## 3. Reconcile results without polling

**`sleep` polling is banned.** Do not use polling or timeout retry loops,
`herdr agent wait`, background watcher processes, or watcher panes. The interactive
main workspace (`index`) returns after its fire-and-return root handoff and reconciles
durable root state only on a later natural turn or explicit orchestration tick.

A dedicated root outside `index` receives a child result through its one
`agent prompt --wait` handoff. After it returns, inspect the structured `RESULT` and
factual git/PR/test state; `working`, `idle`, `done`, and `blocked` alone are never
proof of success. It publishes final `RESULT` and genuine blocked-question events via
the project-local durable orchestration bridge, not by injecting an agent prompt or
relying on a toast. The trusted `index` extension attaches those events only on the
user's next natural turn; Herdr notifications are optional visibility only and cannot
resume Pi. For parallel children, the dedicated root may issue multiple complete
`herdr agent prompt NAME "..." --wait` calls in one turn so the server owns the waits
concurrently.

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

A dedicated root's `agent prompt --wait` can return `blocked` when Herdr recognizes
an approval or question UI. If a structured question, selector, or editor draft is
active, do **not** use `herdr agent prompt`: it can append text to stale input. Read
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

## See also

- `create-worktree` — branch, setup, Herdr-open, and collision contracts.
- `run-agent-orchestration` — multi-task waves, role profiles, model routing, and the
  full blocked-question escalation ladder across agents.
- `address-code-review` — factual thread inspection and visible fix-loop workflow.
- `finish-pr` — merge approval and post-merge operations.
