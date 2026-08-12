# IND-638B readiness-repair validation receipt

Date: 2026-08-11
PR: `#1365`

## Immutable validation boundary

This receipt validates implementation head:

- implementation head: `637f11f0f42548bfc53dfcaa927ec2bf4746ae5b`;
- current-dev base and merge-base: `c23549eb25dae6caaa6b412282bbb4d45936052a`;
- binary branch diff SHA-256: `a35c3593e641483566388f50b617e173042fd7121ee153e22d53955bb33725d4`;
- branch diff: 75 files, 19,400 insertions, 283 deletions.

This receipt is committed after that implementation head and does not validate itself. It supplements the earlier receipts for the pre-rebase implementation and provider-free CI repair.

## Readiness repairs

The implementation head resolves the verified PR review findings:

- Historical-quality embedding clients pass OpenAI SDK `maxRetries: 0` and `timeout: 60000`; ordinary adapter callers retain SDK defaults.
- Strict quality v2 and writable-refresh database URLs require non-empty decodable username and password, while legacy unversioned/v1 A/B parsing remains compatible.
- Writable protected-base refresh requires exact `IND_638_CONFIRM='refresh IND-638 historical quality protected base'` and `TEST_DATABASE_SAFE=1` in production code before control-plane construction; read-only verification bypasses the writable gate.
- The branch is rebased onto current dev and preserves its package/inventory changes.
- Package versions and lockfile are Protocol `11.0.3`, API `0.80.1`, and Eval Ops `0.6.0`.
- Receipt whitespace was corrected and `git diff --check` passes.

Each behavior repair used an explicit provider-free red/green cycle and received an independent task review. The final whole-branch review found zero Critical, Important, or Minor findings and returned **READY FOR GUARDED DB**.

## Provider-free exact-head evidence

At `637f11f0f42548bfc53dfcaa927ec2bf4746ae5b`:

- the all-CLI suite, run from a fresh mode-0700 temporary cwd with absolute paths and provider keys absent, completed **783 pass, 12 guarded DB skips, 0 fail** across 28 files;
- Protocol build and all 14 `eval:verify` suites passed;
- Protocol architecture export, consumer, and host-isolation gates passed;
- API build, CLI-spec typecheck, and lint passed; lint reported zero errors and 45 warnings;
- Eval Ops build passed;
- subtree parity, skills validation, isolated-test inventory, and credential-free embedder/model tests passed;
- Drizzle generation reported no schema or migration drift;
- the worktree and staged index remained clean.

An unnecessary filtered diagnostic loaded the restricted live-containing `opportunity.graph.spec.ts`, then failed during loader transformation before executing any test. It made no provider request and is not counted as evidence.

## Exact-head guarded database evidence

The separately guarded database gate was run against the same immutable implementation head. It first proved exact non-primary side A on database `protocol_eval`, its protected-base parent, its read-write endpoint role, the dedicated base read replica, and the separately attested writable refresh endpoint without printing secure URLs.

The full guarded integration suite completed **17 pass, 0 fail**. It verified exact ordered seed state, provider-free atomic publication with round-tripped float32 vectors, rollback for injected failures, stale-state detection, owned-state replacement and dependent refusal, read-only base verification, exact restored-child equality, and mocked provider seams. No model/provider adapter was constructed.

## Operational disclosures and remaining boundary

Earlier receipts disclose prior diagnostic provider and connection failures. During this readiness repair no provider inference, Redis operation, protected-base refresh, smoke, pilot, or rollout operation was performed.

The filesystem lease remains host-local and does not claim cross-host exclusion. Live legacy smoke, intent smoke, enrichment smoke, and the ten-slot pilot remain separately authorized post-merge rollout stages.

Validation, receipt publication, push, hosted checks, and GitHub review do **not** authorize merge or rollout.
