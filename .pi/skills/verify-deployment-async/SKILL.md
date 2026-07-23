---
name: verify-deployment-async
description: "Performs one-shot, read-only GitHub and Railway deployment verification without blocking orchestration. Use after a merge or deployment event when external checks may still be nonterminal; bind the exact PR, base/head refs, merge SHA, and Railway target before reporting status or closing issues."
---

# Verify Deployment Async

Use this workflow from the release-operations role or a delegated read-only
`release-verifier`. It is deliberately one-shot: never use `--watch`, waits, sleeps,
polling loops, daemons, or infrastructure mutation.

## Identity binding and delegation

Before any read, record and preserve the exact identity tuple:

- GitHub repository, PR number, base ref, head ref, and merge SHA (when merged).
- Railway project ID, environment ID, service ID, and deployment ID. Resolve IDs from
  the release context or a read-only Railway lookup; never guess from display names.

A result applies only to that tuple. A notification, merge event, Slack message, or
unrelated deployment cannot establish success.

When a gate is nonterminal, explicitly call `team_delegate` with `role:
release-verifier`, `model: gpt-5.6-luna`, and a prompt containing every tuple field:

```json
{
  "role": "release-verifier",
  "description": "One-shot deployment verification",
  "prompt": "Verify exactly PR=<pr>, base=<base>, head=<head>, mergeSHA=<sha>; Railway project=<projectId>, environment=<environmentId>, service=<serviceId>, deployment=<deploymentId>. Perform one bounded read only, report status, then block this task if nonterminal.",
  "paths": [".pi/skills/verify-deployment-async/**", ".pi/skills/finish-pr/**"],
  "worktree": false
}
```

Return user control immediately after delegation; do not inline the worker or wait for
its result.

## One bounded read

1. Take one immediate GitHub snapshot (`pr:snapshot`, `gh pr view`, or one `gh run
   list`/`gh run view` read) for the bound PR/SHA.
2. Take one Railway MCP status/log/health read for the bound project, environment,
   service, and deployment. Discover Railway tools first; do not mutate resources.
3. If Railway MCP is unavailable or cannot identify the deployment, report
   `verification incomplete` / `unverified` and keep issues open. Do not substitute
   guessed CLI output or claim success. GitHub-only evidence never proves Railway
   health.

## Terminal handling

- **Terminal success:** report the exact successful GitHub and Railway statuses, IDs,
  SHA, and evidence. Only then may the release coordinator close related GitHub or
  Linear issues.
- **Terminal failure/cancellation:** report the exact failure and blocker; keep issues
  open and do not retry by polling or mutate infrastructure.
- **Nonterminal or missing evidence:** report exactly `merged; verification pending`
  (or `verification incomplete` when identity/evidence is unavailable), keep issues
  open, and return immediately.

After the one bounded read, emit at most one pending `team_report` for the identity
tuple plus observed status. Deduplicate repeat reports by that composite key. Then call
`team_block` on the same task; do not spawn a replacement worker. Resume only that exact
blocked worker after a durable terminal event or an explicit natural-tick `team_send`
carrying the same identity tuple. The worker must not create its own trigger or watcher.

## Closeout gate

Issue closure requires all of: the bound PR is merged, post-merge GitHub checks are
terminal-success, and the bound Railway deployment is terminal-success. A pending,
failed, cancelled, unverified, or mismatched result is fail-closed. The verifier may
recommend closeout after success, but must not infer or silently close issues without
the release coordinator's explicit closeout action.

The workflow is read-only: no deploy, restart, rollback, variable change, environment
mutation, merge, rebase, push, or issue close. Full automatic completion still requires
a durable external terminal-event adapter (or a later natural orchestration tick sent to
the exact blocked worker) to invoke another one-shot verification.
