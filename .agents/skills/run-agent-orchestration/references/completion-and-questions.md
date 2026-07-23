# Completion and questions

## Temporary manual coordination

The project-local orchestration bridge has been removed pending a dedicated refactor.
There is no automatic root→main or child→root callback.

Every handoff is fire-and-return:

```bash
herdr agent prompt NAME "$(< /absolute/path/to/handoff.md)"
```

Never add `--wait`, `herdr agent wait`, polling, sleeps, watcher processes, or watcher
panes. On a later natural user turn or explicit tick, the main session checks its root
once; the root checks each owned child once. If work remains active, return idle.

## Child result envelope

Every child ends its visible pane output with:

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
