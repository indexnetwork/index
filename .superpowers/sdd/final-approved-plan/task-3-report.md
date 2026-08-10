# Task 3 report — atomic historical quality base refresh and provider-free verification

## Status

DONE_WITH_CONCERNS. Implemented the guarded historical quality seed/publish lifecycle, strict writable target attestation, fresh read-only verifier handoff, adapter-owned embedding identity, CLI scripts, and provider-free lifecycle/attestation tests. No database, provider, Neon, Redis, Railway, migration application, or live operation was used.

Supervisor-approved Task 3 prerequisite moved forward from Task 4: `discovery-env-matrix.neon.ts` now strictly decodes endpoint `type` (`read_only` or `read_write`). Existing matrix consumers ignore the additional decoded field. The approved metadata mapping is: actual `computeSchemaMigrationFingerprint()` result, attestation root as `fixtureFingerprint`, attestation corpus version, and the canonical attestation object.

## TDD evidence

### Initial RED

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts
```

Observed: 0 pass, 1 fail, 1 error; expected missing `../discovery-quality-base` module.

### Self-review RED cycles

- Premise provenance mutation: 14 pass, 1 fail. The new test expected a changed reviewed provenance timestamp to be rejected, but verification resolved. Production now writes and verifies the fixed ISO timestamp.
- Verifier infrastructure-failure mutation: 15 pass, 1 fail. The new test showed `database unavailable` incorrectly entered the writable factory. The command now refreshes only classified `Historical quality base integrity failed:` states and closes/stops on unclassified failures.

### GREEN

Required compatibility command:

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts src/cli/tests/discovery-env-matrix-base.spec.ts
```

Observed during implementation: 47 pass, 0 fail, 461 assertions.

Final affected suite:

```bash
cd services/api
bun test src/cli/tests/discovery-quality-base.spec.ts \
  src/cli/tests/discovery-quality-refresh-target.spec.ts \
  src/cli/tests/discovery-env-matrix.neon.spec.ts \
  src/cli/tests/discovery-env-matrix-base.spec.ts
```

Observed: 62 pass, 0 fail, 549 assertions.

## Ordering and visibility proof

The injected fake database exposes committed state separately from transaction-local state. The success test records this exact lifecycle:

1. delete quality metadata;
2. check unexpected dependents;
3. replace exact fixture seed rows;
4. delete fixture candidate documents;
5. commit transaction 1;
6. observer reads committed metadata-absent/document-absent state;
7. provider receives exactly the 55 approved document texts outside a transaction;
8. write all candidate documents/vectors in transaction 2;
9. read the vectors back;
10. fingerprint only `Math.fround`-modeled DB rows through Task 2's `fingerprintHistoricalQualityVector`;
11. insert metadata/root;
12. run full published-state verification;
13. commit transaction 2.

The provider callback independently asserts one commit already occurred and that committed metadata and documents remain absent while provider work executes.

## Atomicity and mutation proof

Injected final-phase failures cover document/vector write, vector readback, candidate construction from non-finite readback, metadata insertion, and full verification. Every case leaves exactly one committed transaction: exact seed rows with candidate documents and quality metadata absent. The final transaction records rollback. An unexpected dependent fails after transaction-local metadata deletion but before fixture deletion can commit, preserving the prior published state.

Verifier mutations cover membership lifecycle, premise provenance, missing metadata, document presence in seed state, vector dimensions/finite values, canonical plan/seed/document fingerprints, metadata root/schema mapping, and provider-free `--verify` refusal without refresh fallback. Resource tests cover verified, stale, refreshed, unpublished, unclassified failure, and failed-writer close paths.

## Fixture ownership and deletion predicate review

Deletion predicates were independently reviewed:

- Users and the one network are never deleted; they are deterministic fixture-ID upserts, avoiding user/network cascades.
- Membership deletion is by each exact `(networkId, userId)` fixture pair.
- Intent-network, premise-network, intent, premise, context, and candidate-document deletion is restricted to projection-owned stable IDs.
- Before deletion, refresh rejects fixture-user extra intents/premises/contexts, assignments outside the fixture network, cross-boundary memberships, user socials, consumed-intent proposals, intent verification attempts, extra documents bound to fixture source rows, and fixture-actor opportunities.
- Read-only verification queries both expected IDs and fixture ownership scopes so extra fixture-owned rows fail exact cardinality/mapping checks.
- The legacy metadata row is not targeted by deletion and tests prove it remains present with null quality attestation.

## Validation

- Affected tests: 62 pass, 0 fail, 549 assertions.
- `bun run typecheck:cli-specs`: passed.
- `bun run build`: passed (protocol build plus API TypeScript build).
- Focused ESLint over all changed TypeScript files: passed with no output.
- `git diff --check`: passed.

## Self-review

- Provider binary64 vectors are validated only as write inputs. All attestation vector fingerprints are created from DB-readback rows via the Task 2 float32-canonical API.
- Provider/model/dimensions/configuration fingerprint come from the actual `EmbedderAdapter` instance. Its database dependency is now lazy so identity construction and verifier tests compose no database.
- The verifier child adds `transaction_read_only=on`, checks the server setting, strips provider/embedding/model, Redis, Neon, and target-manifest variables, and never creates the refresh/provider factory.
- Strict v2 parsing rejects unknown keys, wrong database/path/port/host, and target mismatch. Control-plane attestation binds project request, branch ID/name/non-primary status, endpoint ID/branch/host, and `read_write` type before the branded target can spawn a runtime.
- Attest-only composition has no database/provider/reset/migration/seed/runtime dependency.
- Canonical fingerprints are locked to the independently approved plan, seed projection, and document set digests.

## Concerns / residual risks

- Per instruction, no live PostgreSQL/pgvector integration was run. Transaction/readback behavior is proven with an injected transactional fake, while production Drizzle queries are covered by TypeScript build/lint only. A disposable-database integration remains the residual validation risk.
- Candidate premise/context provenance is stored explicitly in `hyde_documents.context`; the physical legacy `hyde_documents.source_type` is `context` because its existing application type does not admit `premise`. Verification binds the true source type, row ID, source paths, text, target frame, and content fingerprint from the explicit quality context.
