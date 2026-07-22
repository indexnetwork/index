---
name: run-worktree-session
description: >-
  Run feature and fix implementation in a visible Herdr-managed Pi worktree session,
  with direct coordinator polling and a focused verify-commit-push-PR loop. Use when
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
4. open or focus it with Herdr;
5. start Pi only if the returned root pane has no existing agent.

The installed CLI contract is:

```bash
herdr worktree open --path "$WORKTREE" --label "$FOLDER" --focus --json
herdr agent start "$AGENT_ALIAS" --kind pi --pane "$PANE_ID"
# optional preselected model/thinking at launch:
herdr agent start "$AGENT_ALIAS" --kind pi --pane "$PANE_ID" -- --model provider/model:thinking
```

`AGENT_ALIAS` defaults to the dashed folder but must fit Herdr's live-name limit
`[a-z][a-z0-9_-]{0,31}`; shorten it when the folder is longer (the workspace label
stays the full dashed folder).

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

Before delivery, inspect the visible agent and recent pane output:

```bash
herdr agent get "$AGENT_NAME"
herdr agent read "$AGENT_NAME" --source recent-unwrapped --lines 200
```

Send the full handoff as one atomic prompt only when the agent is ready and no
structured question or editor draft is active. `--wait` submits and waits in one call
for the first settled `idle`, `done`, or `blocked` state:

```bash
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/handoff.md)" --wait
```

Do not commit task-specific handoff files under `.pi`.

## 3. Wait event-driven from the coordinator

The coordinator stays active while implementation runs and waits on the same visible
agent. **`sleep` polling is banned** — Herdr waits are server-owned and event-driven,
and `sleep` both wastes wall-clock and hides `blocked` states. Do not delegate
observation to a background watcher process or watcher pane.

`agent prompt --wait` usually carries the whole turn. When a follow-up wait is needed
(after a timeout checkpoint or a resolved question), poll directly:

```bash
herdr agent get "$AGENT_NAME"
herdr agent read "$AGENT_NAME" --source recent-unwrapped --lines 200
herdr agent wait "$AGENT_NAME" --timeout 30000
```

A wait timeout is a polling checkpoint, not a failure. Read new output, handle any
question, and wait again until the agent reports completion or a real blocker.
Ground decisions in the visible output rather than assuming that `working`, `idle`, or
`done` alone proves success — `idle` and `done` are both settled states, and a settled
state still requires transcript and git/PR/test verification.

For parallel agents, issue multiple `herdr agent prompt NAME "..." --wait` (or
`agent wait`) tool calls in one turn so the server-owned waits run concurrently.

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

`agent prompt --wait` and `agent wait` return `blocked` when Herdr recognizes an
approval or question UI. If a structured question, selector, or editor draft is
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
cleanup.

## 6. Reuse for fix rounds

For review or finish-pr findings, return to the same Herdr workspace, pane, and Pi
agent. Send one consolidated fix prompt, poll directly, answer routine questions, and
wait for the focused checks/commit/push result. Do not create a fresh worktree, agent,
or prompt per comment.

Parallel work uses separate visible Herdr workspaces and separate Git worktrees, with
one writer per worktree. Merge or reconcile those branches deliberately; never let two
agents mutate one checkout.

## See also

- `create-worktree` — branch, setup, Herdr-open, and collision contracts.
- `run-agent-orchestration` — multi-task waves, role profiles, model routing, and the
  full blocked-question escalation ladder across agents.
- `address-code-review` — factual thread inspection and visible fix-loop workflow.
- `finish-pr` — merge approval and post-merge operations.
