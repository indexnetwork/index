# Integration-branch waves (internal finish-pr)

Use this mode when a project/epic spans several dependent sub-issues whose
intermediate states should not land on `dev` one by one. Instead of direct-to-dev
PRs, the wave runs against **one integration branch**, and sub-issue PRs merge
internally into it. `main` offers this mode at wave kickoff (recommended for 3+
dependent sub-issues); the choice, version floor, and merge authorization scope are
recorded in the wave handoff and the checkpoint journal.

## Contract

- `root` creates the integration branch `feat/<project>` from `origin/dev` and
  **owns its worktree**: root's coordination worktree IS the integration-branch
  checkout, created with `git worktree add -b feat/<project> "$ROOT_WT"
  origin/dev` (see `run-agent-orchestration`'s "Launching the root"). Git allows
  only one worktree per branch, so **no other worktree ever checks out the
  integration branch** — children branch their own `feat/…` branches and never
  check out `feat/<project>` itself.
- Implementation children branch from the **current verified integration SHA** (the
  integration branch head that `root` last verified), never from stale local refs.
- Child PRs target the integration branch, not `dev`. They open as **drafts**; `root`
  flips `gh pr ready` only after its own verification pass.
- The journal's Integration state section tracks the branch, verified SHA, and merge
  queue/order.

## Merge authorization scope

The wave handoff may grant **standing authorization for internal merges into the
integration branch only**. Merges into `dev` or `main` always require fresh explicit
user confirmation per `finish-pr` — no wave-level pre-authorization ever covers
them. `root` executes every internal squash-merge itself from its
integration-branch worktree — never from the canonical root — after verifying that
worktree's path, branch, and clean status and after its own local gates pass.
Children never merge. Root also performs the local reconcile merge of `dev` into
the integration branch and all conflict resolution.

## CI does not run on internal PRs

Repository workflows trigger on PRs to `dev`/`main` only, so internal PRs show zero
check runs (`statusCheckRollup: []`). This is expected, not a failure. **Local gates
replace CI** and are mandatory before `gh pr ready` and merge authorization: `root`
independently re-runs production lint, the affected package build,
`architecture:check` (protocol changes), and targeted tests, and records exact
results in the journal. Never authorize an internal merge on the child's claims
alone.

## Deployment and Linear in internal mode

- Railway verification is N/A — nothing deploys from an integration branch.
  Explicitly skip it and do not gate Linear transitions on deployment.
- Sub-issue lifecycle: `In Progress` on handoff, `In Review` when its PR goes ready,
  `Done` on internal merge with a "shipped to integration branch `feat/<project>`"
  note. Final deployment verification happens once, at promotion.

## Rebase and version rules

- Intra-wave base freshness is measured against the **integration branch**.
- Once any child has branched from it, the integration branch is shared/long-lived:
  never rebase or force-push it (same rule as `dev`/`main` in `finish-pr`).
- Parallel PRs colliding on `package.json` versions use the base-version floor rule:
  the integration branch's version is the floor; each PR re-applies its own semver
  bump on top. `root` performs the deliberate SemVer/lockfile reconciliation —
  never hand-merged manifests (resolve `package.json` first, then regenerate
  `bun.lock` with `bun install`).
- The never-rebase/never-force-push rule for the shared integration branch now
  belongs to `root`, which holds the branch's only checkout.

## Held PRs

A PR blocked on a sibling issue is **held**, not abandoned: it stays open (usually
draft), its Herdr tab (or standalone workspace), worktree, and branch are
explicitly preserved, and the journal
records the exact dependency (e.g. "held pending IND-517 baseline repair"). The
wave cleanup invariant applies to a held PR only after it merges or is deliberately
abandoned. A Linear comment records the hold and its dependency.

## Promotion

At wave end, `root` pushes the integration branch and opens the single promotion
PR to `dev`, finished with the full external `finish-pr` workflow: CI checks,
explicit user merge confirmation (root executes the promotion merge only after
fresh explicit user confirmation), Railway deployment verification, Linear
closure, and cleanup — plus
`verify-production-release` when the promotion continues to `main`. See
`finish-pr`'s internal-mode section and its `references/squash-release-reconciliation.md`
for squash-history reconciliation.
