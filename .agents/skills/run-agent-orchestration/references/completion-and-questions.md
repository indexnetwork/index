# Completion and questions

## Parent completion notification

Every handoff is fire-and-return and includes the exact `PARENT_PANE_ID`:

```bash
herdr agent prompt NAME "$(< /absolute/path/to/handoff.md)"
```

Never add `--wait`, `herdr agent wait`, polling, sleeps, watcher processes, or watcher
panes. Before it stops as `done`, `blocked`, or `failed`, a child sends its parent one
direct result prompt:

```bash
herdr agent prompt "$PARENT_PANE_ID" "CHILD_RESULT\nstatus: done | blocked | failed\nbranch/head/PR: ...\nverification: ...\nblockers: ..."
```

This single notification is mandatory and is not evidence that the result is correct.
If it fails, include the delivery failure in the child `RESULT`; the parent performs
one status/output pass on a later natural turn or explicit tick as a fallback.

## Child result envelope

Every child ends its visible pane output with, and sends to its parent:

```text
RESULT
status: done | blocked | failed
branch/head/PR: ...
verification: ...
blockers: ...
```

Treat this as a claim, not proof. Independently verify worktree identity, clean/pushed
git state, tests, PR checks/reviews, deployment SHA/status, Linear state, and cleanup.

## Structured questions

An explicit tick may observe a child in `blocked` state. Read the exact pane. Answer
routine safe choices through targeted pane text/keys. Re-raise only genuine product or
architecture ambiguity, destructive/external mutation, credentials, or merge approval
with `ask_user_question`. Never infer approval.

## Compaction

At a safe idle boundary, persist a continuation checkpoint with session, worktree,
branch/head, dirty state, completed verification, and next action. Issue `/compact`,
then queue one continuation referencing the checkpoint. Verify the same session
continues; if it stops, resume that exact session rather than creating a new writer.
