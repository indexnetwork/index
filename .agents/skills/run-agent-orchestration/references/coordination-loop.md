# Coordination loop (ticks and the checkpoint journal)

The three tiers are fixed vocabulary: **`main`** (user-facing), **`root`** (sole wave
orchestrator), **`child`** (one writer per worktree). Corrections flow strictly
down-tier — `main` → `root` → `child`. `main` never prompts a child directly.

## The tick algorithm

A tick is one bounded, read-mostly coordination pass. `main` ticks `root`; `root`
ticks its children. Every tick:

1. **Re-read the contracts** — this skill's SKILL.md and the references relevant to
   the wave (role profiles, model routing, completion contract, and this file).
2. **Identity pass** — `herdr agent get` on `root` (from `main`) or on every tracked
   child (from `root`). Confirm workspace/pane/cwd/branch still match the checkpoint
   journal's child map.
3. **Bounded pane reads** — `herdr pane read <PANE_ID> --source visible --lines
   15000` at the `root` tier; smaller reads at `main`. Never focus the pane.
4. **Independent verification** — claims are not facts. Verify with direct evidence:
   - `ps`/`pgrep` for stale or duplicated test runners contending on one worktree;
   - `git status/log/diff` inside the child worktree; `git ls-remote` for pushed
     heads;
   - `gh pr list/checks` and `bun run pr:snapshot -- <pr>` for PR state;
   - targeted lint/build/test re-runs before any merge authorization.
5. **At most one corrective prompt per tick**, consolidated and routed down-tier via
   `herdr agent prompt <PANE_ID> "$(< /tmp/handoff-file.md)"`. Multiple small nudges
   fragment the child's context; batch everything the tick found into one prompt.
6. **Update the checkpoint journal** (below) before ending the tick.

Never poll, sleep, add `--wait`, or create watcher processes/panes between ticks.
Ticks happen on natural turns or explicit user requests; children push
`CHILD_RESULT` envelopes to their recorded parent pane in between.

## Pi persistence: `/goal` and `todo`

When `main` or `root` runs on Pi, run the wave under an active `/goal` so the loop
continues across turns until wave-end verification, and mirror wave state in the
`todo` tool: one task per child/PR, `blockedBy` encoding merge/rebase sequencing
(e.g. "rebase B" blocked by "merge E" when both touch `package.json`). Call
`goal_complete` only after every PR is merged or deliberately held, workspaces are
cleaned per the wave cleanup invariant, and Linear reflects reality.

## The checkpoint journal

The journal is the wave's durable state — it survives compaction, session restarts,
and harness differences. Path convention:

```text
/tmp/<wave-slug>-orchestration-checkpoint.md
```

`root` creates it at wave start and updates it after **every** significant event:
child launched, handoff sent, envelope received, PR opened/ready/merged/held,
blocker recorded, correction routed, workspace cleaned. Required sections:

```markdown
# <wave> orchestration checkpoint

## Wave decisions
- harness + model per tier (incl. user overrides), wave mode (direct-to-dev or
  integration branch), version floor, merge authorization scope.

## Child map
- child ↔ workspace/pane IDs, worktree path, branch, Linear issue, role, model,
  session identity for resume.

## Integration state   (integration-branch waves only)
- integration branch + current verified integration SHA, merge queue/order.

## Active and held PRs
- PR number, head SHA, base, readiness, holds with their exact dependency.

## Blockers and caveats
- unresolved blockers, recorded verification caveats, deviations from plan.

## Next actions
- the single next action per child and for root.
```

Every handoff references the journal path so a relaunched or compacted session can
recover the wave. For `/compact` (pi, codex), the journal **is** the continuation
checkpoint; queue one continuation prompt referencing it and verify the same session
resumes. Do not commit the journal into the repository.
