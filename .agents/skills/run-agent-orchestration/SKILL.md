---
name: run-agent-orchestration
description: >-
  Orchestrate a multi-task or multi-PR wave by delegating repository work from the
  user-facing main agent to exactly one visible Herdr root agent in a wave-root
  workspace nested under the index workspace, which fans out to path-roled child
  worktree sessions in named tabs of that workspace. Use when the
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
- **`root` (exactly one)** — a visible Pi, Codex, or Kimi agent in its own
  workspace nested under the user-facing `index` workspace, running in a
  dedicated coordination worktree
  (`/Users/yanek/Projects/index/.worktrees/<wave>-root` — detached at
  `origin/dev` in a direct-to-dev wave, or holding the integration branch
  `feat/<project>` in an integration-branch wave). Sole owner for the wave of:
  worktree creation, child handoffs, PR finishing, GitHub/Linear/Railway
  coordination, cleanup, and **all merge execution** — internal squash-merges
  into the integration branch, the local reconcile merge of `dev` into the
  integration branch, conflict resolution, and deliberate SemVer/lockfile
  reconciliation. It never edits *feature* source in its coordination worktree
  or the canonical root; implementation always happens in child worktrees. In
  an integration-branch wave its coordination worktree holds `feat/<project>`,
  and its only writes there are merge commits, conflict resolutions, and
  deliberate SemVer/manifest/`bun.lock` reconciliation commits.
  Canonical-root-dependent operations (e.g. post-merge `git pull --ff-only` of
  `dev`) run via `git -C /Users/yanek/Projects/index …` and stay read-only or
  fast-forward-only.
- **`child`** — one writer per Git worktree, running in a named tab of the
  root's workspace (tab label = the dashed worktree folder), each launched on
  any of the three harnesses with a role profile chosen by the paths it will change or the
  release/review task type (see `references/role-profiles.md`) and a model chosen at
  launch time (see `references/model-routing.md`). Children never merge and
  never reconcile manifests — they implement, verify, push their own branch,
  and open PRs.

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

Every wave-created Herdr surface must be reachable from `index`: the root
workspace nests under `index` in the sidebar, and every child is a named tab of
the root workspace — nothing wave-related may appear as a top-level sidebar
workspace. Herdr nests a workspace under `index` only when it carries
linked-worktree metadata, so the root runs in a dedicated **detached
coordination worktree**, opened without changing the user's focus:

```bash
ROOT=$(git rev-parse --show-toplevel)      # canonical root, on dev
WAVE=<wave-slug>                           # e.g. mcp-refactoring
ROOT_WT="$ROOT/.worktrees/${WAVE}-root"
git fetch origin dev
# Direct-to-dev wave: detached coordination worktree.
git worktree add --detach "$ROOT_WT" origin/dev
# Integration-branch wave: the coordination worktree IS the integration-branch
# checkout (still a normal linked worktree, so the nesting invariant holds):
# git worktree add -b feat/<project> "$ROOT_WT" origin/dev
herdr worktree open --path "$ROOT_WT" --label "${WAVE}-root" --no-focus --json
```

Record `ROOT_WS_ID` (`.result.workspace.workspace_id`), `ROOT_TAB_ID`
(`.result.tab.tab_id`), and `ROOT_PANE_ID` (`.result.root_pane.pane_id`) in the
checkpoint journal — child tabs are created against `ROOT_WS_ID`. Then rename
the default tab and launch the chosen harness through the targeted root pane,
using the launch line from `references/harness-matrix.md`:

```bash
herdr tab rename "$ROOT_TAB_ID" "${WAVE}-root"
herdr pane send-text "$ROOT_PANE_ID" "<launch line from harness-matrix.md>"
herdr pane send-keys "$ROOT_PANE_ID" enter
```

**Nesting invariant (mandatory):** the `worktree open` JSON must report
`.result.workspace.worktree.is_linked_worktree == true` with `repo_root` equal
to the canonical root. If that metadata is absent the workspace will sit as a
top-level sidebar orphan — close it and re-open correctly instead of
proceeding.

