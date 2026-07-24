# Completion and questions

## Parent completion notification

Every handoff is fire-and-return and includes the exact `PARENT_PANE_ID`. Write the
handoff to a temp file and deliver it with command substitution — the canonical
delivery path that avoids quoting corruption; never commit handoff files into the
repository:

```bash
herdr agent prompt NAME "$(< /tmp/handoff-<child>.md)"
```

Never add `--wait`, `herdr agent wait`, polling, sleeps, watcher processes, or watcher
panes. Before it stops as `done`, `blocked`, or `failed`, a child sends its parent one
direct result prompt:

```bash
herdr agent prompt "$PARENT_PANE_ID" "CHILD_RESULT\nstatus: done | blocked | failed\nbranch/head/PR: ...\nverification: ...\nblockers: ..."
```

This single notification is mandatory and is not evidence that the result is correct.
If it fails, include the delivery failure in the child's `CHILD_RESULT`; the parent
performs one status/output pass on a later natural turn or explicit tick as a
fallback.

## Child result envelope (`CHILD_RESULT`)

The envelope name is fixed vocabulary: **`CHILD_RESULT`**, from a `child` to its
recorded parent pane. Every child ends its visible pane output with, and sends to
its parent:

```text
CHILD_RESULT
child: <child label>
status: done | blocked | failed
branch/head/PR: ...
verification: ...
blockers: ...
```

Treat this as a claim, not proof. Independently verify worktree identity, clean/pushed
git state, tests, PR checks/reviews, deployment SHA/status, Linear state, and cleanup.

## Structured questions (per harness)

An explicit tick may observe a child in `blocked` state. Read the exact pane. Answer
routine safe choices through targeted pane text/keys. Re-raise only genuine product or
architecture ambiguity, destructive/external mutation, credentials, or merge approval
with `ask_user_question`. Never infer approval.

Harness specifics (see `harness-matrix.md` for the full capability matrix):

- **codex** — Herdr detects the approval/question UI as `blocked`. Answer through the
  pane with targeted text/keys.
- **pi** — children surface `ask_user_question` selector TUIs, but pi panes report
  `screen_detection_skipped: true`, so do not rely on `blocked` detection; on each
  tick read the pane and check `herdr agent explain`. Answer a selector with
  navigation keys (`up`/`down` + `enter`) via `herdr pane send-keys` — never
  `herdr agent prompt` into an active selector, and mind pi's auto-appended "Type
  something." row when counting options. Re-read the pane to verify the answer
  landed in the intended control.
- **kimi `--auto`** — cannot ask questions at all. Blockers arrive only as
  `status: blocked` in its `CHILD_RESULT` envelope; if no envelope arrives, a tick's
  pane read is the fallback. State this rule in every kimi `--auto` handoff.

## Compaction

At a safe idle boundary, persist the continuation state in the wave's checkpoint
journal (see `coordination-loop.md`): session identity, worktree, branch/head, dirty
state, completed verification, and next action. On pi and codex, issue `/compact`,
then queue one continuation referencing the journal. Kimi has no manual compaction
contract — the journal is the continuity mechanism; resume with `kimi -S <session
id>` if the session stops. Always verify the same session continues; if it stops,
resume that exact session rather than creating a new writer.
