# CI Troubleshooting

Failure modes that look like broken business logic but are really toolchain or
environment problems. Reach for this when a GitHub Actions job fails on a tree that
passes locally.

## Bun + Drizzle root-barrel export failures

**Symptom.** A Bun test or build step on Linux CI fails while importing API schemas:

```text
SyntaxError: Export named 'sql' not found in module 'node_modules/drizzle-orm/index.js'
SyntaxError: Export named 'relations' not found in module 'node_modules/drizzle-orm/index.js'
```

This is a Bun/Linux module-resolution problem against Drizzle's root barrel
(`drizzle-orm`), not a failing test.

**Fix.**

1. Confirm the failure shape — the failing step is a Bun test/build step and the error
   is a missing *named export* from `node_modules/drizzle-orm/index.js`:

   ```bash
   gh run view RUN_ID --job JOB_ID --log | tail -160
   ```

2. Do not stop at cache fixes. Disabling the `oven-sh/setup-bun` cache or running
   `bun pm cache rm` can clear a genuinely stale package, but if a fresh install still
   fails, cache cleanup is not the durable fix.

3. Find schema imports from the root barrel, starting with the files the failing tests
   load:

   ```bash
   rg "import \{ .*?(relations|sql).*? \} from ['\"]drizzle-orm['\"]" services/api/src/schemas services/api/src
   ```

4. Switch those helper imports to explicit Drizzle subpaths — these are public package
   exports and bypass the fragile root `export *` resolution:

   ```ts
   // before
   import { relations, sql } from 'drizzle-orm';

   // after
   import { relations } from 'drizzle-orm/relations';
   import { sql } from 'drizzle-orm/sql';
   ```

5. Verify with the same targeted command CI runs, plus the build:

   ```bash
   cd services/api
   bun test \
     src/adapters/tests/can-actor-see-opportunity.spec.ts \
     src/queues/tests/timeout.queue.spec.ts \
     src/queues/tests/claim-timeout.queue.spec.ts
   bun run build
   ```

Keep the fix PR to import-path changes unless the logs independently justify cache
hardening. Do not change Drizzle versions or the lockfile unless the logs show a real
dependency mismatch.

**Note.** The same tree can pass on a PR branch and fail after squash-merge on `dev`.
Compare trees (`git show -s --format=%T`) before assuming the squash changed files.

## See also

- [Development Reference → Git Workflow](./development-reference.md#git-workflow) for
  the post-merge verification loop.
- `verify-production-release` skill — frozen-lockfile and destructive-migration checks
  that fail at release time rather than in CI.