**Hard prohibitions:** never run `herdr worktree open --path` against the
canonical root itself — Herdr dedupes it into the user's `index` workspace and
renames it (recover with `herdr workspace rename <INDEX_WS_ID> index`). Never
create wave surfaces with `herdr workspace create --cwd`; it records no
worktree metadata and produces a permanent top-level orphan.

The root's coordination worktree — detached at `origin/dev` in a direct-to-dev
wave, holding `feat/<project>` in an integration-branch wave — is never a place
to edit feature source; its only writes are the integration-branch merge and
reconciliation commits described above, and repo-wide `git`/`gh`/Linear/Herdr
commands work normally from it. The agent name must match Herdr's live-name limit
`[a-z][a-z0-9_-]{0,31}` (32 chars max) — keep the alias short (e.g.
`root-orch`); the longer dashed workspace label stays independent. Reuse an
existing root only when its cwd is this wave's coordination worktree and its
identity belongs to this wave. Read the visible agent's quota/status before
choosing the model; never switch models mid-implementation. All direct pane
reads, text, and keys must target the exact pane ID and must not focus it.
`herdr agent start` is not the launch path for this skill.

## Launching children

A wave child's execution plane is a **named tab of the root workspace**, not a
new workspace. After `create-worktree`'s Git-worktree and setup steps for
`$WORKTREE`/`$FOLDER`:

```bash
herdr tab create --workspace "$ROOT_WS_ID" --cwd "$WORKTREE" \
  --label "$FOLDER" --no-focus
```

The tab label is exactly the dashed worktree folder. Record the returned
`.result.tab.tab_id` and `.result.root_pane.pane_id` in the checkpoint
journal's child map; all handoffs, pane reads, and answers target that pane ID.
Launch the harness through the pane as usual. One writer per worktree is
unchanged: before creating a tab, verify no existing tab or agent already owns
`$WORKTREE` (`herdr tab list` plus pane cwds via `herdr pane get`), and reuse
an existing tab only when its label is `$FOLDER` and its pane cwd is
`$WORKTREE`.

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
  checklist — no persistent personas. See `references/role-profiles.md`. Root owns
  internal merges in an integration-branch wave; a `release-review` child may be
  added for an advisory verification pass, but it never merges.
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
  one `feat/<project>` branch, and root squash-merges them into it from its own
  integration-branch worktree; CI does not run on internal PRs, so root's local
  gates replace it; the branch is promoted to `dev` as one PR at wave end. Full
  contract: `references/integration-branch-waves.md`.

## Wave cleanup invariant

A finished PR is not done until its execution plane is gone: `finish-pr` must
close the child's exact Herdr tab (`herdr tab close <TAB_ID>`, verified by ID —
this stops the agent/terminal) **and** remove its Git worktree, in that order.
Removing the worktree without closing the tab leaves idle agents behind. In an
integration-branch wave, held PRs keep their tab and worktree until they merge
or are deliberately abandoned (see `references/integration-branch-waves.md`).
After the wave, the root verifies with `herdr tab list` and
`herdr workspace list` that no finished child tabs or wave workspaces remain —
but never sweeps unrelated active workspaces, and keeps the root workspace (the
dedicated execution/coordination plane) until the user explicitly ends the
wave. When the wave ends, close the root workspace, then remove its
coordination worktree, in that order:

```bash
herdr workspace close "$ROOT_WS_ID"
git worktree remove "$ROOT/.worktrees/${WAVE}-root"
```

In an integration-branch wave the coordination worktree holds `feat/<project>`,
so it is removed only after the promotion PR is merged, and the integration
branch is deleted after that.

**Migration/repair:** a top-level orphan workspace from an older wave whose
worktree still exists is repaired opportunistically — verify its agent is
settled and its state captured, close the orphan workspace, then re-create the
surface correctly (a named tab in the wave root, or a `herdr worktree open`
workspace when standalone).

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
