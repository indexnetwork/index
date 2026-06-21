---
name: release-prod-safety
description: "Pre-merge and post-merge safety checks for promoting a dev→main release in this monorepo, capturing two non-obvious ways a release can break or lose data: (1) a stale root bun.lock fails the prod build under --frozen-lockfile even though dev never caught it, and (2) a destructive Drizzle migration (e.g. DROP TABLE) silently loses prod data when the operational backfill never ran on prod. Use when cutting/merging a release PR to main, when a prod deploy build fails on 'lockfile is frozen', or before merging any PR carrying a DROP/destructive migration."
---

# release-prod-safety

Two production-release foot-guns observed shipping the `user_profiles` removal epic. Both passed CI and dev yet threatened prod. Check these when promoting `dev`→`main` (pairs with `finish-pr` for the merge/verify and `open-release-pr` for cutting the PR).

## 1. Stale root `bun.lock` breaks the prod build (not dev)

**Symptom:** the Railway prod (main) deploy fails at build with:
```
error: lockfile had changes, but lockfile is frozen
```
Build fails BEFORE the release/`db:migrate` phase, so no migration runs and the previous deployment keeps serving (no downtime, no partial migration).

**Why dev never caught it:** Railway only rebuilds a service when its watched paths change. A package version bump in `packages/cli` (or `claude-plugin`/`protocol`) that isn't reflected in the root `bun.lock` won't trigger a protocol rebuild on dev, so dev never re-runs `bun install --frozen-lockfile`. The merge to `main` rebuilds everything and surfaces the drift. CI (`check`/`lint`/`typecheck`) does NOT run a frozen install, so it stays green too.

**Prevent / fix:** whenever you bump any workspace `package.json` version (incl. `optionalDependencies` like the CLI platform packages), regenerate and commit `bun.lock`. Verify before merging a release:
```bash
bun install --frozen-lockfile   # must print "no changes" / not error
```
If prod already failed: regenerate the lockfile, hotfix it to `main` (then sync the identical fix to `dev` — it is equally stale), and the next deploy proceeds to build → migrate → boot.

## 2. Destructive migration without a verified prod data backfill

A `DROP TABLE`/column migration is a blind schema op — it does **no** data backfill. If the replacement representation is populated by a separate **operational** step (a backfill CLI, a decompose job) that ran on dev but **never on prod**, merging the release drops real prod data on deploy (`db:migrate` runs automatically).

**Before merging a PR that carries a destructive migration:**
1. Identify what the dropped table/column uniquely holds that is NOT already on the surviving tables.
2. Audit **prod** (read-only) for rows whose content is not yet captured by the replacement — e.g. `users with a <dropped> row but no <replacement> row`, excluding ghost/deleted.
3. If any real rows are at risk, **remediate while the source still exists** (decompose/copy into the replacement), then re-verify the at-risk count is 0.
4. Only then merge. After deploy, run any eager backfills (and embedding backfills for SQL-inserted rows, since direct inserts bypass the graph's embedding step).

**Gotchas:**
- Migrations are sequential — you usually can't "skip" the destructive one mid-sequence, so pre-flight remediation beats splitting the release.
- Auto-`db:migrate` on deploy means there's no window to backfill *after* the drop — do it before.
- Successful MCP tool calls may not be logged by name; for "is the old thing still used?" prefer a **persisted** signal (a runs/operations table) over app-log greps.

## See also
- `finish-pr` — merge + post-merge deploy/Railway verification (run these checks as part of finishing a release PR).
- `open-release-pr` — cut the dated `release/<date>` PR into `main`.
