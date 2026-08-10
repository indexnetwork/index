# IND-638A PR-A validation receipt

## Receipt scope

This receipt records the provider-free validation and independent review of the implementation revision below. It was authored only after that revision had been validated and reviewed. It does not claim that the later commit which adds this receipt validates itself.

```text
baseRevision=2d11b19ae0ed4ffad2ff7418b6ef479866417c59
validatedImplementationHead=cee496de7f79ac0ab696cf581f6c4da585f88bd8
validationCompletedAtUtc=2026-08-10T10:10:23Z
```

The base and implementation revisions existed as commit objects, their merge base was exactly `2d11b19ae0ed4ffad2ff7418b6ef479866417c59`, and the worktree and index were clean when the implementation revision was captured. The validation receipt path did not yet exist. `HEAD` remained exactly `cee496de7f79ac0ab696cf581f6c4da585f88bd8` throughout the pre-receipt validation and exact-revision review.

## Immutable pooled-content approval

The independently approved content is bound by the following actual values:

```text
contentRevision=0dfb578845697aa8f2773695a4a02ab2a5d3be2d
contentAuthor=yanki@index.network
approvalReceiptPath=docs/research/2026-08-07-ind-638a-shared-pool-approval.json
approvalReceiptCommit=dbbae0c7887cd981e21162aa42a6da9b587076d3
approvalReceiptParent=0dfb578845697aa8f2773695a4a02ab2a5d3be2d
approvalReceiptBlob=5b23632422eafc4829c5cd4a50bfb31898627414
approvalReviewerId=ind638.pool-auditor@index.network
approvalReviewedAt=2026-08-09T19:02:56Z
approvalDecision=approved
approvalIndependenceAttested=true
approvalRecognizability=medium
corpusVersion=historical-shared-pool-v1
planFingerprint=288336f6511a366d8d49303bc3e76eb475a981966e1ffb0eb2a8539d53fc4ce6
seedProjectionFingerprint=8d27a7634c7def4857f5acd5b399ee82389d8c9baab23fe0b8b4df187a337c38
retrievalDocumentFingerprint=87142f9c46d5fa51f6327c169f6c25d0d90fe35def5ed8778cd27e3da98d7b35
```

Immutable proof passed: both the content and approval revisions exist and are ancestors of the validated implementation; the approval commit has exactly the content revision as its parent and adds only the canonical approval JSON; its author is `IND-638 Pool Auditor <ind638.pool-auditor@index.network>`, distinct from content author `Yanek Yuk <yanki@index.network>`; and the JSON's reviewer ID matches the commit author. The approval JSON at the validated implementation head resolves to blob `5b23632422eafc4829c5cd4a50bfb31898627414`, byte-identical to the reviewer-authored approval-commit blob. `git diff --exit-code` over that path from the approval commit to the validated implementation head produced no output.

Direct provider-free recomputation matched the receipt for all three fingerprints shown above, and the three values are pairwise distinct. The immutable approval rationale records residual medium recognizability: domain-specific attribute combinations can still suggest well-known historical pairs despite anonymized identifiers and exclusion of names, dates, institutions, products, outcomes, and audit data from shared model-safe content. This receipt does not claim that recognizability was eliminated.

## Credential and operational posture

