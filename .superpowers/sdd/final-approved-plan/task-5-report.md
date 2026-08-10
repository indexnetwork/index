# Task 5 report

Status: COMPLETE — all three review findings closed fail-closed

Implementation:

- Added explicit `--historical-quality-child` recognition before legacy parsing and a versioned dynamic child-runtime export contract. The parent invokes the same child module’s preflight before topology attestation; because Task 6 has not supplied that module, confirmed production requests and direct child requests refuse before attest, verify, restore, or spawn. There is no permissive placeholder.
- Kept the planner fingerprint as the full canonical `HistoricalResolvedConfig`, independently recomputed it from the exact resolved object before restore, and verified every planned slot carries it.
- Added a separate SHA-256 fingerprint over the exact canonical sanitized child config JSON. The child environment carries JSON plus its digest; dispatch argv carries that digest and the distinct full resolved-config digest.
- Extended strict verifier metadata to the full embedding provider/model/dimensions/configuration fingerprint. The parent recomputes the identity fingerprint and reconciles effective runtime `EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` before restore.
- Added the reusable strict version-1 `HistoricalQualityChildOutputSchema`, composed from the PR A transport-row and execution-run schemas. It permits exactly one of each, rejects unknown fields, and binds run, slot, configuration, fingerprint, case, trigger, and repetition identities.
- Provider-account fingerprint remains parent-only. Legacy/help-first behavior and serial side-a scheduling remain intact.

TDD and validation:

- RED: API focused tests failed on legacy child fallthrough, absent child-env digest, missing child preflight, old verifier metadata, and missing dual fingerprints; protocol child-output test failed because the strict schema module did not exist.
- GREEN: `cd services/api && bun test src/cli/tests/discovery-quality.runtime.spec.ts src/cli/tests/discovery.parent.spec.ts src/cli/tests/discovery.quality.spec.ts src/cli/tests/discovery.neon.spec.ts src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-quality.contract-audit.spec.ts` — PASS, 249 tests / 547 assertions.
- `cd packages/protocol && bun test eval/discovery-env-matrix/tests/historical-quality.child-output.spec.ts eval/discovery-env-matrix/tests/historical-quality.pilot.spec.ts eval/shared/tests/artifact.spec.ts src/shared/agent/tests/model.resolver.spec.ts src/shared/agent/tests/model-overrides.spec.ts src/shared/agent/tests/model.config.spec.ts` — PASS, 119 tests / 247 assertions.
- `cd services/api && bun run typecheck:cli-specs && bunx tsc --noEmit --pretty false` — PASS.
- `cd packages/protocol && bunx tsc --noEmit --pretty false` — PASS.
- `cd packages/protocol && bun run build` — PASS.
- `cd services/api && bun run build` — PASS (including protocol rebuild).
- `cd services/api && bun run lint` — PASS with 46 pre-existing warnings and 0 errors.
- `bun run check:subtree-parity` — PASS.
- `git diff --check` — PASS.

No database, Neon, Redis, provider, reset, spawn, or other live operation was performed.

Residual risk: Task 6 must implement the exact versioned child-runtime module contract. Until then production intentionally refuses before topology attestation. Task 8 must import and reuse `HistoricalQualityChildOutputSchema`; it must not redeclare the child output envelope.
