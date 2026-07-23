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

- **Main agent (you)** — stays user-facing in the workspace named `index` (`wX`),
  where the user types. It owns the conversation, collects decisions, sends one
  complete wave handoff to the root orchestrator, and reports results. It never
  orchestrates worktrees or children directly.
- **Root orchestrator (exactly one)** — a visible Pi agent outside the user-facing
  `index` workspace, in the canonical root (`/Users/yanek/Projects/index`, branch
  `dev`). Sole owner for the wave of: worktree creation, child handoffs, PR finishing,
  GitHub/Linear/Railway coordination, and cleanup. It never edits source in the
  canonical root; implementation always happens in child worktrees.
- **Children** — one writer per Git worktree, each launched with a role profile chosen
  by the paths it will change (see `references/role-profiles.md`) and a model chosen at
  launch time (see `references/model-routing.md`).

## Launching the root orchestrator

Run the Herdr preflight (`herdr status server`, `herdr integration status`), then open
the canonical root without changing the user's focus and launch Pi through its targeted
root pane:

```bash
herdr worktree open --path /Users/yanek/Projects/index --label orchestration-root --no-focus --json
herdr pane send-text "$PANE_ID" "pi --model openai-codex/gpt-5.6-terra:high"
herdr pane send-keys "$PANE_ID" enter
```

The agent name must match Herdr's live-name limit `[a-z][a-z0-9_-]{0,31}` (32 chars
max) — keep the alias short (e.g. `root-orch`); the longer dashed workspace label
stays independent. Reuse an existing root orchestrator only when its cwd is the
canonical root, its branch is `dev`, and its identity belongs to this wave. Read the
visible Pi footer quota before choosing the model; never switch models
mid-implementation. All direct pane reads, text, and keys must target the exact pane
ID and must not focus it. `herdr agent start` is not the launch path for this skill.

## Fire-and-return handoffs and durable callbacks

Every tier submits a complete handoff and returns immediately:

```bash
herdr agent prompt AGENT_NAME "$(< /absolute/path/to/handoff.md)"
```

No root may use `--wait`, `herdr agent wait`, polling, sleeps, watcher processes, or
watcher panes. Before a dedicated `*-root` sends a child handoff, it calls
`register_orchestration_child_route` with that child's exact live Pi session,
workspace, pane, and worktree identity. The route is persisted bidirectionally and
fails closed when absent, stale, or ambiguous. A child has no target selector: stable
RESULT and validated RPIV blocked events can reach only its one registered root.

The project-local bridge is a private durable spool plus a best-effort local socket
wake. Root → `index` requires both a `*-root` label **and** its session/workspace/pane
checkout to equal the canonical repository root; child → root requires the exact
registered route. Events are bounded, timestamp/id ordered,
idempotent, quarantined when unsafe, and rendered as explicitly untrusted JSON data.
The consumer acknowledges only after its persistent custom message is in session
history; dispatch decisions linearize attachment against cancellation.

A received verified event coalesces to at most one non-user custom
`sendMessage({ deliverAs:"followUp", triggerTurn:true })` continuation. It wakes an
idle `index` or root, and queues one follow-up while busy; it never uses
`sendUserMessage`, reads/edits/clears the editor, focuses a workspace, or invokes
Herdr prompt APIs. `index` may present an approval request but cannot grant or infer
approval; blocked questions still need the actual user answer. A missing listener or
restart leaves the event durable for attachment on the next natural turn.
Notifications are optional visibility only. After a callback, independently reconcile
child git/tests/PR facts — a RESULT is not proof.

For long-lived roots/children, invoke `/supervised-compact` only at a verified idle
boundary with task, validation, and exact next action. It checkpoints session/worktree/
branch/head/dirty state and parent route before using Pi's compaction API, then resumes
the same session with one explicit custom continuation. Bare `/compact` is refused;
thresholds are guidance to checkpoint at milestones, not a churn loop.

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
safe/recommended choices through non-focusing, pane-ID-targeted UI (`herdr pane read
PANE_ID`, `herdr pane send-text PANE_ID`, `herdr pane send-keys PANE_ID`) — never a
new agent prompt into an active question. Genuine product/architecture ambiguity,
destructive/external mutation, credentials, or merge approval is re-raised by the root
with its **own** `ask_user_question`. The project-local bridge reference-counts that
tool's awaited lifetime and emits the same-process `herdr:blocked` lifecycle event, so
Herdr reports `blocked` until the question resolves. The bridge reference-counts nested
questions and removes its pending/claimed durable block event on tool end; an event
already attached during a truthful wait stays in history but is never replayed. Never
infer merge approval.
Full flow: `references/completion-and-questions.md`.

## Roles and models

- Role is selected per task by changed paths (`packages/protocol/**`,
  `services/api/**`, `apps/web/**`, release/review) and injected as a handoff
  checklist — no persistent personas. See `references/role-profiles.md`.
- Model is chosen at child launch time from the OpenAI-first routing table: Sol,
  Terra, and Luna are primary; Claude is quota-aware alternative capacity, while Fable
  and Kimi are reserve-only. GPT-5.5 is never used. Read the visible footer quota
  before each launch. See `references/model-routing.md`.

## Wave cleanup invariant

A finished PR is not done until its execution plane is gone: `finish-pr` must close
the child's exact Herdr workspace (verified by ID — this stops the Pi/terminal and
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
- `address-code-review` — Copilot review threads and visible fix rounds.
- `finish-pr` — readiness, explicit merge confirmation, post-merge verification, cleanup.

## See also

- `create-worktree` and `run-worktree-session` — the single-session mechanics this
  skill composes across a wave.
- `finish-pr` — merge approval and post-merge operations owned per PR.
