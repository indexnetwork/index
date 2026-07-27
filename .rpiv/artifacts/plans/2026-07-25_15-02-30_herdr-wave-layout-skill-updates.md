# Plan: Herdr wave layout — nest roots under `index`, children as named root tabs

**Status:** approved layout, not yet implemented
**Skills affected:** `run-agent-orchestration`, `create-worktree`, `run-worktree-session`, `finish-pr` (all under `.agents/skills/`)
**Decision owner:** user (confirmed via live demo `demo-wave-root`, 2026-07-25)

## Problem

During orchestration waves, the Herdr sidebar fills with top-level orphan
workspaces (`*-root` coordinators, plus child worktree workspaces such as
`fix-preserve-proposal-analysis`) that do not collapse under the main `index`
workspace. Only some children (e.g. `feat-mcp-refactoring`) nest correctly.

## Verified Herdr mechanics (basis for every change below)

All verified live against the running Herdr server (protocol 17):

1. **Sidebar nesting is repo-grouping via worktree metadata, one level deep.**
   A workspace nests under the repo-root workspace (`index`) iff it carries
   `worktree` metadata (`is_linked_worktree: true`, `repo_root` = canonical
   root). This metadata is recorded **only** by `herdr worktree open/create
   --path <linked-worktree>`. There is no deeper nesting, no parent/group
   concept in the API, and the sidebar renders **workspaces only — never tabs**.
2. **`herdr workspace create --cwd …` records no worktree metadata** → produces
   a permanent top-level orphan even when the cwd is a real worktree. This is
   how the orphaned child workspaces were created (agent drift from the skill
   text).
