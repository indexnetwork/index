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
visible Herdr root orchestrator. The root orchestrator fans work out to child Pi
sessions in isolated worktrees selected by path-triggered role profiles — not
long-lived frontend/backend/protocol personas.

## Topology

- **Main agent (you)** — stays user-facing. Owns the user conversation, collects
  decisions, sends one complete wave handoff to the root orchestrator, waits, and
  reports results. Never orchestrates worktrees or children directly.
- **Root orchestrator (exactly one)** — a visible Pi agent in the canonical root
  (`/Users/yanek/Projects/index`, branch `dev`). Sole owner for the wave of: worktree
  creation, child handoffs, PR finishing, GitHub/Linear/Railway coordination, and
  cleanup. It never edits source in the canonical root; implementation always happens
  in child worktrees.
- **Children** — one writer per Git worktree, each launched with a role profile chosen
  by the paths it will change (see `references/role-profiles.md`) and a model chosen at
  launch time (see `references/model-routing.md`).

## Launching the root orchestrator

Run the Herdr preflight (`herdr status server`, `herdr integration status`), then open
the canonical root as a workspace and start one Pi agent in its root pane:

```bash
herdr worktree open --path /Users/yanek/Projects/index --label root --focus --json
herdr agent start root-orch --kind pi --pane "$PANE_ID" -- --model anthropic/claude-fable-5:high
```

The agent name must match Herdr's live-name limit `[a-z][a-z0-9_-]{0,31}` (32 chars
max) — keep the alias short (e.g. `root-orch`); the longer dashed workspace label
stays independent. Reuse an existing root orchestrator only when its cwd is the
canonical root, its branch is `dev`, and its identity belongs to this wave. Read the
visible Pi footer quota before choosing the model; never switch models
mid-implementation.

## Handoffs and waits (event-driven, never `sleep`)

Both hops — main → root orchestrator and root orchestrator → child — use **one
complete handoff** followed by **event-driven Herdr waits**:

```bash
herdr agent prompt root-orch "$(< /absolute/path/to/wave-handoff.md)" --wait
```

- `agent prompt --wait` is atomic (text + encoded Enter, honoring bracketed paste) and
  waits for the first settled `idle`, `done`, or `blocked` state. Do not repeat those
  defaults with `--until`. A handoff sent from a non-working state must show activity
  within five seconds or Herdr returns `agent_prompt_stalled`.
- **NEVER use `sleep` to poll Herdr agents.** Waits are server-owned; `sleep` polling
  is banned at every tier.
- For an already-running agent (follow-up after a timeout checkpoint or a resolved
  question), use `herdr agent wait NAME --timeout <ms>`. A timeout is a checkpoint,
  not a failure — read new output and wait again.
- For parallel children, issue multiple `herdr agent prompt NAME "..." --wait` tool
  calls in one turn so the server-owned waits run concurrently. Do not create a
  background watcher process or watcher pane.

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

When a child is `blocked`, the root orchestrator reads its pane and answers routine
safe/recommended choices through targeted pane UI (`pane read`, `pane send-text`,
`pane send-keys`) — never a new agent prompt into an active question. Genuine
product/architecture ambiguity, destructive/external mutation, credentials, or merge
approval is re-raised by the root orchestrator with its **own** `ask_user_question`,
which makes the root `blocked`, returns the main agent's wait, and safely propagates
to the user. Never infer merge approval. Full flow:
`references/completion-and-questions.md`.

## Roles and models

- Role is selected per task by changed paths (`packages/protocol/**`,
  `services/api/**`, `apps/web/**`, release/review) and injected as a handoff
  checklist — no persistent personas. See `references/role-profiles.md`.
- Model is chosen at child launch time from the balanced routing table
  (GPT-5.6 Sol/Terra/Luna and Claude variants — never GPT-5.5), reading visible footer
  quota first. See `references/model-routing.md`.

## Wave cleanup invariant

A finished PR is not done until its execution plane is gone: `finish-pr` must close
the child's exact Herdr workspace (verified by ID — this stops the Pi/terminal and
removes the stale sidebar entry) **and** remove its Git worktree, in that order.
Removing the worktree without closing the workspace leaves idle agents visible in
the sidebar. After the wave, the root orchestrator verifies with
`herdr workspace list` that no finished child workspaces/agents remain — but never
sweeps unrelated active workspaces, and keeps the root orchestrator workspace (the
user-facing coordination plane) unless the user explicitly ends the wave.

## Sub-workflows the root orchestrator runs

The root orchestrator does not re-implement session mechanics; it invokes the existing
skills:

- `create-worktree` — worktree/workspace/agent identity contracts per child.
- `run-worktree-session` — single-session handoff, waits, question handling, fix loops.
- `address-code-review` — Copilot review threads and visible fix rounds.
- `finish-pr` — readiness, explicit merge confirmation, post-merge verification, cleanup.

## See also

- `create-worktree` and `run-worktree-session` — the single-session mechanics this
  skill composes across a wave.
- `finish-pr` — merge approval and post-merge operations owned per PR.
