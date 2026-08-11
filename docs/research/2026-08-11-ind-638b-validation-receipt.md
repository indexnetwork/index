# IND-638B guarded historical-quality runtime validation receipt

Date: 2026-08-11  
Issue: IND-638  
Branch: `feat/historical-quality-runtime`

## Receipt boundary

This receipt validates the immutable implementation head:

- implementation head: `7fa3eb12e43d47c7dd018ea4b4954044a1b6e7d3`
- reviewed base and merge-base: `88c8e9d881047fef965e60061fe130e64242c94e`
- binary implementation diff SHA-256: `261aab73bfc1244a39eede359100f3f4b312c28f19a16c1bbac795cabc3f25bd`
- implementation diff: 68 files, 18,807 insertions, 274 deletions

The receipt is committed after that head and does not validate itself. No merge authorization is implied by implementation, review, validation, receipt publication, push, CI, or PR creation.

## Delivered scope

The reviewed head provides the IND-638B CLI-only historical-discovery quality runtime and operations boundary:

- strict v2 Neon topology with one protected base, a dedicated read-only base endpoint, a distinct writable refresh endpoint, and durable writable A/B children;
- protected fixture seed/publication lifecycle with transactional DB-round-tripped vector and metadata attestation;
- strict float32 vector fingerprinting, including DB-readback-only canonicalization;
- fresh-process read-only base verification and restored-child verification before dependency construction;
- serial restore-before-slot execution with one terminal attempt per slot;
- trusted-host operation leasing rooted at literal `/tmp`, including cross-user contention and token/inode-bound atomic release;
- intent and enrichment triggers built through production-shaped authorities;
- namespaced HyDE cache access without broad flush authority;
- canonical child transport, aggregation, completeness, no-verdict, and operational-failure semantics;
- guarded disposable-database proof and integration coverage;
- CLI-only launch governance; Eval Ops remains presentation-only for historical-quality artifacts;
- a fixed, fingerprinted historical-quality provider runtime: OpenRouter default base URL, 60-second request timeout, zero HTTP retries, no fallback model, and one runnable attempt;
- production-aware `EVAL_MODEL_OVERRIDES` resolution matching the actual protocol model-construction rule.

Current inherited package versions at the validated base are API `0.79.1`, protocol `11.0.1`, and Eval Ops `0.6.0`; root lock entries match.

## Provider-free validation

A fresh complete Task 10 matrix ran at the exact implementation head with DB, Neon, Redis, Railway, provider credentials, paid evaluation, live operations, and the complete opportunity-graph spec excluded.

Results:

- focused tests outside `eval:verify`: **1,456 pass, 12 guarded DB skips, 0 fail**;
- protocol historical-quality: 109 pass;
- protocol shared artifacts/runner/Ops: 299 pass;
- protocol model configuration/resolution: 34 pass;
- API quality/runtime/TLS/lease: 232 pass;
- guarded integration in sanitized posture: 7 pass, 12 expected skips;
- legacy discovery: 314 pass;
- environment matrix: 75 pass;
- isolated trigger/queue groups: 43 pass;
- `eval:verify`: **13/13 suites** typechecked and tested provider-free;
- Eval Ops: 313 tests pass.

Applicable build and static gates passed:

- protocol and API builds;
- API CLI-spec typecheck;
- Eval Ops typecheck/build;
- protocol architecture inventories: 420 exports, 43 capability directions, zero forbidden host imports, zero cycles across 276 runtime modules, and 605 clean package artifacts;
- Drizzle generation: 55 tables, no schema changes;
- protocol atlas: 60 nodes and 67 edges, current;
- subtree parity: 9 ranges across 4 mirrored packages;
- 16 Agent Skills and 16 Codex skills validated;
- package/lock version checks, migration inventory, exact grep guards, ignored-scratch checks, `git diff --check`, staged-file checks, and clean-worktree checks.

Lint completed with zero errors. Existing warnings remain: API 45 and Eval Ops 7.

## Evaluation database evidence

All operations targeted the non-primary evaluation topology in Neon project `shiny-cloud-34341469`, database `protocol_eval`. No production database was used.

Attested topology:

- protected base branch: `br-wispy-queen-ahmxwx1s` (`eval-discovery-base`);
- writable refresh endpoint: `ep-snowy-bonus-ahne2ja6`;
- read-only base endpoint: `ep-lingering-moon-ah02daid`;
- disposable side A: branch `br-old-meadow-ahw6rnu1`, endpoint `ep-polished-art-ah5los9h`;
- disposable side B: branch `br-snowy-math-ahnnrwew`, endpoint `ep-silent-morning-ahuup7xq`.