3. **The canonical root cannot host a second workspace.** `herdr worktree open
   --path <canonical root>` dedupes into the existing `index` workspace and
   **renames it** to the given `--label` (observed live: it hijacked and
   renamed the user's main workspace). The current `run-agent-orchestration`
   root-launch line is therefore structurally broken: it either orphans or
   hijacks.
4. **`herdr worktree open --workspace <ID>` does not open into that workspace**
   — it still creates a new workspace. The `--workspace` flag is not a
   tab-open mechanism.
5. **Named tabs work:** `herdr tab create --workspace <WS_ID> --cwd <path>
   --label <name> --no-focus` creates a labeled tab with its own root pane
   (returns `tab_id`, `pane_id`). `herdr tab rename <TAB_ID> <label>` renames
   an existing tab (works for the default tab `1`). `herdr tab close <TAB_ID>`
   closes one tab.
6. **A detached worktree nests.** `git worktree add --detach
   .worktrees/<name> origin/dev` + `herdr worktree open --path …` yields a
   workspace with full worktree metadata that collapses under `index`.

## Approved target layout (Variant 1)

```text
Sidebar:
▾ ● index                        ← main workspace; `main` agent is a tab here
    dev
  ● <wave>-root                  ← root workspace; detached worktree .worktrees/<wave>-root
  ● <standalone worktree ws>     ← only for non-wave sessions opened directly

<wave>-root tab bar:
[<wave>-root] [feat-…-child-a] [fix-…-child-b]
  ^ tab 1 renamed to the wave label; each child = named tab, cwd = child worktree
```

- `main` stays a tab of the `index` workspace (unchanged).
- **Root**: one detached worktree per wave at `.worktrees/<wave>-root`, opened
  as a workspace → nests under `index`. Its default tab `1` is renamed to
  `<wave>-root`.
- **Children**: named tabs **inside the root workspace**, label = dashed
  worktree folder, cwd = the child's Git worktree. One writer per worktree
  still holds; the Git worktree itself is still created per `create-worktree`.
- Accepted trade-off (user-confirmed): child tabs have no sidebar rows, branch
  sublabels, or per-child sidebar status dots; the root workspace's aggregate
  status dot reflects its children.

## Skill changes

### 1. `run-agent-orchestration/SKILL.md`

**"Launching the root" section — full rewrite.**

Replace the current launch snippet (`herdr worktree open --path <canonical
root> --label orchestration-root`) with the wave-root worktree contract:

```bash
ROOT=$(git rev-parse --show-toplevel)          # canonical root, on dev
WAVE=<wave-slug>                                # e.g. mcp-refactoring
ROOT_WT="$ROOT/.worktrees/${WAVE}-root"
git fetch origin dev
git worktree add --detach "$ROOT_WT" origin/dev
herdr worktree open --path "$ROOT_WT" --label "${WAVE}-root" --no-focus --json
herdr tab rename "$ROOT_TAB_ID" "${WAVE}-root"   # rename default tab "1"
# then launch the chosen harness in the returned root pane (harness-matrix.md)
```

Required prose changes:

- Record `ROOT_WS_ID`, `ROOT_TAB_ID`, `ROOT_PANE_ID` from the open JSON and
  keep them in the checkpoint journal (children need `ROOT_WS_ID`).
- **Nesting invariant (new, mandatory):** after `worktree open`, assert the
  returned `.result.workspace.worktree.is_linked_worktree == true` and
  `repo_root == ROOT`. If the metadata is absent, the workspace will orphan —
  close it and re-open correctly instead of proceeding.
- **Hard prohibitions (new):** never run `herdr worktree open --path
  <canonical root>` (it renames/hijacks the user's `index` workspace — if it
  happens, immediately `herdr workspace rename <INDEX_WS_ID> index`); never
  create wave workspaces via `herdr workspace create --cwd`.
- The root's worktree is a **coordination checkout**, detached at `origin/dev`:
  the root still never edits source there; repo-wide git/gh/linear/herdr
  commands work normally from it. Canonical-root-dependent operations (e.g.
  post-merge `git pull` of `dev`) run via `git -C "$ROOT" …`.
- Update the "outside the user-facing `index` workspace" wording: the root is
  a **separate workspace nested under `index`**, never a tab of `index` and
  never the `index` workspace itself.
- Reuse rule: reuse an existing `<wave>-root` workspace only when its cwd is
  the wave's root worktree and its identity belongs to this wave.

**"Launching children" (new subsection; today implied via `create-worktree`).**

Children in a wave are named tabs of the root workspace:

```bash
# after create-worktree's git-worktree + setup steps for $WORKTREE/$FOLDER:
herdr tab create --workspace "$ROOT_WS_ID" --cwd "$WORKTREE" \
  --label "$FOLDER" --no-focus
# record .result.tab.tab_id and .result.root_pane.pane_id, then launch the harness
```

- Tab label = dashed folder (= worktree name), exactly.
- Record per-child `TAB_ID` + `PANE_ID` in the checkpoint journal; all
  handoffs, pane reads, and answers target that pane ID.
- One writer per worktree unchanged: before creating a tab, verify no other
  tab/agent already owns `$WORKTREE` (`herdr tab list` + pane cwds via
  `herdr api snapshot` or `herdr pane get`).

**"Wave cleanup invariant" section — rework to tab semantics.**

- A finished child's execution plane = its **tab**: `finish-pr` must close the
  child's exact tab (`herdr tab close <TAB_ID>`, verified by ID) **and** remove
  its Git worktree, in that order.
- At wave end (user explicitly ends the wave): close the root workspace
  (`herdr workspace close <ROOT_WS_ID>`), then `git worktree remove
  "$ROOT_WT"` (detached — safe to remove; nothing to push).
- Post-wave verification: `herdr workspace list` shows no leftover wave
  workspaces **and** `herdr tab list` shows no leftover child tabs; never
  sweep unrelated workspaces.
- **Migration/repair note (new):** for pre-existing top-level orphan
  workspaces from older waves whose worktree still exists — verify the agent
  is settled and its state is captured, close the orphan workspace, and
  re-create it as a named tab in the wave root (or as a `worktree open`
  workspace when standalone).

**Checkpoint journal (references/coordination-loop.md):** add
`ROOT_WS_ID`/`ROOT_TAB_ID`/`ROOT_PANE_ID` and per-child `TAB_ID`/`PANE_ID` to
the recorded wave state.

### 2. `run-agent-orchestration/references/harness-matrix.md`

- Line 12 ("Always launch through the exact, non-focusing pane ID returned by
  `herdr worktree open --no-focus --json`") → generalize: the pane ID comes
  from `herdr worktree open` (root / standalone sessions) **or** `herdr tab
  create` (wave children). Launch lines themselves are unchanged.

### 3. `create-worktree/SKILL.md`

The Git-worktree half (branch policy, collision checks, `bun run
worktree:setup`) is unchanged. The Herdr-open half gains a mode split:

- **"Open the Herdr workspace without focus" → two modes:**
  - *Standalone session (no wave):* keep `herdr worktree open --path
    "$WORKTREE" --label "$FOLDER" --no-focus --json`, **plus** the new nesting
    invariant: assert the returned workspace JSON contains
    `worktree.is_linked_worktree == true` and `repo_root` = canonical root;
    on failure, close and re-open rather than continuing with an orphan.
  - *Wave child (a `ROOT_WS_ID` exists):* do **not** open a workspace; create
    a named tab in the root workspace (`herdr tab create --workspace
    "$ROOT_WS_ID" --cwd "$WORKTREE" --label "$FOLDER" --no-focus`) and record
    `TAB_ID`/`PANE_ID`.
- **New prohibitions box:** never `herdr workspace create --cwd` for any
  repo checkout (produces a non-nesting orphan — this caused the broken
  sidebar); never `herdr worktree open --path <canonical root>` (dedupes into
  and renames the user's `index` workspace).
- ID recording: "Record the returned `.result.workspace.workspace_id` and
  `.result.root_pane.pane_id`" → extend with the tab-mode equivalents
  (`.result.tab.tab_id`, `.result.root_pane.pane_id`).
- Reuse/identity checks: extend "reuse only when registered path and branch
  match" to tabs — reuse an existing tab only when its label is `$FOLDER` and
  its pane cwd is `$WORKTREE`; reject collisions.

### 4. `run-worktree-session/SKILL.md`

- **§1 "Create or reuse the visible session":** mirror the mode split from
  `create-worktree` (standalone workspace vs. wave child tab); the CLI
  contract block gains the `herdr tab create` line; capture workspace **or**
  tab + pane IDs. Reuse checks add tab-label/cwd identity.
- **§2/§3/§4:** no behavioral change — handoffs, result envelopes, and
  question answering already target explicit pane IDs, which is
  tab-compatible. Add one clarifying sentence that `PARENT_PANE_ID` for wave
  children is the root's pane in the `<wave>-root` workspace.
- **§5 (verify) / §6 (fix rounds):** "return to the same Herdr workspace,
  pane, and agent" → "same workspace **or tab**, pane, and agent".
- **Final paragraph of §5:** cleanup wording "closing this Herdr workspace …
  before removing the Git worktree" → "closing this child's Herdr tab (wave)
  or workspace (standalone), verified by ID — never the canonical root or the
  `index` workspace — before removing the Git worktree".

### 5. `finish-pr/SKILL.md`

- Cleanup step: generalize "close the child's exact Herdr workspace (verified
  by ID)" to "close the child's exact Herdr execution plane — its named tab
  (`herdr tab close <TAB_ID>`) in a wave, or its workspace (`herdr workspace
  close <WS_ID>`) standalone — verified by ID, then remove the Git worktree".
- Integration-branch note unchanged: held PRs keep their tab/worktree until
  merged or abandoned.

### 6. `run-agent-orchestration/references/integration-branch-waves.md` + `completion-and-questions.md`

- Sweep both for "workspace" phrasing that assumes child-per-workspace; align
  held-PR and cleanup language with tab semantics. (Mechanical wording pass;
  no contract changes.)

## Invariants to state verbatim in the skills

1. Every wave-created Herdr surface is reachable from `index`: the root
   workspace nests under `index` (worktree metadata), and every child is a
   named tab of the root workspace. Nothing wave-related may appear as a
   top-level sidebar workspace.
2. `herdr workspace create --cwd` is banned for repo checkouts.
3. `herdr worktree open --path <canonical root>` is banned (hijacks/renames
   `index`); recovery: `herdr workspace rename <INDEX_WS_ID> index`.
4. After any `worktree open`, verify `worktree.is_linked_worktree == true` in
   the returned JSON before proceeding (nesting invariant).
5. Tab label = dashed worktree folder; root tab 1 renamed to `<wave>-root`.
6. One writer per Git worktree, regardless of workspace-vs-tab surface.
7. Cleanup order: close tab/workspace by verified ID first, then remove the
   Git worktree.

## Verification plan (for the implementation PR of these skill edits)

1. Dry-run a mini-wave against the live Herdr server: create a detached
   `<wave>-root` worktree, open + rename, add two child tabs from real
   worktrees, confirm sidebar shows only `index ▸ <wave>-root` (user visual
   check), then run the cleanup sequence and confirm `herdr workspace list` /
   `herdr tab list` / `git worktree list` are clean. (This exact sequence was
   already executed successfully on 2026-07-25 as `demo-wave-root`.)
2. Grep the four skills + references for the banned commands
   (`workspace create --cwd`, `worktree open` on the canonical root) to ensure
   no stale launch lines survive.
3. Confirm `harness-matrix.md`, `coordination-loop.md`,
   `integration-branch-waves.md`, `completion-and-questions.md` contain no
   remaining child-per-workspace assumptions.

## Out of scope

- No Herdr product changes (multi-level sidebar indentation, tabs in sidebar)
  — the plan works entirely with today's verified CLI surface.
- Existing orphan workspaces from past waves are repaired opportunistically
  via the migration note, not by a one-off cleanup script.
