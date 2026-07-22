# Completion, verification, and structured questions

## Coordination waits are asymmetric — never `sleep`

The interactive user-facing main workspace is found dynamically by label `index`
(`wX`); its agent name is never hardcoded. The `index` path must never run
`herdr agent prompt --wait` or `herdr agent wait`: it submits main → root handoffs as
`herdr agent prompt NAME "..."` without `--wait`, returns idle, and reconciles durable
root state only on a later natural user turn or explicit orchestration tick.

Dedicated root orchestrators and implementation children run outside `index`. For a
root → child handoff, the root may and should use exactly one server-owned, indefinite
`herdr agent prompt NAME "..." --wait`, with no timeout. Do not prescribe
`herdr agent wait` for this flow. A returned `idle`, `done`, or `blocked` state is not
success by itself: inspect the child's `RESULT` and independently verify factual
git/PR/test state before reporting it.

- **`sleep` polling is banned at every tier.** Do not add polling or timeout retry
  loops, watcher processes, or watcher panes.
- **Parallel children:** dedicated roots may issue multiple complete
  `herdr agent prompt NAME "..." --wait` calls in one turn; the server owns those
  waits concurrently.

## Safe root callback to `index`

After a root reaches a structured `RESULT` or a genuine block needing user input, it
first locates the current main workspace by label `index` (`wX`) and derives its
current prompt target dynamically from that workspace's metadata. Never hardcode a
main-agent name or focus `index`.

Inject a concise structured `ORCHESTRATOR_EVENT` with
`herdr agent prompt MAIN_TARGET "..."` **without** `--wait` only if all conditions are
provable: the derived main target is `idle` or `done`, `index` is unfocused, and its
editor is empty with no draft. This wakes main without focusing it.

If the main is focused or working, has a draft, or editor emptiness cannot be proven,
do not touch the editor. Retain the durable done/blocked root state for the main's next
natural turn or explicit orchestration tick, and issue the appropriate non-focusing
notification:

```bash
herdr notification show "Orchestration complete" --body "RESULT available" --sound done
herdr notification show "Orchestration needs input" --body "Blocked input available" --sound request
```

Never clear, overwrite, or infer the safety of a user draft; never wait from `index`.

## Settled states and truth

- `idle` — ready for input after its tab has been seen in the focused Herdr UI.
- `done` — the same underlying idle state after unseen background work finishes.
  CLI reads do not mark an agent seen; `idle`/`done` carry no quality signal.
- `blocked` — Herdr recognized an approval or question UI. Inspect the pane.
- `unknown` — present but unclassifiable; not proof of completion or failure.

A settled state is **not** proof of success. After every settle, the orchestrator
reads the transcript and independently verifies facts: `git log`/`git status` for
commits, `gh pr view` for PR state and checks, and the targeted test/lint/build output
the child claims to have run.

## Child result envelope

Require every child (and the root orchestrator toward the main agent) to end its
final response with a concise structured envelope:

```
RESULT
status: done | blocked | failed
branch: <branch> @ <head-sha>
pr: <number-or-none> (<url-or-reason>)
verification: <tests/lint/build actually run, with outcomes>
blockers: <unresolved items, or none>
```

**Alternate-screen caveat:** full-screen agents may render in the terminal's
alternate screen; those rows never enter Herdr's host scrollback and `--lines`
cannot recover them. If a transcript read comes back short, only then ask the agent
to write its full report as Markdown in a temp directory and reply with the path —
read the file directly. Never request file output in the initial prompt.

## Structured questions: the escalation ladder

A root → child `agent prompt --wait` can return `blocked` when a question or approval
UI appears. Handle it at the tier that owns the agent:

1. **Read first.** `herdr pane read "$PANE_ID" --source visible --lines 120` to see
   the actual question and its options. Pane reads, text, and keys are always
   ID-targeted and non-focusing.
2. **Routine choices are answered in place.** Ordinary implementation questions —
   file edits, targeted tests, commits, pushes, PR creation — are decided by the
   supervising agent choosing the safe/recommended project-compliant option, then
   answering through the targeted pane UI:

   ```bash
   herdr pane send-text "$PANE_ID" "<safe answer>"
   herdr pane send-keys "$PANE_ID" enter
   ```

   For a selector, send only the navigation/confirmation keys the visible UI needs,
   then re-read the pane to confirm the answer landed in the intended control.
   **Never** answer an active structured question with `agent prompt` — it appends
   text to stale input.
3. **Genuine escalation re-raises upward.** Escalate only: genuine product or
   architecture ambiguity; destructive operations; external infrastructure mutation;
   credentials or secrets; merge approval. **Never infer merge approval.**
   - Child → root: the child surfaces its question; the root decides routine vs.
     genuine as above.
   - Root → main → user: when the root judges a question genuine, it persists its own
     blocked state and follows the safe callback rule above. The main either receives
     a safe fire-and-return `ORCHESTRATOR_EVENT` or discovers the durable state on a
     later natural turn/tick, then relays the question to the user. The user's answer
     travels back down as a targeted pane answer — never as a fresh agent prompt.
