---
name: run-worktree-session
description: >-
  Run feature and fix implementation in a visible Herdr-managed Pi, Codex, or Kimi worktree session,
  with fire-and-return handoffs, explicit manual reconciliation, and a
  verify-commit-push-PR loop. Use when Index work moves from root investigation into
  implementation or returns for review and finish-pr fixes.
---

# run-worktree-session

Tier vocabulary is fixed (see `run-agent-orchestration`): the coordinating agent is
the **parent** (`root` in its wave coordination worktree, or `main` acting alone
from the canonical root); the visible agent in the exact Herdr worktree workspace
or wave-root tab is the **`child`** and owns code mutations. Do not use hidden `Agent` subagents for
implementation or fix rounds, and do not create a watcher process or watcher pane.

## 1. Create or reuse the visible session

Follow `create-worktree` from the canonical root:

1. derive the semantic branch, dashed folder, and absolute worktree path;
2. create or reuse the exact Git worktree after collision checks;
3. run `bun run worktree:setup <folder>`;
4. open it with Herdr without changing the active `index` workspace — as its own
   nested workspace (standalone) or as a named tab of the wave root workspace
   (wave child); see `create-worktree` for the mode split, the nesting
   invariant, and the prohibitions;
5. launch Codex, Pi, or Kimi only if the returned root pane has no existing agent.

The installed CLI contract is:

```bash
# standalone session — own workspace, nests under `index` (verify worktree metadata):
herdr worktree open --path "$WORKTREE" --label "$FOLDER" --no-focus --json
# wave child — named tab in the orchestration root workspace:
herdr tab create --workspace "$ROOT_WS_ID" --cwd "$WORKTREE" --label "$FOLDER" --no-focus
# launch Codex, Kimi, or Pi with a preselected model/thinking level:
herdr pane send-text "$PANE_ID" "codex" # or: kimi, or: pi --model provider/model:thinking
herdr pane send-keys "$PANE_ID" enter
```

Pi, Codex, and Kimi are equally supported; take the exact launch line, model column,
and per-harness capability line for the handoff from the `run-agent-orchestration`
references (`harness-matrix.md`, `model-routing.md`).

All pane reads, text, and keys are explicit-ID-targeted and non-focusing. Prefer this
pane launch path. Do not use `herdr agent start` normally; if an environment forces
that fallback, capture the active workspace first and immediately restore `index` so
focus is never left changed.

Capture the returned workspace or tab ID plus the pane ID. Reuse the existing
workspace/tab/agent when Herdr reports the worktree is already open, or when a
tab with matching label and pane cwd exists. Reject a cwd, branch, workspace,
tab, pane, or agent-name collision rather than sending work to the wrong
checkout.

## 2. Deliver one complete handoff

Write one complete handoff with the absolute worktree, branch, scope, constraints,
verification commands, the requested `CHILD_RESULT` envelope, the exact
`PARENT_PANE_ID` (for a wave child, the root's pane in the `<wave>-root`
workspace), and the recipient harness's capability line (a kimi `--auto`
child cannot ask questions and must report blockers in its envelope). Inspect the
exact pane before delivery, then submit without waiting:

```bash
herdr agent prompt "$AGENT_NAME" "$(< /absolute/path/to/handoff.md)"
```

The parent route is mandatory: before the child stops in a terminal state (`done`,
`blocked`, or `failed`), it must notify that exact parent pane with its result envelope:

```bash
herdr agent prompt "$PARENT_PANE_ID" "CHILD_RESULT\nchild: <label>\nstatus: done | blocked | failed\nbranch/head/PR: ...\nverification: ...\nblockers: ..."
```

Use this one direct completion prompt, not a watcher, polling, or `--wait`. If it
fails, record the failure in the child's `CHILD_RESULT` and leave the child pane
available for manual reconciliation. Do not commit task-specific handoff files under
`.pi` or anywhere in the repository.

## 3. Reconcile results manually

The child must directly notify its recorded parent when it stops. On receipt, inspect
its claimed result and independently verify branch/head/status, pushed commits, PR
state, checks, and targeted tests. A later natural user turn or explicit reconciliation
tick may perform one `herdr agent get` plus recent pane read as a fallback only; never
poll or wait for a callback.

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

The visible agent must run before mutation:

```bash
pwd
git branch --show-current
git status --short --branch
```

The path and branch must match the handoff. Keep changes within scope. Run targeted
tests, lint, typechecks, and manual checks appropriate to the diff. Update required
docs, package versions, and generated artifacts before committing. Report failures
honestly.

After verification succeeds, the visible agent:

1. commits with a conventional commit message;
2. pushes the semantic branch;
3. fetches that branch and confirms its local checkout has no upstream drift (`git
   fetch origin <branch>`; `git status --short --branch`);
4. opens or updates a PR into `dev` with exact verification results and caveats.

Do not move on from a push using stale remote refs. If the fetch reveals divergence
on the child's **own feature branch**, reconcile that upstream drift deliberately in
the worktree before reporting completion. That is the only reconciliation a child
performs: a child never merges a shared branch (`dev`, `main`, an integration
branch) and never reconciles manifests or `bun.lock` — those belong to the root
session.

Opening a PR is not merge approval. The coordinator's `finish-pr` workflow owns
readiness, explicit merge confirmation, deployment verification, issue updates, and
cleanup — including closing this child's Herdr tab (wave) or workspace
(standalone) by verified ID — never the canonical root or the `index`
workspace — before removing the Git worktree, so no stale surface survives.

## 6. Reuse for fix rounds

For review or finish-pr findings, return to the same Herdr workspace or tab,
pane, and agent. Send one consolidated fix prompt under the same asymmetric handoff rule,
answer routine questions through the targeted pane, and reconcile the durable
checks/commit/push result without polling. Do not create a fresh worktree, agent, or
prompt per comment.

Parallel work uses separate visible Herdr surfaces (workspaces or wave-root
tabs) and separate Git worktrees, with one writer per worktree. The root/coordinator
session merges or reconciles those branches deliberately — children never do; never let two
agents mutate one checkout.

## 7. Manual compaction checkpoint

At a safe idle boundary, write a concise continuation checkpoint containing the exact
session, worktree/branch/head, dirty state, validation completed, and next action —
in a wave, this lives in the wave's checkpoint journal (the `coordination-loop.md`
reference of `run-agent-orchestration`).
On pi and codex, then issue `/compact` and queue one explicit continuation prompt referencing that
checkpoint; kimi has no manual compaction — resume its exact session (`kimi -S <id>`) instead. Verify the same session resumes; if the agent stops, relaunch that exact session
file/model/worktree rather than creating a duplicate writer. Never compact during a
tool, write, test, rebase, migration, merge, deployment, or structured question.

## See also

- `create-worktree` — branch, setup, Herdr-open, and collision contracts.
- `run-agent-orchestration` — multi-task waves, role profiles, model routing, and the
  full blocked-question escalation ladder across agents.
- `finish-pr` — merge approval and post-merge operations.
