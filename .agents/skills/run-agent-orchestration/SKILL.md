---
name: run-agent-orchestration
description: >-
  Orchestrate a multi-task or multi-PR wave by delegating repository work from the
  user-facing main agent to exactly one visible Herdr root agent in the
  canonical root, which fans out to path-roled child worktree sessions. Use when the
  user asks for several coordinated Index changes/PRs at once, for delegated
  orchestration, for an integration-branch (internal finish-pr) wave, or when harness
  recommendation, role profiles, model routing, or blocked structured-question
  escalation across Herdr agents are needed.
---

# run-agent-orchestration

One user-facing **`main`** agent delegates repository orchestration to **exactly
one** visible Herdr **`root`**. The root fans work out to **`child`** Pi, Codex, or
Kimi sessions in isolated worktrees selected by path and task-type role profiles —
not long-lived frontend/backend/protocol personas.

## Topology and terminology (fixed vocabulary)

The three tiers are canonical names — use them verbatim in handoffs, envelopes, and
the checkpoint journal, and state the recipient's tier in every handoff ("You are a
child…", "You are the root for wave X"):

- **`main`** — the user-facing agent in the workspace named `index` (`wX`), where
  the user types. It owns the conversation, collects decisions, recommends the
  root's harness and model, sends one complete wave handoff to the root, ticks the
  root, and reports results. It never orchestrates worktrees or children directly.
- **`root` (exactly one)** — a visible Pi, Codex, or Kimi agent outside the
  user-facing `index` workspace, in the canonical root
  (`/Users/yanek/Projects/index`, branch `dev`). Sole owner for the wave of:
  worktree creation, child handoffs, PR finishing, GitHub/Linear/Railway
  coordination, and cleanup. It never edits source in the canonical root;
  implementation always happens in child worktrees.
- **`child`** — one writer per Git worktree, each launched on any of the three
  harnesses with a role profile chosen by the paths it will change or the
  release/review task type (see `references/role-profiles.md`) and a model chosen at
  launch time (see `references/model-routing.md`).

All three harnesses are equal at every tier; per-harness launch lines, capabilities,
and tool mappings live in `references/harness-matrix.md`.

## Wave kickoff: recommend harness, model, and wave mode

Before launching the root, `main`:

1. runs the Herdr preflight (`herdr status server`, `herdr integration status`);
2. consults `references/harness-matrix.md` and `references/model-routing.md`, plus
   the visible quota footer where the candidate harness shows one;
3. asks the user **one** `ask_user_question` covering: the root's harness
   (pi/codex/kimi) and model — recommended option first, labelled
   "(Recommended)" — and the wave mode: direct-to-dev PRs, or a single
   integration branch (recommend the latter for 3+ dependent sub-issues; see
   `references/integration-branch-waves.md`);
4. records the choices, any user override, the version floor, and the merge
   authorization scope in the wave handoff and the checkpoint journal
   (`references/coordination-loop.md`).

A user override always wins and holds for the whole wave.

## Launching the root

Open the canonical root without changing the user's focus and launch the chosen
harness through its targeted root pane, using the launch line from
`references/harness-matrix.md`:

```bash
herdr worktree open --path /Users/yanek/Projects/index --label orchestration-root --no-focus --json
herdr pane send-text "$PANE_ID" "<launch line from harness-matrix.md>"
herdr pane send-keys "$PANE_ID" enter
```

The agent name must match Herdr's live-name limit `[a-z][a-z0-9_-]{0,31}` (32 chars
max) — keep the alias short (e.g. `root-orch`); the longer dashed workspace label
stays independent. Reuse an existing root only when its cwd is the canonical root,
its branch is `dev`, and its identity belongs to this wave. Read the visible agent's
quota/status before choosing the model; never switch models mid-implementation. All
direct pane reads, text, and keys must target the exact pane ID and must not focus
it. `herdr agent start` is not the launch path for this skill.

## Coordination loop

`main` ticks `root`; `root` ticks its children; corrections flow strictly down-tier
(`main` → `root` → `child`, never `main` → `child`). Every tick follows the bounded
algorithm in `references/coordination-loop.md`: re-read contracts, identity pass,
bounded pane reads, independent git/PR/test verification, at most one consolidated
corrective prompt, then update the wave's **checkpoint journal**
(`/tmp/<wave-slug>-orchestration-checkpoint.md`) — the durable wave state that
survives compaction and session restarts. When `main` or `root` runs on Pi, run the
wave under an active `/goal` and mirror wave state in the `todo` tool with
`blockedBy` sequencing.

## Fire-and-return parent coordination

