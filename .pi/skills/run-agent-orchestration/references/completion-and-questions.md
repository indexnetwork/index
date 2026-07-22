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

## Durable attach-next-turn callback to `index`

After a root reaches a structured `RESULT` or a genuine block needing user input, the
project-local orchestration bridge authorizes publication only from a Herdr workspace
whose observable label ends in `-root`. It resolves the unique workspace labeled
`index` and its reported Pi session identity through Herdr metadata; `index` and
implementation children fail closed. Manual publishing is RESULT-only. A blocked event
is created only after rpiv emits validated `rpiv:ask-user:prompt` immediately before
its questionnaire wait.

It persists a strictly validated, bounded, idempotent event before one best-effort
Unix-socket wake: stable id, `result` or `blocked` kind, source workspace
label/pane/session provenance, concise summary, non-future timestamp, and optional
durable result payload/location. Unsafe/malformed spool data is quarantined, events
are timestamp/id ordered, and per-turn delivery is bounded. It never hardcodes a
main-agent name or uses screen scraping.

The private per-session spool is the source of truth. The `index` session starts its
event-driven socket listener only at `session_start` and closes/unlinks it at
`session_shutdown`. Receipt can only refresh a non-focusing inbox widget/status; it
must not edit the editor, start a user message, focus a workspace, or invoke Herdr
prompt/wait APIs. A missed one-shot wake leaves the spool intact with no retry, poll,
sleep, watcher, or timeout loop.

On `before_agent_start` of the user's next natural turn, the `index` extension
atomically claims outstanding events and appends persistent custom
`ORCHESTRATOR_EVENT` context. Its JSON serialization is explicitly untrusted data,
containing bounded id/kind/provenance/timestamp/location/payload/summary values so
child text cannot alter bridge instructions. It acknowledges an event only after its
custom message is observable in session history; crash recovery reclaims
unacknowledged events, for at-least-once idempotent delivery. Immediately before a
hook returns an attachment, the bridge records one durable dispatch decision under the
same spool state as cancellation: the first decision linearizes delivery. A cancellation
that wins first returns no attachment; one that follows an attachment decision cannot
retract that truthful attachment but leaves its tombstone so it can never replay. A transient metadata
failure retries only from this later natural `before_agent_start`, never a timer or
poll. Never clear, overwrite, or infer the safety of a user draft; never focus or wait
from `index`.

Herdr 0.7.5 `notification.show` is only an optional visibility alert. It has no
persistent inbox, and a disabled toast cannot resume Pi. It is not the bridge.
Herdr's installed Pi integration reports `blocked` only from same-process
`herdr:blocked` events. rpiv `ask_user_question` v2.0.0 emits only
`rpiv:ask-user:prompt` before awaiting its overlay, so it does not supply that
lifecycle itself. The project-local bridge records an outstanding tool call at Pi tool-execution start,
then listens for rpiv's validated prompt event to activate the balanced lifecycle. On
tool end it always balances `herdr:blocked` and removes the matching pending/claim
block event; a block already attached during a real wait remains truthful history but
is not replayed.

`pi-subagents` is the concrete presentation/persistence precedent: reuse its
structured custom-message details/renderer, persistent above-editor widget, and
append-only delivery records. Do **not** reuse its
`pi.sendMessage({ deliverAs:"followUp", triggerTurn:true })` completion nudge: it
auto-starts the parent and violates attach-next-turn. Its cross-extension RPC/events
(and `pi.events`) are same-process only, while Herdr root and `index` are distinct
visible Pi processes. Cross-process delivery remains the private durable spool plus
one best-effort local socket wake. Project-local extensions require project trust and
a reload of both the root and `index` sessions after installation.

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
   - Root → main → user: when the root judges a question genuine, its
     `ask_user_question` execution is reference-counted by the project-local bridge.
     The bridge emits same-process `herdr:blocked { active:true, label }` for the full
     awaited duration and exactly balances it with `active:false`, including shutdown
     cleanup, so Herdr's existing integration reports the real blocked state. It also
     durably publishes the blocked event for attach-next-turn delivery. The main
     relays it only on a later natural turn/tick. The user's answer travels back down
     as a targeted pane answer — never as a fresh agent prompt.
