# Task 4 — Previous API compatibility assurance

## Result

Implemented the fail-closed previous-production API compatibility gate. Protected runs require a release-ops supplied `repository@sha256:...` reference, pull and resolve its exact repository-and-digest match, run it against the migrated loopback `hermes_assurance` database, and require an exact `401` from `GET /agents/me` for a freshly seeded dedicated Hermes credential. PR evidence is explicitly labeled non-production and builds the real API production entrypoint from the topology-derived approved rollback base; the handwritten legacy-table server remains only a runner contract fixture.

## Security contract

- The dedicated credential is generated afresh and reaches child processes only through environment, stdin, or process memory; it is never placed in argv, files, logs, or reports.
- The probe uses curl configuration on stdin, never a credential-bearing header argument.
- The probed container uses Docker's `none` log driver. Release operations must also establish that an approved image has no independent external logging sink that records request headers; Docker cannot disable a sink implemented inside the image.
- Database seed failures discard diagnostics and emit a fixed credential-free error.
- A unique nonsecret container name is generated and both stop/removal are marked pending before bounded `docker run --name`; the exit trap can therefore target a container even when launch creates it and then fails or hangs before returning.
- Container stop and force-removal use GNU `timeout` with explicit TERM/KILL deadlines. Absence checks are bounded and exact-name filtered; an already-absent container is `not-needed`, stop failure is recoverable when force-removal succeeds, and cleanup fails only when bounded force-removal cannot prove absence.
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

## Exact-head proof-process hang follow-up

Exact-head CI run `31499701250` built the real rollback image and then hung before container startup because importing the current `auth.guard` opened the shared database pool; the inline positive-proof Bun process completed its queries but retained global handles. The proof now throws on every mismatch, closes its local postgres.js client in `finally`, and calls `process.exit(0)` only after those assertions and `sql.end()` succeed. Assertion, resolver, query, or close failures therefore still exit nonzero through the existing fixed sanitized proof error.

The seed, current-proof, and cleanup Bun subprocesses are each wrapped with GNU `timeout --signal=TERM --kill-after=5s 20s`. Credential and hash values remain environment-only, never timeout argv or output. A timed-out seed/proof produces its existing fixed failure and enters idempotent cleanup; a timed-out cleanup produces the fixed cleanup failure after the other cleanup branches are attempted. The timeout harness was observed RED at roughly three seconds when the fake proof retained a handle, then completed in under one second through the timeout seam. Final provider-free result: 22 tests / 99 expectations. Real exact-head Docker/PostgreSQL confirmation remains pending CI.

## Exact-head route and failure-diagnostic follow-up (run 31503086936)

The rollback-base API exposes the historical controller at `/api/agents/me`, not `/agents/me`. The synthetic server now exposes only that exact path, the fake curl parses its stdin config and refuses anything other than `http://127.0.0.1:<numeric-port>/api/agents/me`, and the real runner probes the same route. This contract was observed RED: successful cases exited through the fake curl's wrong-route refusal before the runner path changed.

The runner now creates an atomic fixed-schema diagnostic before any compatibility work, records fixed phase boundaries, and finalizes it from the EXIT trap after all cleanup attempts. Its only fields are schema version, fixed-enum phase/outcome, numeric health/probe statuses, and fixed-enum container/database cleanup results. Tests cover successful finalization, seed failure, probe failure, and rejection of credential/hash/database/image/ID-like material. PR and protected jobs always upload the diagnostic from the fixed `services/api/previous-api-compatibility-diagnostic.json` path under the fixed `previous-api-compatibility-diagnostic` artifact name with missing-file failure; the four-field success report remains a separate conditional artifact.

Provider-free validation passed the focused contract suite (`23 tests, 112 assertions`), shell syntax and no-`set -x`, workflow YAML parsing, targeted ESLint, API build, CLI-spec typecheck, package lint with zero errors and 46 pre-existing warnings, script tests, and `git diff --check`. The real rollback image and disposable PostgreSQL integration remain CI-only.

## Exact-head bounded named-container cleanup follow-up

At exact head `79a971bb1`, cleanup eligibility still depended on `docker run` returning a container ID and Docker stop/removal were unbounded. The runner now derives a UUID-backed nonsecret container name, records both fixed-enum cleanup fields as `pending`, and enables the EXIT cleanup target before invoking bounded detached launch with `--name` and the `none` log driver. Launch output and failures are discarded behind the existing fixed sanitized failure message; credential and database values remain environment-only.

The trap first performs a bounded exact-name absence check. If present, it wraps `docker stop --time 5` and `docker rm --force` independently with GNU `timeout`, explicit TERM, and explicit KILL-after deadlines. A stop timeout does not fail an otherwise successful gate when force-removal succeeds. An already-absent container finalizes both cleanup enums as `not-needed`; a failed or timed-out force-removal is fatal only when a second bounded check cannot prove absence. Cleanup remains idempotent and emits no container ID.

Fake-Docker contracts were observed RED before implementation and now cover create-then-fail launch, create-then-hang launch, hanging stop followed by successful force-removal, hanging stop plus hanging force-removal, already-absent cleanup, and fixed diagnostic enums. The fake dependencies deliberately emit credential/database/image/ID-like failure text; runner output and diagnostics remain sanitized. The Task 4 local fixture command now uses the repository root Docker build context (`../..`) with the fixture Dockerfile selected by `-f`.

Final provider-free validation passed: focused compatibility contracts (`29 tests, 144 assertions`); Bash syntax and explicit no-`set -x`; workflow YAML parsing; API build; CLI-spec typecheck; full API lint with zero errors and 46 pre-existing warnings; script contracts (`52 tests, 181 assertions`); and `git diff --check`. No local Docker/PostgreSQL probe was run, no database command was invoked, and no operator-shell `TEST_DATABASE_SAFE` value was exported for a database operation.