Before validation, all of these variables were unset: `DATABASE_URL`, `NEON_API_KEY`, `REDIS_URL`, `REDIS_HOST`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY`. Ignored `.env.development` and `.env.test` symlinks were moved outside the worktree for each Bun command group, every credential variable was explicitly removed from those command environments, and both symlinks were restored to their original targets afterward.

No provider call, database command, Redis command, Neon command, protected-base operation, live evaluation, push, PR operation, or merge operation ran. PR A provides the credential- and infrastructure-free contract and refusal boundary only. PR B explicitly owns and must validate provider execution, database behavior, Redis isolation, Neon attestation/reset, protected-base handling, process isolation, and live-evaluation behavior. None of those deferred areas is represented as validated here.

## Exact provider-free validation evidence

Every applicable pre-receipt gate below passed at `validatedImplementationHead`.

| Command or gate | Exit | Actual result |
|---|---:|---|
| Initial `git status`, merge-base, commit-object, exact-HEAD, and staged-index checks | 0 | Clean worktree; staged count 0; exact base and implementation revisions shown above. |
| `git fetch origin dev` plus post-fetch capture checks | 0 | Fetch succeeded; `origin/dev` and the merge base remained `2d11b19ae0ed4ffad2ff7418b6ef479866417c59`. |
| `bun install --frozen-lockfile` | 0 | Bun 1.3.14; 1 package installed in 293.00 ms. |
| `bun run check:subtree-parity` | 0 | 9 dependency ranges across 4 mirrored packages were exact-pinned and matched. |
| Protocol focused historical-quality tests, including `historical-quality.experiment.spec.ts` | 0 | 81 pass, 0 fail, 2,058 expectations, all 4 files. |
| Protocol focused shared-artifact and Eval Ops tests | 0 | 285 pass, 0 fail, 933 expectations, all 4 files. |
| `cd packages/protocol && bun run eval:verify` | 0 | Inventory contained 13 suites; all 13 typechecked and tested provider-free. |
| Protocol `bun run build` | 0 | `rm -rf dist && tsc`; no diagnostics. |
| `bun run architecture:exports` | 0 | 412 exports: 404 stable and 8 experimental. |
| `bun run architecture:consumer` | 0 | Consumer TypeScript compilation passed with no diagnostics. |
| `bun run architecture:host-isolation` | 0 | Zero API, web, schema, queue, or concrete-adapter imports. |
| `bun run architecture:capabilities` | 0 | 43 named capability directions passed. |
| `bun run architecture:cycles` | 0 | 0 cyclic strongly connected components across 359 runtime modules. |
| `bun run architecture:artifacts` | 0 | Rebuild passed; inventory contained 783 files with no source-test or source-map artifacts. |
| API exact 4-file CLI test command | 0 | 157 pass, 0 fail, 340 expectations, all 4 files. |
| API corrected explicit `./` 3-file queue test command | 0 | 43 pass, 0 fail, 88 expectations, all 3 files discovered. |
| API `bun run typecheck:cli-specs` | 0 | `tsc -p tsconfig.spec.json`; no diagnostics, including queue compile-time contract coverage. |
| API `bun run build` | 0 | Protocol build and API `tsc` passed with no diagnostics. |
| API `bun run lint` | 0 | 46 warnings and 0 errors. |
| Eval Ops exact 7-file test command | 0 | 7 files passed; 101 tests passed and 0 failed in 3.81 s. |
| Eval Ops `bun run typecheck` | 0 | No diagnostics. |
| Eval Ops `bun run build` | 0 | 77 modules; JS 427.73 kB (128.52 kB gzip), CSS 16.34 kB; built in 986 ms. |
| Eval Ops `bun run lint` | 0 | 7 warnings and 0 errors. |
| Root `bun run skills:validate` | 0 | 16 Agent Skills and 16 Codex skills validated. |
| Approval ancestry, exact-parent, single-path, author, and blob checks | 0 | Immutable approval proof passed as recorded above. |
| Direct approval fingerprint recomputation | 0 | All 3 receipt values matched recomputation and were pairwise distinct. |
| Version and root-lock verification | 0 | Protocol 10.1.0, API 0.78.0, and Eval Ops 0.6.0 each matched the root lock. |
| `git diff --check "$baseRevision...$validatedImplementationHead"` | 0 | No output. |
| `git diff --stat "$baseRevision...$validatedImplementationHead"` | 0 | 53 files changed, 5,502 insertions, 192 deletions. |
| `git diff --name-status "$baseRevision...$validatedImplementationHead"` | 0 | Exactly 53 changed paths. |
| Complete `git diff "$baseRevision...$validatedImplementationHead"` generation and audit | 0 | 6,826 lines, 324,193 bytes, SHA-256 `cd62fd1ec2c233624e528551cf6d71008807214280d58d35d26be9d4b03f7e7a`. |
| Final machine-checked PR-A changed-path allowlist | 0 | All 53 paths authorized; 0 unlisted paths. |
| Explicit-if unfinished-marker scan | 0 | 0 added `TBD`, `FIXME`, `TODO`, or `<placeholder>` matches. |
| Reviewer, quality-label, and runtime diff audit | 0 | No fabricated production reviewer fact, forbidden production quality result label, or PR-B runtime/infrastructure implementation. |
| Final exact-head, staged-index, porcelain, receipt-absence, and environment-symlink checks | 0 | Exact implementation head retained; staged count 0; porcelain count 0; receipt absent; both ignored environment symlinks restored. |

The complete diff audit covered the final authorized 53-path PR-A delta. Added quality-label candidates either preserve the legacy non-quality scorecard branch, assert forbidden quality presentation is absent, or emit the contract's `no quality verdict` state. The apparent added `DATABASE_URL` assignment is dependency-injected refactoring of the pre-existing attested legacy A/B child path, not historical-quality runtime.

Versions validated were:

```text
runtimeBunVersion=1.3.14
rootPackageManager=bun@1.3.6
protocolVersion=10.1.0
lock packages/protocol=10.1.0 match=true
apiVersion=0.78.0
lock services/api=0.78.0 match=true
evalOpsVersion=0.6.0
lock apps/eval-ops=0.6.0 match=true
```

Warning-only residuals remain explicit: API lint reported 46 warnings and zero errors; Eval Ops lint reported 7 warnings and zero errors; Eval Ops tests emitted the Vite CommonJS Node API deprecation warning; and repository `packageManager` metadata declares Bun 1.3.6 while validation and affected current CI workflows use Bun 1.3.14. All workspace versions matched the root lock.

## Prior blocking findings resolved in the validated implementation

The validated implementation includes these actual resolution commits from earlier reviews:

- `439645d0e125f82412692143c809e08b503af115` (`fix(eval): stabilize retrieval document IDs`) fixed stable retrieval-document identity and insertion/removal invariance.
- `4905bd98951be3090d98c5bd671e6ddf42ddebc9` (`fix(eval): instrument quality bootstrap refusal`) added the instrumented zero-call refusal boundary.
- `70e308c96ba5776cbf34505503e363f58cbff87a` (`fix(eval): harden historical quality validation`) fixed unsafe coercible IDs/error classes and population-unbounded target-rank validation.
- `5d8c7e2a5814dcd0f56faa85f20e1f03f47dd78b` (`fix(eval): reject failed quality final ranks`) made failed transport rows require null final ranks and execution-stage failures.
- `f8778d6b7e71c0eff7a9c34ac7c5a5878f02f725` (`fix(eval-ops): harden quality result rendering`) fixed stale/leaky Run presentation and indexed requested/completed counts.
- `bf22cb4a47860731d39c6461bd309f298a57ced4` (`fix(eval-ops): classify results by artifact`) fixed transitional harness classification and the non-strict artifact-reference union.
- `44be02e4e17bb1e138e716b698e664eb9ce62337` (`fix(discovery): harden historical quality admission`) hardened raw CLI config, approved case, and resolved-config admission.
- `4f6203c111487d95f6015733a854cea701f2bcf2` (`fix(api): preserve enrichment queue network parity`), `754342531a802d4f124b6a9f343b6f43def7c13d` (`fix(api): restore legacy enrichment invoke order`), and `98ced0dcd8f1dead9e7b9fe79d8db26f3a354410` (`fix(api): correct legacy enrichment property order`) preserve the enrichment queue's own required `networkId: string | undefined` contract and authoritative legacy order `userId`, `operationMode`, `networkId`, `options` without weakening the strict quality builder.
- `d200003db2eb549b25e1ca4a064dfa3bb8d15c4c` (`fix(eval): bind quality artifact completeness`) bound completeness and quality-verdict availability to the same full requested-evidence predicate.
- `2b3125249a5c193b1d88b70ce8a0d556cd924918` (`fix(eval): aggregate historical quality repetitions`) preserved logical case, trigger, repetitions, additive funnels, and null-preserving target ranks.
- `1b49aab30a4de4bddac2c777634a8855b16e2611` (`fix(eval): restrict historical discovery config`) restricted resolved configuration to generated `DISCOVERY_ENV_KEYS`.
- `cee496de7f79ac0ab696cf581f6c4da585f88bd8` (`fix(eval): validate generic repetition coverage`) requires exact repetition coverage `0..R-1` and `groupCount * R = requestedSlots` for complete generic quality evidence.

This disposition does not claim resolution of the two Minor findings retained by the final independent review below.

## Independent final exact-revision review

The persisted final review transcribed these fields exactly:

```text
reviewerIdentity=Pi reviewer subagent (AI_AGENT=pi; PI_INTERCOM_STABLE_ID=subagent-reviewer-19c33d66-1; PI_SESSION_ID=019feb2e-433d-7b24-90de-9e065c288c81; PI_SUBAGENT_RUN_ID=19c33d66; provider=openai-codex; model=gpt-5.6-sol; reasoning=high)
reviewedRevision=cee496de7f79ac0ab696cf581f6c4da585f88bd8
reviewedAtUtc=UTC completion clock was not exposed in captured child-session evidence; review occurred after the exact-head validation recorded at 2026-08-10T10:10:23Z. No completion time was invented.
verdict=READY
```

The reviewed revision exactly equals `validatedImplementationHead`. The review output's actual persisted filesystem modification time was `2026-08-10T10:23:48.967973808Z`; the parent review-receipt capture occurred at `2026-08-10T10:24:08Z`. These are persistence/capture timestamps, not an invented child completion clock.

The verdict was `READY`: no Critical or Important finding and therefore no blocker. Two unresolved, non-blocking Minor findings remain:

1. **Minor — duplicate candidate-role authority.** `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts:87` re-declares the `target` / `semantic-negative` / `background` union instead of importing the shared-pool public role authority. The literals currently agree and tests cover behavior, so this is maintainability/drift risk rather than a current wire or runtime mismatch.
2. **Minor — standalone funnel population bound.** `packages/protocol/eval/shared/artifact.ts:323` bounds target rank count/sum in exported standalone `HistoricalStageFunnelSchema` against the fixed 24-person total rather than the reached-stage population. `HistoricalQualityTransportRowSchema` separately requires exact equality with participant-derived funnels, so malformed transport artifacts remain rejected; the weakness is limited to direct standalone-schema consumers.

Neither Minor is represented as fixed or otherwise resolved by this receipt.

## Handoff boundary and residual risk

This provider-free PR-A checkpoint is validation evidence, not merge authorization. The implementation establishes the shared-pool authority, planner, production-shaped trigger projection, quality metrics/artifacts, fail-closed CLI contract, and Eval Ops rendering/exclusion behavior. It does not implement or validate the PR-B runtime.

Residual risks are: the two Minor findings above; medium pooled recognizability; warning-only lint and toolchain notices; and all explicitly deferred PR-B provider, database, Redis, Neon, protected-base, process-isolation, and live-evaluation behavior. PR B must retain whole-group planner/runtime admission and the fixed safe diagnostic projection. The approved shared wire intentionally keeps `logicalCaseId` as a nonempty string rather than duplicating the five-case corpus enum.

## Post-PR CI repair addendum

This addendum records the credential-free validation and independent review of a CI-only repair made after the original receipt. It preserves the original receipt evidence and does not claim that the later commit which adds this addendum validates itself.

```text
priorReceiptCommit=d3f9007975839fa020cb1102806258af2819cf5d
priorValidatedCodeHead=cee496de7f79ac0ab696cf581f6c4da585f88bd8
ciRepairValidatedHead=915b8551ec18585a56472a805e0cc1a1f65261f8
validationCompletedAtUtc=2026-08-10T10:55:10Z
```

The repair addressed two CI root causes. First, the eval-verification job's shallow checkout lacked the immutable approval receipt's parent commit object, so the unchanged provenance test could not resolve it; only that job now requests full checkout history. Second, architecture tests still scanned the wrapper source after executable capability authority had moved, producing false negatives; the tests now assert the executable authority directly. The repair changes no production behavior or production content, including the approved shared content.

The exact post-receipt delta from `d3f9007975839fa020cb1102806258af2819cf5d` through the validated repair head contains only these three paths:

```text
.github/workflows/lint.yml
packages/protocol/src/architecture/tests/capability-facades.spec.ts
packages/protocol/src/architecture/tests/runtime-shells.spec.ts
```

That delta is 3 files with 44 insertions and 28 deletions; its complete diff is 131 lines and 6,205 bytes with SHA-256 `ccd7c4d1c77cfac011ac4e6dbcc26512d7411dacf575e7a0c80b3ece52e965a2`. The complete base-to-repair delta is 57 files with 5,695 insertions and 220 deletions; its complete diff is 7,112 lines and 345,953 bytes with SHA-256 `3bd47346265cca607dd33af5a1832f10ac14ae4e42c51bf4083e162087d27a2f`.

The prior receipt commit has exact parent `cee496de7f79ac0ab696cf581f6c4da585f88bd8`, remains an ancestor of the validated repair head, and adds only this receipt path. The receipt blob is `7a6ce42b3c9d2179507995003f1233197c511fcd` at both the prior receipt commit and the validated repair head, proving that the previous receipt text was unchanged while the repair itself was validated.

Exact credential-free repair validation passed:

- Protocol architecture tests: 28 pass, 0 fail, 100 expectations across 5 files.
- Full isolated protocol tests with `TEST_CONCURRENCY=4`: 2,172 pass, 0 fail, 0 errors across 211 provider-free files; the runner excluded 5 explicit live-model specs.
- Eval verification: all 13 of 13 suites typechecked and tested provider-free.
- Protocol build: passed with no diagnostics.
- Static checks: 412 exports (404 stable and 8 experimental), consumer compilation, host isolation, 43 capability directions, 0 cyclic strongly connected components across 359 runtime modules, and the 783-file package-artifact inventory all passed.
- Frozen install and subtree parity passed; 9 dependency ranges across 4 mirrored packages were exact-pinned and matching.
- YAML baseline-to-repair machine checks passed: both workflow revisions parsed, exactly 8 checkout steps exist, eval verification is the sole changed checkout and has only numeric `fetch-depth: 0`, and the other 7 checkout steps retain byte-structure-equivalent defaults.
- Both applicable diff checks passed, and the post-receipt added-line unfinished-marker scan found no prohibited markers.

All validation ran with `DATABASE_URL`, `NEON_API_KEY`, `REDIS_URL`, `REDIS_HOST`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GOOGLE_API_KEY` unset; ignored environment symlinks were moved outside the worktree during Bun commands and restored afterward. The first local eval-verification attempt used a `bash -lc` login shell whose `PATH` omitted `bunx`, so it exited before suite validation. The exact repository command was immediately rerun with the normal credential-scrubbed `PATH` and passed all 13 suites. This was a validation-harness mistake, not a product or CI failure.

