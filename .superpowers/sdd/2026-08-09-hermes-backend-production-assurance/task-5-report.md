# Task 5 — Privacy-safe Hermes runtime telemetry

## Result

Implemented a narrow synchronous Hermes runtime telemetry adapter over Sentry metrics. Its public API accepts only compile-time enums for event, gauge, observation, and reason names; runtime validation rejects every other name, attribute key, reason, non-finite number, and negative count/duration with fixed credential-free errors. The sole event dimension is the bounded `reason` enum. Sink exceptions are suppressed, while validation and every business exception retain their original behavior.

Instrumented authorization start/completion/expiry/replay, stable credential denial, credential rotation/revocation/revocation-pending, expiry-health gauges, stale-runtime Index coverage, runtime conflicts, advisory-lock wait, pending response outboxes, outbox replay attempts, and outbox delivery server failures. No telemetry call receives an owner/user/agent/installation/credential/request/code/verifier/API-key/negotiation/run/capability/message/free-text value. Advisory wait is measured directly around `pg_advisory_xact_lock` with no label and no awaited telemetry work. Outbox counters are emitted at the independent pending/replay branches only; ordinary committed responses do not count as replays.

Extended `sanitizeForLog` recursively for authorization, exact code/verifier, API-key, secret, password/token, and credential-like field names while preserving existing embedding redaction, truncation, and unrelated fields.

## RED evidence

- `bun test src/lib/agent/tests/hermes-runtime-telemetry.spec.ts src/lib/tests/log.spec.ts` — failed because the adapter module did not exist and authorization/code/verifier/credential-like values were not redacted.
- `bun test src/controllers/tests/hermes-authorization.controller.spec.ts` — 5 expected telemetry integration failures; the injected sink remained empty for lifecycle, expiry, replay, denial, and revocation-pending paths.
- `bun test tests/agent-runtime.service.spec.ts` — the new runtime lifecycle telemetry seam failed with an empty event list.
- `bun test src/lib/agent/tests/hermes-runtime-telemetry.spec.ts` — failed because the advisory-lock observation helper was absent.
- `bun test ./src/services/tests/negotiation-polling.pickup-authority.isolated.ts` — 5 expected failures for pending-outbox gauge/replay, delivery server error, and stable post-race denial telemetry.
- `bun test ./src/services/tests/negotiation-polling.respond-atomic.isolated.ts` — the pending replay test failed after the response replay increment was deliberately absent.

## GREEN evidence

- Focused adapter/redaction suite: 7 passed, 0 failed, 53 expectations.
- Combined Task 5 adapter and integration seams: 74 passed, 0 failed, 326 expectations.
- Agent runtime controller suite: 19 passed, 0 failed when run provider-free after protocol build.
- Static isolated-test inventory: 14 passed, 0 failed, 66 expectations.
- Compile-time telemetry boundary command completed with no diagnostics, including all `@ts-expect-error` identity/free-text dimension assertions.
- Focused ESLint completed with no findings.
- API build (`protocol build` plus API `tsc`) passed.
- CLI-spec typecheck passed.
- Full API lint passed with 0 errors and 46 pre-existing warnings outside Task 5 files.
- `git diff --check` passed.

## Safety and scope

No database-backed test or database command was run, and `TEST_DATABASE_SAFE` was not set. One attempted mixed provider-free test invocation included `negotiation-polling.remaining-budget.spec.ts`; its import reached the fail-closed database readiness guard and refused immediately because `TEST_DATABASE_SAFE=1` was absent. No database operation ran. The unrelated `negotiation-polling.fixture-contract.spec.ts` also reports pre-existing static-parser findings in `tests/negotiation-runtime-authority.database.isolated.ts`; Task 5 did not alter that fixture or parser.

Scope is limited to the Task 5 telemetry adapter, recursive log redaction, the planned production integration seams, exact adapter/integration tests, and this report. No settings, schema, migration, workflow, package, authority, response, or transaction semantics were changed.

## Critical/Important review remediation

Addressed every finding from `.pi-subagents/artifacts/c6d8c06a_reviewer_0_output.md`:

