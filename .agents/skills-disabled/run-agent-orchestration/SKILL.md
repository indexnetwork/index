---
name: run-agent-orchestration
description: >-
  Direct the installed pi-herdr-orchestrator extension for an Index multi-task or
  delegated request. Use to decide when to call orchestrator_start, compose the
  project-aware root objective, choose child scopes and role prompts, reconcile
  through orchestrator_status/orchestrator_reconcile, and apply Index verification,
  PR, merge, deployment, and cleanup policy without manually recreating the
  extension's Herdr workspaces, worktrees, launches, reports, or durable state.
---

# Direct the Herdr orchestrator extension

This skill is a **project-policy adapter** for the installed
`pi-herdr-orchestrator` extension. The extension is the sole implementation of
orchestration mechanics. This skill decides when and how to use its tools and adds
Index-specific repository policy to objectives and child assignments.

## Non-negotiable boundary

Never reproduce extension behavior with shell commands, hidden subagents, or a
second state machine.

The extension owns:

- creating the root's Herdr worktree-backed workspace;
- creating each semantic-branch child worktree and named tab;
- launching Pi and starting root/child `/goal` sessions;
- scoped-model selection and inheritance;
- root/child identity, assignment files, durable event state, and parent delivery;
- terminal child reports, one-shot reconciliation, and status snapshots;
- closing tracked root/child Herdr surfaces when the root goal completes.

Therefore this skill must **not** manually run `herdr worktree create`, `herdr tab
create`, `herdr agent start`, or `/goal` for a root/child; create a parallel
checkpoint journal or `CHILD_RESULT` protocol; launch Codex/Kimi roots or children;
or substitute the `Agent` tool for extension-managed implementation.

If the relevant `orchestrator_*` tool is unavailable, stop rather than recreating
it. Ask the user to reload/restart Pi with the pinned project package active. The
project installation is declared in `.pi/settings.json`; the pinned source is
`git:github.com/yanekyuk/pi-herdr-orchestrator@v0.1.0`.

## Extension tiers and tools

Use the tool exposed for the current tier:

| Tier | Ownership | Extension tools |
|---|---|---|
| persistent `main` | Decide whether to delegate and hand the complete request to one root. Do not use `/goal` for the delegated request. | `orchestrator_start` |
| interactive `root` | Own the user conversation, clarification, decomposition, verification, PR finishing, and final synthesis. Do not implement feature source in the coordination worktree. | `orchestrator_delegate`, `orchestrator_status`, `orchestrator_reconcile` |
| bounded `child` | Implement only its assigned semantic branch/worktree and report evidence to the root. | `orchestrator_report` |

`idle` or `done` is never proof of success. A completed child report is still a
claim that the root verifies independently.

## Main: start one interactive root

Use orchestration for several coordinated changes, parallelizable implementation,
a multi-PR request, or work whose implementation should be isolated from the
persistent user-facing session. For one small change, use the standalone
`create-worktree` + `run-worktree-session` workflow instead.

Before calling `orchestrator_start`:

1. Confirm the request is concrete enough to hand over. Ask only questions needed to
   define the root objective; the root owns later clarification.
2. Choose a concise semantic `root_name` without the repository name and without a
   trailing `-root` (for example `negotiation-safety`).
3. Compose one self-contained `objective` containing:
   - the user's complete requested outcome and acceptance criteria;
   - known files, issues, PRs, dependencies, and required ordering;
   - canonical root `/Users/yanek/Projects/index`, target base `dev`, and the rule
     that source changes occur only in extension-created child worktrees;
   - relevant role checklists from `references/role-profiles.md`;
   - focused verification commands and required docs/package-version updates;
   - the requirement that children commit/push their own semantic branch and call
     `orchestrator_report` with concrete verification;
   - root-owned independent verification plus `finish-pr` for every external PR;
   - safety boundaries: no inferred merge approval, production mutation,
     migration, deployment/restart, force-push, destructive cleanup, or secret use;
   - any user-requested preservation constraints for existing worktrees or WIP.
4. Do **not** ask the user to choose a harness or arbitrary model. v0.1.0 launches
   Pi only and selects from the user's scoped `/model` set. If that set is empty,
   direct the user to `/scoped-models` as the extension requests.

Call `orchestrator_start` exactly once with `root_name` and `objective`. After it
returns, tell the user which root workspace owns the request and ask them to continue
that request there. The persistent main session does not implement, tick, or finish
the handed-off request; it remains available for unrelated work.

## Root: apply Index policy through extension calls

The root is the interactive request owner. Follow the extension's first-action merge
question, but apply repository policy when interpreting the answer:

