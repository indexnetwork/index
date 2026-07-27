# Task 3 report: prevent failed historical comparison enqueue

## Status

Completed and committed. Task 3 adds the requested API admission fence only; it does not modify Task 4 behavior or documentation.

## Changed files

- `services/api/src/queues/pool/mining.shared.ts`
  - Exports `shouldEnqueuePoolQuestionForResolvedHistory`.
  - Uses the Task 1 `priorReferenceComparisonUnavailable` protocol result after retaining the shadow result log and before discriminator selection/enqueue.
  - Logs the specified warning and returns before question admission when comparison is explicitly unavailable.
- `services/api/src/queues/pool/tests/mining.shared.isolated.ts`
  - Covers explicit rejection for `{ priorReferenceComparisonUnavailable: true }` and normal admission for `{}`.
- `services/api/src/queues/tests/pool-question.queue.isolated.ts`
  - Covers durable label-history suppression for a `Working style` discriminator under a new fingerprint.

## Commit

`a9e495f261fd878cc06aaae09e50b520b8a2a61c fix(api): suppress pool cards when axis history cannot be compared`

## Commands and output

1. Requested pre-change command:
   ```sh
   cd services/api && bun test src/queues/pool/tests/mining.shared.isolated.ts src/queues/tests/pool-question.queue.isolated.ts
   ```
   Result: Bun 1.3.14 returned exit 1 before loading tests because path filters without `./` did not match files. It instructed using `./`.

2. Corrected pre-change command:
   ```sh
   cd services/api && bun test ./src/queues/pool/tests/mining.shared.isolated.ts ./src/queues/tests/pool-question.queue.isolated.ts
   ```
   Result: expected missing helper export was reported. The queue file also required the repository safety marker before imports.

3. Focused post-change validation:
   ```sh
   cd services/api && TEST_DATABASE_SAFE=1 bun test ./src/queues/pool/tests/mining.shared.isolated.ts ./src/queues/tests/pool-question.queue.isolated.ts
   ```
   Result: passed — 26 tests, 0 failures, 59 assertions.

4. Commit hook:
   ```sh
   git commit -m "fix(api): suppress pool cards when axis history cannot be compared"
   ```
   Result: passed `eslint --no-warn-ignored` for all three staged TypeScript files and created the commit.

5. Self-review:
   ```sh
   git show --check --stat --oneline HEAD
   git diff --cached --name-only
   ```
   Result: no whitespace errors and no staged files. Review found no blockers: the only new return is strictly controlled by the explicit protocol flag, absent flags still reach existing selection/enqueue behavior, and lifecycle/pool/freshness guard placement is unchanged.

## Concerns

- The requested Bun test syntax does not work under the installed Bun 1.3.14 path-filter behavior; the equivalent `./` form was used for executable focused validation.
- The focused queue test needs `TEST_DATABASE_SAFE=1` during module initialization even though the test uses an injected in-memory harness. This is existing repository test-environment behavior.
- `git status` has a pre-existing untracked `.pi-subagents/` directory. It was not staged, modified, or included in the commit.

## Compile regression follow-up

- Replaced the invalid root-package `DiscriminatorShadowResult` import in `services/api/src/queues/pool/mining.shared.ts` with the minimal local structural parameter shape `{ priorReferenceComparisonUnavailable?: boolean }`. Behavior remains unchanged: only an explicit `true` suppresses enqueue.
- Removed only the two trailing spaces from the Status line in `docs/superpowers/specs/2026-07-27-discriminator-axis-memory-design.md`; the Markdown text is unchanged.
- Validation passed:
  ```sh
  bunx tsc --project services/api/tsconfig.json --noEmit --pretty false
  cd services/api && TEST_DATABASE_SAFE=1 bun test ./src/queues/pool/tests/mining.shared.isolated.ts ./src/queues/tests/pool-question.queue.isolated.ts
  ```
  The focused tests passed: 26 tests, 0 failures, 59 assertions.
