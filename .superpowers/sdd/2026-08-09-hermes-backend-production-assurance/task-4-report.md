# Task 4 — Previous API compatibility assurance

## Result

Implemented the fail-closed previous-production API compatibility gate. Protected runs require a release-ops supplied `repository@sha256:...` reference, pull and resolve its exact repository-and-digest match, run it against the migrated loopback `hermes_assurance` database, and require an exact `401` from `GET /agents/me` for a freshly seeded dedicated Hermes credential. PR evidence is explicitly labeled non-production and builds the real API production entrypoint from the topology-derived approved rollback base; the handwritten legacy-table server remains only a runner contract fixture.

## Security contract

- The dedicated credential is generated afresh and reaches child processes only through environment, stdin, or process memory; it is never placed in argv, files, logs, or reports.
- The probe uses curl configuration on stdin, never a credential-bearing header argument.
- The probed container uses Docker's `none` log driver. Release operations must also establish that an approved image has no independent external logging sink that records request headers; Docker cannot disable a sink implemented inside the image.
- Database seed failures discard diagnostics and emit a fixed credential-free error.
- Container stop/remove, disposable fixture deletion, and temporary-directory removal are registered in the exit trap.
- Readiness is bounded and polls `/health`; the fixture reports ready only after both the legacy and migrated dedicated tables are visible.
- The exact report is `{imageDigest,rejected:true,status:401,checkedAt}` and is checked against the raw credential, its hash, and the database URL before publication.
- No `set -x`, production credentials, deployment action, or fabricated protected image digest was added.

## Files

- `.github/workflows/hermes-backend-production-assurance.yml`
- `services/api/package.json`
- `services/api/scripts/verify-hermes-previous-api-compatibility.sh`
- `services/api/src/cli/tests/hermes-previous-api-compatibility.spec.ts`
- `services/api/src/cli/tests/fixtures/previous-api.Dockerfile`
- `services/api/src/cli/tests/fixtures/previous-api-base.Dockerfile`
- `services/api/src/cli/tests/fixtures/previous-api-server.ts`
- `.superpowers/sdd/2026-08-09-hermes-backend-production-assurance/task-4-report.md`

## TDD evidence

The shell contract suite was first run with the runner and workflow modes absent: 8 tests failed for those missing contracts. A later seed-diagnostic sanitizer test was observed failing because the fake dependency emitted an `idxh_` credential, hash, and database URL; redirecting seed diagnostics to `/dev/null` made it pass. Final result: 9 tests passed, 0 failed, 39 expectations.

## Validation

- `cd services/api && bun run test:hermes-previous-api-compatibility` — 9 passed, 0 failed.
- `bash -n services/api/scripts/verify-hermes-previous-api-compatibility.sh` and explicit `set -x` absence check — passed.
- `cd services/api && bun run build` — passed.
- `cd services/api && bun run typecheck:cli-specs` — passed.
- `cd services/api && bun run lint` — passed with 0 errors and 46 existing warnings outside the Task 4 files.
- Workflow parsing through `Bun.YAML.parse` — passed.
- `bun run test:scripts` — 52 passed, 0 failed.
- `git diff --check` — passed.
- Local fixture image build/probe — not run because the local Docker daemon is unavailable; CI owns this integration execution.

## Review

Self-review found no blocker, high, or medium issues. Scope is limited to the Task 4 runner, contracts, fixture, package scripts, workflow modes, and this report. Residual risk is the unexecuted local Docker fixture build/probe; provider-free contracts cover image-policy branches, readiness behavior, exact status enforcement, cleanup, and sanitization, and CI runs the real fixture integration.

## CI seed and cleanup follow-up

CI run `31496480992` built the fixture image but PostgreSQL rejected the raw JSON-expansion seed with `cannot extract elements from a scalar`. The seed now parses the fixed JSON in Bun, verifies the exact ordered six-action canonical set, and uses postgres.js `${tx.array(actions)}` support in a tagged insert so PostgreSQL receives one typed array parameter. The JSON scalar expansion was removed.

Cleanup now explicitly deletes the dedicated credential, then its agent, then the owning user in one transaction. Container, database, and temporary-directory cleanup failures are aggregated; underlying diagnostics remain discarded, while the gate exits nonzero with one fixed sanitized cleanup error. Provider-free contracts were observed RED for typed-array binding, FK-safe order, and visible cleanup failure, then passed with 12 tests and 52 expectations. Focused ESLint, Bash syntax, API/protocol build, CLI-spec typecheck, and `git diff --check` also passed. The report was moved from the repository root into the established Task 4 SDD directory. The local Docker daemon remains unavailable, so the real PostgreSQL fixture rerun remains pending CI.

## Deep-review remediation

All accepted Critical, Important, and Minor findings from the Task 4 deep review were addressed:

- The seed now creates the exact global canonical `agent_permissions` row plus an active, exactly bound Hermes agent and active dedicated credential. Before any older image starts, the runner calls the current production `resolveHermesAgentCredential` database path and verifies the full binding. Both seed and positive proof assert the historical API-key hash is absent from `apikey`; any failure is fixed-message and credential-free. The handwritten contract server now hashes incoming keys with the historical SHA-256 base64url algorithm rather than comparing raw credentials.
- PR CI derives `751f5a7ed143150488543db9a1b4ee1f1b833bfc` with `git merge-base origin/main origin/feat/hermes-secure-standalone-connect`, verifies the approved topology pin and ancestry, exports that commit without touching the checkout, and builds its real compiled API production entrypoint. Its artifact filename, artifact name, and step summary record the exact base SHA, while the exact four-field compatibility report records the local image ID and is explicitly non-production evidence.
- Cleanup becomes eligible as soon as `fixture_id` exists and idempotently deletes permission → credential → agent → user, including when a seed commits and later exits nonzero. All cleanup branches remain attempted and failures produce one fixed sanitized error.
- Docker request logging is disabled with `--log-driver none`; the independent-external-sink operator caveat is documented above.
- Protected image verification inspects every RepoDigest and requires the canonical supplied repository and digest pair, not a suffix-only alias. The report preserves the verified supplied reference.
- Both the contract fixture image and rollback-base build use Bun `1.3.14-alpine` pinned to `sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0` and install only from the committed repository lockfile with `--frozen-lockfile`; no live `bun add` remains.

The remediation contracts were observed RED with 13 failures spanning current-auth proof, post-commit cleanup, repository identity, no-log launch, real-base workflow, historical hashing, and supply-chain pinning. Final focused validation passed 20 tests / 92 expectations, focused ESLint, Bash syntax and no-`set -x`, API/protocol build, CLI-spec typecheck, full API lint with zero errors (46 existing warnings), workflow YAML parsing, rollback topology derivation, pinned-base registry digest verification, and `git diff --check`. Real Docker/PostgreSQL integration remains pending CI because the local Docker daemon is unavailable.
