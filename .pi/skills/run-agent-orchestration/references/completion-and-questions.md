# Completion, verification, and structured questions

## Fire-and-return callbacks — never `sleep`

Every main → root and root → child handoff uses:

```bash
herdr agent prompt NAME "$(< /absolute/path/to/handoff.md)"
```

Never use `--wait`, `herdr agent wait`, polling, timeout loops, sleeps, watcher
processes, or watcher panes. Before a `*-root` prompts a child it registers the exact
live child Pi session, workspace, pane, and worktree through
`register_orchestration_child_route`. The child cannot select a target; absent, stale,
or ambiguous routes fail closed. A settled state is never success — reconcile RESULT
and git/PR/test facts independently.

## Durable auto-resume

The project-local bridge persists bounded, idempotent, timestamp/id-ordered `result`
or validated RPIV `blocked` events before one best-effort socket wake. Root → `index`
requires observable `*-root` provenance. Child → root requires the exact registered
route. Unsafe data is quarantined; event data is always an explicitly untrusted JSON
boundary.

`index` and registered roots coalesce wakes into at most one non-user custom
`sendMessage({ deliverAs:"followUp", triggerTurn:true })` continuation: immediate when
idle, or one follow-up while busy. It never uses `sendUserMessage`, reads/edits/clears
the editor, steals focus, or uses Herdr prompt/screen injection. `index` may present
an approval request but cannot infer/grant approval; blocked questions still require
real user input. A missed listener/restart leaves the spool durable for attachment on
the next natural turn. Acknowledgements, crash replay, bounded batches, and
cancellation/attachment linearization remain intact.

## Child result envelope

Require every child (and root toward main) to finish with:

```
RESULT
status: done | blocked | failed
branch: <branch> @ <head-sha>
pr: <number-or-none> (<url-or-reason>)
verification: <tests/lint/build actually run, with outcomes>
blockers: <unresolved items, or none>
```

A RESULT is not proof. Independently inspect branch head/status, PR/checks, and the
claimed targeted verification. If alternate-screen transcript rows are unavailable,
ask only then for a report file in a temp directory.

## Structured questions

When a child has active blocked UI, inspect the exact pane first. Routine safe choices
are answered through targeted non-focusing pane input; never append an agent prompt to
an active structured question:

```bash
herdr pane read "$PANE_ID" --source visible --lines 120
herdr pane send-text "$PANE_ID" "<safe answer>"
herdr pane send-keys "$PANE_ID" enter
```

Escalate only genuine product/architecture ambiguity, destructive or external
mutation, credentials/secrets, or merge approval. Never infer merge approval. RPIV
blocked events are published only after the validated prompt lifecycle, and are
cancelled/tombstoned when that wait ends; a delivered historical event is not replayed.

## Supervised compaction

Use `/supervised-compact {"task":"...","validation":"...","nextAction":"..."}`
only at an idle safe boundary: no active tool/write/rebase/test/migration/merge/deploy
and no RPIV question. It stores session/worktree/branch/head/dirty state and parent
route before Pi compaction, then explicitly resumes the same session once. Bare
`/compact` is refused. Context thresholds are guidance to compact at a checkpointed
milestone, not a timer or churn loop.