The read-replica recovery record remains outside the repository at `/home/yanek/.local/state/index/ind-638-read-replica.json` under the runbook's mode-0600 contract.

Operational evidence:

1. A fresh read-only query reports 122 database migrations. The reviewed local journal ends at `0122_add_eval_matrix_quality_attestation`, and generation reports no schema drift.
2. The published base verifier confirms the exact reviewed projection: 25 users, 55 retrieval documents, corpus `historical-shared-pool-v1`, one non-null historical-quality metadata row, and 55 fixture-owned published document rows.
3. Read-only verification through `ep-lingering-moon-ah02daid` confirmed `transaction_read_only=on`, model `openai/text-embedding-3-large`, 2,000 dimensions, and embedding configuration fingerprint `8255f4e7fc17c7345e75a0f8fe7d797eaba4ace510eb7fd76c747cda0aefd213`.
4. Side A was restored from the verified base and re-attested before SQL construction.
5. At the exact validated implementation head, target proof identified non-primary writable side A, exact parent/base, exact endpoint, and exact `/protocol_eval` database without emitting a URL.
6. The guarded integration file completed **17 pass, 0 fail** in 364.58 seconds. Ten DB-backed cases proved exact seed/state ownership, atomic provider-free vector publication, rollback at four injected finalization stages, stale-state detection, drift replacement and dependent refusal, read-only base behavior and exact child equality, and mocked provider seams only. Seven additional target-proof contract/adversarial cases passed.

The guarded child environment excluded provider and Redis credentials. Raw DB output was captured mode-0600 and deleted on success so connection material and vectors were not retained.

## Independent review

Independent final review of the exact implementation head returned:

- Critical: none;
- Important: none;
- Minor: none;
- verdict: **READY FOR RECEIPT**.

The review re-audited topology, TLS, publication, float32 identity, verifier isolation, restore ordering, child construction ordering, lease authority/release, confirmations, provider-account and scoring fingerprints, intent/enrichment execution, cache isolation, artifact completeness/no-verdict behavior, DB safety, Eval Ops exclusion, migrations, versions, retry prohibition, and secret handling.

A prior Important finding—effective HTTP/runnable retries, fallback, base URL, timeout, and production model-override behavior were not fully bound by scoring identity—was fixed in `7fa3eb12e`. The final review confirmed the fixed runtime cannot be bypassed by inherited or configured values and is included in planner and child-verifiable fingerprints.

## Disclosed diagnostics and failed attempts

The following stopped attempts informed the final implementation and are not presented as passing evidence:

- One overbroad early validation command unintentionally invoked the existing live-provider opportunity test. It made provider calls but no DB, Neon, or Redis mutation.
- Initial base verification failed closed because TLS was not explicit. Historical-quality-only TLS binding was then added and reviewed.
- A stage-only diagnostic had a syntax error and performed no DB write or provider call.
- Initial publication reached vector readback but rejected PostgreSQL's binary64 text-decoded float32 values. Canonicalization was restricted to typed pgvector DB readback; raw provider binary64 values remain rejected.
- Bun's test worker auto-loaded the repository `.env.test` and replaced the attested `/protocol_eval` URL with `/neondb`; the target guard refused it before DB access. The runbook now executes the guarded spec from a fresh mode-0700 temporary cwd.
- Guarded-suite diagnostics exposed bounded-hook timing, unspecified PostgreSQL row ordering, delimiter-colliding tuple sort keys, redundant restoration, and a Bun matcher hang on a postgres.js query thenable. Each was fixed with provider-free tests and independent review. Failed/timed-out runs were followed by exact published-state verification before another controlled attempt.
- One later exact-head attempt failed before mutation with a transient `CONNECTION_CLOSED`; side A was verified pristine before the final successful run.

## Residual and rollout risks

- The lease is host-local and cannot exclude a second machine; the runbook requires one designated host.
- Read-replica lag and the base-verification-to-restore window remain possible; restored-child verification is the compensating control.
- Embeddings and live scoring remain provider-dependent.
- The legacy smoke, intent smoke, enrichment smoke, and ten-slot pilot are separately authorized post-merge rollout stages. They are not PR-B pre-merge gates and were not run for this receipt.
- One-repetition smoke and pilot results will be descriptive evidence, not statistical proof or a target-score gate.
