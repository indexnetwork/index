---
name: run-agent-orchestration
description: >-
  Orchestrate a multi-task or multi-PR wave by delegating repository work from the
  user-facing main agent to exactly one visible Herdr root orchestrator in the
  canonical root, which fans out to path-roled child worktree sessions. Use when the
  user asks for several coordinated Index changes/PRs at once, for delegated
  orchestration, or when role profiles, model routing, or blocked structured-question
  escalation across Herdr agents are needed.
---

# run-agent-orchestration

One user-facing main agent delegates repository orchestration to **exactly one**
visible Herdr root orchestrator. The root orchestrator fans work out to child Pi or Codex
sessions in isolated worktrees selected by path and task-type role profiles — not
long-lived frontend/backend/protocol personas.

## Topology

- **Main agent (you)** — stays user-facing in the workspace named `index` (`wX`),
  where the user types. It owns the conversation, collects decisions, sends one
  complete wave handoff to the root orchestrator, and reports results. It never
  orchestrates worktrees or children directly.
- **Root orchestrator (exactly one)** — a visible Pi or Codex agent outside the user-facing
  `index` workspace, in the canonical root (`/Users/yanek/Projects/index`, branch
  `dev`). Sole owner for the wave of: worktree creation, child handoffs, PR finishing,
  GitHub/Linear/Railway coordination, and cleanup. It never edits source in the
  canonical root; implementation always happens in child worktrees.
- **Children** — one writer per Git worktree, each launched with a role profile chosen
  by the paths it will change or the release/review task type (see `references/role-profiles.md`) and a model chosen at
  launch time (see `references/model-routing.md`).

## Launching the root orchestrator

Run the Herdr preflight (`herdr status server`, `herdr integration status`), then open
the canonical root without changing the user's focus and launch Codex (or Pi) through its targeted
root pane:

```bash
herdr worktree open --path /Users/yanek/Projects/index --label orchestration-root --no-focus --json
herdr pane send-text "$PANE_ID" "codex" # Pi is also supported
herdr pane send-keys "$PANE_ID" enter
```

The agent name must match Herdr's live-name limit `[a-z][a-z0-9_-]{0,31}` (32 chars
max) — keep the alias short (e.g. `root-orch`); the longer dashed workspace label
stays independent. Reuse an existing root orchestrator only when its cwd is the
canonical root, its branch is `dev`, and its identity belongs to this wave. Read the
visible agent's quota/status before choosing the model; never switch models
mid-implementation. All direct pane reads, text, and keys must target the exact pane
ID and must not focus it. `herdr agent start` is not the launch path for this skill.

## Fire-and-return manual coordination (temporary)

The project-local orchestration bridge has been removed pending a dedicated refactor.
Every tier submits one complete handoff without `--wait` and returns immediately:

```bash
herdr agent prompt AGENT_NAME "$(< /absolute/path/to/handoff.md)"
```

Do not use `herdr agent wait`, polling, sleeps, watcher processes, or watcher panes.
There is currently no automatic cross-session callback. The user-facing `index`
session explicitly ticks the root on a later natural turn; the root then performs one
read-only status/recent-output pass over its owned children and continues actionable
work. Children end with a concise `RESULT` in their pane, but the coordinator must
independently verify worktree, git, tests, PR, and deployment state before acting.

Structured questions are handled only after an explicit status tick observes the
child as blocked. Never infer approval or treat a settled state as success.

## Settled states are not success

`idle` and `done` are both settled states (`done` is unseen idle after background
work); `blocked` means Herdr recognized an approval or question UI — inspect the
active pane UI. A settled state is **not** proof of success: read the transcript and
verify the git/PR/test facts (branch head, pushed commits, PR number, checks, targeted
tests) before reporting to the user.

Require every child to end with a concise **structured result envelope**: status,
branch/head/PR, verification performed, unresolved blockers. If transcript rows are
missing (alternate-screen rendering), fall back to asking the agent for a report file
in a temp directory — never request file output in the initial prompt. Full contract:
`references/completion-and-questions.md`.

## Structured questions propagate, not stall

On an explicit coordination tick, inspect any child reported as `blocked`. Answer
routine safe choices through exact pane-targeted UI. Re-raise genuine product or
architecture ambiguity, destructive/external mutation, credentials, or merge approval
with the root's own `ask_user_question`. No background callback exists, so report this
temporary limitation plainly and never fabricate an answer.

## Roles and models

- Role is selected per task by changed paths (`packages/protocol/**`,
  `services/api/**`, `apps/web/**`) or by release/review activity and injected as a handoff
  checklist — no persistent personas. See `references/role-profiles.md`.
- Model is chosen at child launch time from the OpenAI-first routing table: Sol,
  Terra, and Luna are primary; Claude is quota-aware alternative capacity, while Fable
  and Kimi are reserve-only. GPT-5.5 is never used. Read the visible footer quota
  before each launch. See `references/model-routing.md`.

## Wave cleanup invariant

A finished PR is not done until its execution plane is gone: `finish-pr` must close
the child's exact Herdr workspace (verified by ID — this stops the agent/terminal and
removes the stale sidebar entry) **and** remove its Git worktree, in that order.
Removing the worktree without closing the workspace leaves idle agents visible in
the sidebar. After the wave, the root orchestrator verifies with
`herdr workspace list` that no finished child workspaces/agents remain — but never
sweeps unrelated active workspaces, and keeps the root orchestrator workspace (the
dedicated execution/coordination plane) unless the user explicitly ends the wave.

## Sub-workflows the root orchestrator runs

The root orchestrator does not re-implement session mechanics; it invokes the existing
skills:

- `create-worktree` — worktree/workspace/agent identity contracts per child.
- `run-worktree-session` — single-session fire-and-return handoff, question handling, fix loops.
- `finish-pr` — readiness, explicit merge confirmation, post-merge verification, cleanup.

## See also

- `create-worktree` and `run-worktree-session` — the single-session mechanics this
  skill composes across a wave.
- `finish-pr` — merge approval and post-merge operations owned per PR.