Every tier submits one complete handoff without `--wait` and returns immediately. Each
handoff records the exact parent pane ID; a child must send that pane one concise
terminal-state result prompt before it stops:

```bash
herdr agent prompt AGENT_NAME "$(< /absolute/path/to/handoff.md)"
```

Do not use `herdr agent wait`, polling, sleeps, watcher processes, or watcher panes.
The completion notification is direct and single-shot; it is not a watcher or proof of
success. Parents independently verify worktree, git, tests, PR, and deployment state
before acting. If the notification fails, a later natural user turn or explicit tick
performs one read-only status/recent-output pass as a fallback.

Structured questions are handled only after an explicit status tick observes the
child as blocked. Never infer approval or treat a settled state as success.

## Settled states are not success

`idle` and `done` are both settled states (`done` is unseen idle after background
work); `blocked` means Herdr recognized an approval or question UI — inspect the
active pane UI. A settled state is **not** proof of success: read the transcript and
verify the git/PR/test facts (branch head, pushed commits, PR number, checks, targeted
tests) before reporting to the user.

Require every child to end with a concise **structured result envelope** and send the
same envelope to its recorded parent pane before stopping: status, branch/head/PR,
verification performed, unresolved blockers. If the direct notification or transcript
read fails, fall back to asking the agent for a report file in a temp directory — never
request file output in the initial prompt. Full contract:
`references/completion-and-questions.md`.

## Structured questions propagate, not stall

On an explicit coordination tick, inspect any child reported as `blocked`. Answer
routine safe choices through exact pane-targeted UI. Re-raise genuine product or
architecture ambiguity, destructive/external mutation, credentials, or merge approval
with the root's own `ask_user_question`. No background callback exists, so report this
temporary limitation plainly and never fabricate an answer.

## Roles, models, and harnesses

- Role is selected per task by changed paths (`packages/protocol/**`,
  `services/api/**`, `apps/web/**`) or by release/review activity and injected as a handoff
  checklist — no persistent personas. See `references/role-profiles.md`. An
  integration-branch wave adds one **integration-owner** child that owns internal
  merges for the whole wave.
- Model is chosen at child launch time from the role × harness routing table in
  `references/model-routing.md`. On codex, Sol/Terra/Luna are primary and GPT-5.5 is
  never used; on pi, Claude Opus/Sonnet/Haiku are the working set; on kimi, the K3
  aliases. Read the visible footer quota (codex) before each launch.
- Every handoff embeds the recipient harness's capability line from
  `references/harness-matrix.md` (e.g. a kimi `--auto` child cannot ask questions
  and must report blockers in its envelope).

## Wave modes

- **Direct-to-dev** (default for independent tasks): each child PR targets `dev` and
  is finished with the full `finish-pr` workflow.
- **Integration branch** (recommended for 3+ dependent sub-issues): child PRs target
  one `feat/<project>` branch and merge internally via the integration-owner child;
  CI does not run on internal PRs, so root's local gates replace it; the branch is
  promoted to `dev` as one PR at wave end. Full contract:
  `references/integration-branch-waves.md`.

## Wave cleanup invariant

A finished PR is not done until its execution plane is gone: `finish-pr` must close
the child's exact Herdr workspace (verified by ID — this stops the agent/terminal and
removes the stale sidebar entry) **and** remove its Git worktree, in that order.
Removing the worktree without closing the workspace leaves idle agents visible in
the sidebar. In an integration-branch wave, held PRs keep their workspace and
worktree until they merge or are deliberately abandoned (see
`references/integration-branch-waves.md`). After the wave, the root verifies with
`herdr workspace list` that no finished child workspaces/agents remain — but never
sweeps unrelated active workspaces, and keeps the root workspace (the
dedicated execution/coordination plane) unless the user explicitly ends the wave.

## Sub-workflows the root runs

The root does not re-implement session mechanics; it invokes the existing
skills:

- `create-worktree` — worktree/workspace/agent identity contracts per child.
- `run-worktree-session` — single-session fire-and-return handoff, question handling, fix loops.
- `finish-pr` — readiness, explicit merge confirmation, post-merge verification, cleanup;
  its internal mode governs PRs whose base is an integration branch.

## See also

- `references/harness-matrix.md` — launch lines, capabilities, and tool mappings for
  pi/codex/kimi at every tier.
- `references/coordination-loop.md` — the tick algorithm and checkpoint journal.
- `references/integration-branch-waves.md` — internal finish-pr wave mode.
- `create-worktree` and `run-worktree-session` — the single-session mechanics this
  skill composes across a wave.
- `finish-pr` — merge approval and post-merge operations owned per PR.
