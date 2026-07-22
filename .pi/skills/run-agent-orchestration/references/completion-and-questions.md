# Completion, verification, and structured questions

## Waits are event-driven — never `sleep`

Herdr waits are server-owned: `agent prompt --wait` and `agent wait` block until the
first requested settled state (`idle`, `done`, `blocked` by default) and return the
current agent at `.result.agent`. There is no default timeout — pass an explicit
`--timeout <ms>` as a checkpoint rhythm; a timeout exit is a polling checkpoint, not
a failure. Read new output, then wait again.

- **`sleep` polling is banned at every tier** (main, root orchestrator, child). It
  wastes wall-clock, desynchronizes from agent state, and hides `blocked` states.
- **Parallel children:** issue multiple `herdr agent prompt NAME "..." --wait` tool
  calls in one turn — the waits run concurrently on the server. Never spawn a
  background watcher process or watcher pane to observe agents.
- `agent wait` returns immediately if the current status already matches; add
  `--until unknown` explicitly only when you also need to catch unclassifiable states.

## Settled states and truth

- `idle` — ready for input after its tab has been seen in the focused Herdr UI.
- `done` — the same underlying idle state after unseen background work finishes.
  CLI reads do not mark an agent seen; `idle`/`done` carry no quality signal.
- `blocked` — Herdr recognized an approval or question UI. Inspect the pane.
- `unknown` — present but unclassifiable; not proof of completion or failure.

A settled state is **not** proof of success. After every settle, the orchestrator
reads the transcript and independently verifies facts: `git log`/`git status` for
commits, `gh pr view` for PR state and checks, and the targeted test/lint/build
output the child claims to have run.

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

`agent prompt --wait` can return `blocked` when a question or approval UI appears.
Handle it at the tier that owns the agent:

1. **Read first.** `herdr pane read "$PANE_ID" --source visible --lines 120` (or
   `agent read`) to see the actual question and its options.
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
   - Root → main → user: when the root orchestrator judges a question genuine, it
     asks its **own** `ask_user_question` with the full context. That makes the root
     `blocked`, which returns the main agent's `agent wait`/`prompt --wait`, and the
     main agent relays the question to the user verbatim (via its own
     `ask_user_question`). The user's answer travels back down the same path as a
     targeted pane answer — never as a fresh agent prompt.

This propagation is why the chain stays synchronous and safe: every tier's wait is
event-driven, so a blocked child surfaces through the root to the user without
polling, timeouts-as-errors, or lost context.
