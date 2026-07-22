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
herdr worktree open --path /Users/yanek/Projects/index --label root --no-focus --json
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

## Asymmetric handoffs and waits (event-driven, never `sleep`)

The user-facing main session in `index` (`wX`) and the dedicated root/child execution
plane have deliberately different contracts:

- **Main → root:** the `index` session must never run `herdr agent prompt --wait` or
  `herdr agent wait`. Submit the complete handoff without `--wait` and return
  immediately:

  ```bash
  herdr agent prompt ROOT_AGENT_NAME "$(< /absolute/path/to/wave-handoff.md)"
  ```

  Resume by inspecting root state only on a later natural user turn or an explicit
  orchestration tick. This main-path rule permits no polling, sleeps, watchers, or
  timeout loops.
- **Root → child:** dedicated root orchestrators and implementation children run
  outside `index`. The root may and should use exactly one server-owned, indefinite
  wait for each complete child handoff:

  ```bash
  herdr agent prompt CHILD_NAME "..." --wait
  ```

  `agent prompt --wait` is atomic (text + encoded Enter, honoring bracketed paste) and
  waits for the first settled `idle`, `done`, or `blocked` state. Do not add
  `--timeout` or `--until`. Children signal through a structured question (`blocked`)
  or a final `RESULT` envelope.
- After a targeted pane answer resolves a question, let the child continue to its
  structured `RESULT`; do not add `herdr agent wait`, timeout checkpoints, or retry
  loops to this flow.
- For parallel children, issue multiple complete `herdr agent prompt NAME "..."
  --wait` tool calls in one turn so the server-owned waits run concurrently. Do not
  create a background watcher process or watcher pane.
- **NEVER use `sleep` to poll Herdr agents.** Sleep polling, watcher processes, and
  timeout loops are banned at every tier.

## Durable attach-next-turn bridge

The project-local `.pi/extensions/orchestration-bridge.ts` is the only root → main
callback path. A dedicated root publishes both a final `RESULT` (through
`publish_orchestrator_event` with a stable event id) and genuine blocked-question
events (automatically when `ask_user_question` starts). The publisher resolves the
unique live workspace labeled `index` and its reported Pi session identity through
Herdr metadata; it never hardcodes a main agent name or reads terminal pixels.

It atomically persists each structured event — id, `result`/`blocked` kind, root
workspace/pane/session provenance, concise summary, timestamp, and optional durable
result location/payload — into the private project-local per-session spool before one
best-effort Unix-socket wake attempt. Publication is idempotent by event id. A missing
listener leaves the event durable for the next natural turn; there are no retries,
polls, sleeps, watcher processes, or waits.

The trusted `index` session starts that socket listener only at `session_start`, closes
and unlinks it at `session_shutdown`, and may update only a non-focusing inbox
widget/status on receipt. It never edits the editor, starts a turn, focuses a workspace,
or calls `herdr agent prompt`/`wait`. On `before_agent_start` for the user's next
natural submission, it atomically claims outstanding events and adds a persistent
custom `ORCHESTRATOR_EVENT` message to that turn. Claims replay at least once after a
crash and are acknowledged by event id once their custom message is present, so events
are neither silently lost nor duplicated.

Herdr 0.7.5 notifications are optional visibility alerts only: `notification.show`
has no persistent inbox and a disabled toast cannot resume Pi. The bridge is not a
toast and does not use screen scraping. Its structured custom messages carry event
details, while append-only `orchestration:record` entries reconstruct and dedupe
acknowledged delivery without parsing rendered text. The inbox is a persistent
above-editor widget, not an auto-turn.

The `pi-subagents` precedent is intentionally partial: its structured custom renderer,
widget, and append-only records are reused, but its
`pi.sendMessage({ deliverAs:"followUp", triggerTurn:true })` is not — that would
start the parent automatically. Its cross-extension RPC/events, like `pi.events`, are
same-process only; Herdr roots and `index` are distinct visible Pi processes. The
private spool plus one local socket wake remains the only cross-process transport, and
visible Herdr writers are never replaced with hidden subagents. Project-local
extensions load only after the project is trusted; after this code is installed or
updated, reload both the root and `index` Pi sessions so the matching runtime extension
is active. Never clear, overwrite, or infer safety of a user draft; never focus
`index`; and never wait from `index`.

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
Herdr reports `blocked` until the question resolves; it also durably publishes the
blocked event for attach-next-turn delivery to `index`. Never infer merge approval.
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