- approval is limited to the concrete request and parent target named in the
  question; a Yes is the extension's explicit authorization to merge that fully
  verified result without a second routine prompt, while No forbids the merge;
- every merge into `dev` or `main` must still satisfy all non-approval readiness and
  post-merge requirements in `finish-pr`; a changed target or additional external PR
  outside the original question requires fresh explicit confirmation;
- never treat approval as permission to discard dirty work, guess through conflicts,
  force-push a shared branch, mutate Railway, or touch production;
- children never merge shared branches or reconcile manifests/`bun.lock`.

Decompose by independently owned file scope, not by persistent persona. Use one child
when changes share files, manifests, migrations, or atomic verification. Use multiple
children only for genuinely separable work.

For each child:

1. Select one primary role from `references/role-profiles.md`. Keep `role` a short
   label under 160 characters (for example `protocol-specialist`); put the
   applicable checklist in `context`/`prompt`, and keep `scope` to a concise ownership
   boundary.
2. Choose a semantic branch matching
   `^(feat|fix|chore|refactor|docs|test|perf)/[a-z0-9]+(?:-[a-z0-9]+)*$`.
3. Set `cwd` to the root's repository checkout.
4. Omit `model` to inherit the root selection unless a different exact value from
   the extension-reported scoped model list is justified. Never invent a model ID.
5. Pass the mandatory Index setup through `setup_command`:

   ```json
   ["bash", "-lc", "WT=$(git rev-parse --show-toplevel); COORD=${WT%/.worktrees/*}; cd \"$COORD\" && bun run worktree:setup <dashed-branch-folder>"]
   ```

   v0.1.0 nests child worktrees under the root coordination checkout, so setup must
   run from that coordination checkout—not from the canonical repository root.

6. Include exact work scope, non-goals, applicable safety constraints, targeted
   tests, commit/push expectations, and the requirement to finish with
   `orchestrator_report`. Do not add a second parent-message protocol.
7. Call `orchestrator_delegate`. Do not pre-create the worktree or tab.

The child should use `run-worktree-session` only for its implementation and
verify/commit/push/PR discipline; it skips that skill's standalone launch steps
because the extension already created and launched its execution plane.

## Root: reconcile and finish

Children report through `orchestrator_report`; no watcher or polling loop is needed.
On a natural user turn or explicit request for status:

1. Call `orchestrator_status` for durable task/report state.
2. If a nonterminal child needs one bounded live inspection, call
   `orchestrator_reconcile` once. Do not sleep, poll, auto-restart, or infer success
   from a settled Herdr state.
3. v0.1.0 has no correction tool and terminal reports are immutable. Prefer a child
   report of `working` while root verification/fix rounds remain. If correction is
   needed, send at most one consolidated prompt to the exact child pane already
   recorded by the extension; never create a duplicate writer or branch task. Once a
   child reports terminal `completed`, do not expect a second report to update its
   durable task—verify any later correction directly and record the caveat.
4. Independently inspect the child worktree/branch, diff, tests, pushed head, PR,
   reviews, and checks before accepting completion.
5. Use `finish-pr` for merge confirmation, GitHub/Railway verification, issue
   updates, and safe child worktree/branch cleanup. Root owns all merges; children do
   not.

Call `goal_complete` only when all required child work is terminal and independently
verified, PR/issue/deployment state is truthful, approved merges are complete, and no
requested source work remains. The extension then closes every tracked Herdr surface.
It removes **no** Git worktree or branch: root and child checkouts remain on disk by
design. Before completing, record their exact paths/branches and report that cleanup
must run later from a different checkout after surface closure. Do not manually close
extension-owned tabs/workspaces or make a running root remove itself.

## Child: implement and report

A child works only in its extension-assigned worktree. Before mutation, verify `pwd`,
branch, and status against the assignment file. Follow the applicable repository
skills and role checklist, run focused verification, commit and push the semantic
branch, and open/update the requested PR.

Before stopping, call `orchestrator_report`:

- `completed` requires a concise summary plus concrete `verification` evidence;
- `blocked` names the exact user/root decision needed;
- `failed` records attempted verification and remaining failure;
- never report completion from `idle`, a clean diff alone, or unverified CI/deploy
  state.

Do not send a manual `CHILD_RESULT`, prompt the main session, merge a shared branch,
or close/remove the extension-managed execution plane.

## See also

- `references/role-profiles.md` — Index path-triggered child checklists.
- `run-worktree-session` — child implementation and verify/commit/push/PR discipline;
  standalone creation only when no orchestrator identity exists.
- `finish-pr` — explicit merge confirmation, post-merge verification, issue updates,
  and safe cleanup.
- `verify-production-release` — additional `dev` → `main` release safety.