The independent CI-repair review recorded these exact fields:

```text
reviewerIdentity=Pi reviewer subagent (AI_AGENT=pi; PI_INTERCOM_STABLE_ID=subagent-reviewer-d737b5f8-1; PI_SESSION_ID=019feb59-071b-745b-a5a3-7d9a6e6ff49b; PI_SUBAGENT_RUN_ID=d737b5f8)
reviewedRevision=915b8551ec18585a56472a805e0cc1a1f65261f8
reviewedAtUtc=2026-08-10T11:06:42Z
verdict=READY
```

The review found no Critical or Important issue. It retained two non-blocking Minor findings without representing either as fixed: duplicate candidate-role authority at `packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.ts:93`, which remains a maintainability/drift risk, and the standalone funnel schema's fixed-population rank-sum bound at `packages/protocol/eval/shared/artifact.ts:323`, while full transport-row validation still rejects malformed artifacts. Medium pooled recognizability also remains unchanged. A warning-only GitHub runner fallback from the checkout action's Node.js 20 target to Node.js 24 is unrelated to this repair.

A fresh hosted CI run at the exact validated repair head was not observed and remains pending; this addendum does not claim hosted CI success. No provider, database, Redis, Neon, protected-base, live-evaluation, process-isolation, or PR-B runtime behavior was exercised or validated. No push, merge, or other live behavior was performed.
