---
name: fix-bun-drizzle-ci
description: Diagnose and fix Bun/Linux CI failures where hermetic API tests fail with Drizzle root-barrel export errors such as "Export named 'sql' not found in module node_modules/drizzle-orm/index.js" or missing `relations`. Use after a PR or dev push fails in GitHub Actions despite the same tests passing locally or on the PR branch.
---

# Fix Bun + Drizzle CI Export Failures

Use this when a GitHub Actions Bun test job fails while importing API schemas with errors like:

```text
SyntaxError: Export named 'sql' not found in module 'node_modules/drizzle-orm/index.js'
SyntaxError: Export named 'relations' not found in module 'node_modules/drizzle-orm/index.js'
```

This is usually a Bun/Linux module-resolution problem against Drizzle's root barrel (`drizzle-orm`), not a failing business test.

## Workflow

1. **Confirm the failure shape.** Inspect the failed job log:

   ```bash
   gh run view RUN_ID --job JOB_ID --log | tail -160
   ```

   Confirm the failing step is a Bun test/build step and the error is a missing named export from `node_modules/drizzle-orm/index.js`.

2. **Do not stop at cache fixes.** Disabling `oven-sh/setup-bun` cache or running `bun pm cache rm` can help stale package issues, but if the fresh install still fails, the durable fix is not cache cleanup.

3. **Find schema imports from the Drizzle root barrel.** Start with schema files loaded by the failing tests:

   ```bash
   rg "import \{ .*?(relations|sql).*? \} from ['\"]drizzle-orm['\"]" services/api/src/schemas services/api/src
   ```

4. **Switch schema helper imports to explicit Drizzle subpaths.** For schema files, replace root-barrel imports like:

   ```ts
   import { relations, sql } from 'drizzle-orm';
   ```

   with:

   ```ts
   import { relations } from 'drizzle-orm/relations';
   import { sql } from 'drizzle-orm/sql';
   ```

   These are public package exports in Drizzle and bypass the fragile root `export *` barrel resolution.

5. **Verify locally with the same targeted CI command and build.** For this repo's hermetic pinning job:

   ```bash
   cd services/api
   bun test \
     src/adapters/tests/can-actor-see-opportunity.spec.ts \
     src/queues/tests/timeout.queue.spec.ts \
     src/queues/tests/claim-timeout.queue.spec.ts
   bun run build
   ```

6. **Open a small fix PR and watch CI.** Keep the PR focused on import-path changes unless cache hardening is also required by evidence.

## Notes

- The same tree may pass on a PR branch and fail after squash-merge on `dev`; compare trees (`git show -s --format=%T`) before assuming the squash changed files.
- If a cache-only PR still fails after `no-cache: true` and `bun pm cache rm`, proceed to the direct Drizzle subpath import fix.
- This is a CI/runtime resolution workaround; do not change Drizzle versions or lockfiles unless the logs show an actual dependency mismatch.

## See also

- `manage-pr` — use this during post-merge verification when GitHub checks fail.
- `create-worktree` — make the follow-up fix in a worktree, not canonical `dev`.
- `verify-production-release` — use for separate frozen-lockfile/destructive-migration release checks.