- Sentry metadata now classifies each top-level key before value conversion. A fresh-process mocked `@sentry/bun` test covers every bounded sensitive top-level key and proves only `[REDACTED]` reaches Sentry attributes.
- Key matching now handles bounded mixed-case/separator variants including authorization, API, bearer, access, and refresh token fields. Error messages redact only established `idxh_` and `idxo_` credential shapes; nested/cyclic causes and cyclic plain objects terminate safely, while unrelated prose, status fields, token counts, and incomplete documented prefixes remain unchanged.
- `increment` now uses a generic exact-key constraint. Type compilation proves direct literals, aliases, and spreads carrying identity/free-text keys are rejected; ergonomic no-attribute and reason-only calls remain valid. Runtime spread/computed-key rejection remains covered.
- The former per-request boolean expiry gauges were removed. A dedicated adapter issues one aggregate query with indexed expiry bounds and active-state predicates for authoritative seven-day near-expiry and expired counts. Gauges refresh after approval rotation, activation, revocation/retry, normal active authentication, and active expiry denial. Snapshot-query or sink failure remains isolated from authority behavior.
- The revocation store now returns internal transition metadata while the public receipt remains unchanged; `credential_revoked` emits only for the first transition. Already-delivered response replays skip both delivery and `outbox_replay_attempted`.
- Missing controller credentials and malformed, unknown, expired, revoked, or stale active-guard credentials emit exactly one privacy-bounded `auth_denied`/`credential_rejected` pair with stable enum reasons. Lower layers do not recount these guard/controller denials.

### Remediation RED evidence

- Log tests first failed for `authorizationToken`, `api_token`, `bearerToken`, raw `idxh_`/`idxo_` error messages, nested causes, and raw top-level Sentry attributes (3 failures).
- The focused TypeScript command reported two unused `@ts-expect-error` directives because aliased and spread attributes still compiled.
- Authorization/guard/polling/count-seam tests first produced 14 expected failures plus the missing count-adapter module: request booleans remained, missing-header and guard denials emitted nothing, idempotent revocation/replay double-counted, and aggregate gauges were absent.
- The approval lifecycle test was observed failing with an empty gauge list before rotation refresh was added.

### Remediation GREEN evidence

- Final focused Task 5/runtime matrix: 136 passed, 0 failed, 645 expectations across adapter, mocked Sentry, redaction, authorization controller, active guard, runtime, and polling seams.
- Static isolated inventory: 14 passed, 0 failed, 66 expectations.
- Both new isolated tests passed through the registered fresh-process import harness (1/1 each).
- Exact telemetry type compilation and CLI-spec typecheck passed without diagnostics.
- API/protocol build passed.
- Full API lint passed with 0 errors and the same 46 pre-existing warnings outside Task 5.
- `git diff --check` passed.

No database-backed test or database command was run during remediation, and `TEST_DATABASE_SAFE` remained unset. The aggregate adapter is covered through an injected query seam and source-level bound assertions; real PostgreSQL execution remains owned by the guarded CI assurance suite.

## Remaining Important review remediation

Addressed both findings from `.pi-subagents/artifacts/baf2630b_reviewer_0_output.md`:

- Active Hermes authentication no longer awaits or starts the aggregate expiry query before deciding authority. It performs an early expired-row rejection and a second expiry comparison at the final boundary after authority and owner lookup. Only after success or a stable post-lookup rejection does a microtask-scheduled helper start the aggregate snapshot; the helper attaches a terminal rejection consumer so query and sink failures remain off the business promise path.
- Deterministic clock and deferred-query tests prove a credential expiring during authority lookup is rejected, pending aggregate work delays neither success nor stable rejection, delayed aggregate rejection is handled without an unhandled rejection, and denial metrics remain exactly once.
- The bounded `idxh_`/`idxo_` matcher now applies to every sanitized string, including direct string `Error.cause`, arbitrary nested object values, and array values. Existing incomplete-prefix and unrelated-prose controls remain unchanged. Mocked production Sentry assertions prove these string paths do not reach attributes.

### Remaining findings RED evidence

- `bun test src/lib/tests/log.spec.ts ./src/lib/tests/log-sentry.isolated.ts src/guards/tests/hermes-agent-audience.spec.ts` produced 6 expected failures: direct/nested credential strings remained visible, a credential expiring at the final boundary was admitted, and pending aggregate work delayed both success and rejection (41 passed, 6 failed).

### Remaining findings GREEN evidence

- Final focused telemetry/log/guard/controller matrix: 70 passed, 0 failed, 418 expectations across 5 files.
- Fresh-process mocked Sentry import: 1 passed, 0 failed, 27 expectations.
- Static isolated-test inventory: 14 passed, 0 failed, 66 expectations.
- Exact telemetry type compilation and API CLI-spec typecheck passed without diagnostics.
- Full repository build passed; the final API/protocol build was rerun after the fire-and-forget helper refinement.
- Repository and API lint passed with 0 errors; a final focused lint of all changed TypeScript files produced no findings.
- `git diff --check` passed.

No database-backed test or database command was run for this follow-up, and `TEST_DATABASE_SAFE` remained unset.
