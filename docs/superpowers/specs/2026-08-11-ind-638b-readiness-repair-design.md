# IND-638B PR readiness repair design

Date: 2026-08-11
PR: #1365

## Goal

Make the guarded historical-quality runtime safe and merge-ready against current `dev` without performing rollout operations or inferring merge authorization.

## Scope

1. Rebase `feat/historical-quality-runtime` onto current `origin/dev`, preserving current-dev changes and inventories.
2. Freeze historical-quality embedding HTTP behavior at the client boundary: zero SDK retries and a 60-second request timeout for quality child execution and protected-base refresh.
3. Reject strict quality database URLs unless they contain a non-empty, decodable username and password, before attestation, restore, or database construction.
4. Enforce writable protected-base refresh authorization inside the bootstrap: exact `IND_638_CONFIRM='refresh IND-638 historical quality protected base'` and `TEST_DATABASE_SAFE=1`. Read-only `--verify` remains free of the writable confirmation and provider credentials.
5. Bump touched packages above current dev: Protocol to `11.0.3`, API to `0.80.1`, Eval Ops unchanged at `0.6.0`; regenerate the root lockfile and version audit.
6. Remove receipt trailing whitespace without changing immutable validation claims.
7. Revalidate the exact implementation head, independently review it, then commit a separate non-self-referential receipt addendum.
8. Push, verify hosted checks, and request GitHub Copilot review. Do not merge.

## Design

### Embedding runtime policy

Extend `EmbedderAdapter` construction options with explicit request-runtime fields using OpenAI SDK option types. Historical-quality callers pass code-owned constants (`maxRetries: 0`, `timeout: 60000`); ordinary production callers retain existing SDK defaults. Tests inspect the constructed client through an isolated OpenAI module seam and prove both explicit quality policy and unchanged default behavior.

### Strict URL credentials

`assertNeonPostgresUrl` requires non-empty `URL.username` and `URL.password`. Percent-encoded values must decode without error and decode to non-empty strings. Errors remain sanitized and name only the manifest field. Apply this only to strict quality topology/refresh URLs; legacy A/B compatibility behavior remains unchanged unless its existing parser already opts into strict mode.

### Writable refresh authorization

`runHistoricalQualityBaseBootstrap` parses arguments before control-plane construction. For writable mode, it checks the exact dedicated phrase and disposable marker before control-plane calls, database construction, or provider construction. `--verify` does not require writable authorization and continues through the read-only replica. Unsupported arguments fail before either path.

### Integration and versioning

Rebase onto `origin/dev`. Preserve current-dev package changes and `.test-isolated` entries. Use patch bumps because this repair corrects operational behavior in already-added package surfaces rather than adding a new public feature. Update changelog and lockfile consistently.

### Evidence

Follow TDD for each defect. Provider-free validation precedes any guarded DB work. The guarded DB suite may run only through its existing exact disposable-side proof and sanitized environment. The receipt addendum validates an immutable implementation head and is committed afterward, so it never validates itself.

## Error handling and safety

- Missing or wrong refresh authorization fails before Neon, DB, provider, Redis, or restore work.
- Invalid credentials in URLs fail without echoing URLs or values.
- SDK retry/timeout policy is explicit and fingerprint-aligned for historical-quality operations.
- No live smoke, pilot, provider inference, Redis operation, base refresh, or other rollout operation is part of this repair.
- Failed validation stops; no automatic reruns without diagnosis.

## Acceptance

- New tests fail on the old behavior and pass after minimal fixes.
- Current-dev rebase is conflict-resolved without dropping either side’s inventory or functionality.
- Protocol `11.0.3`, API `0.80.1`, Eval Ops `0.6.0`, and lockfile agree.
- `git diff --check` passes.
- Targeted provider-free checks, builds, typechecks, lint/static inventories, migration checks, and `eval:verify` pass.
- Exact guarded DB proof and integration tests pass on the immutable implementation head.
- Independent whole-branch review has no Critical, Important, or Minor findings.
- Separate receipt addendum is approved and committed.
- Hosted checks pass and GitHub Copilot review is requested.
- PR remains open and unmerged.
