# Task 6 implementation report — protected all-or-nothing macOS release workflow

## Result

Implemented Task 6 provider-free without dispatching the workflow or invoking any signing, notarization, upload, attestation, release, or publication operation. The protected workflow is tag/manual only, uses `macos-production`, pins every action to a full SHA, checks out once without persisted credentials, serializes without cancellation, and performs publication only after the complete Tasks 1–5 chain and GitHub build provenance.

## Changed files

- `.github/workflows/mac-production-release.yml` (new)
- `.github/workflows/mac-app-build.yml`
- `apps/mac/release/build-release.sh` (new)
- `apps/mac/release/tests/release-workflow.spec.mjs` (new)

## Implementation

- Added a single protected `macos-14` job with `push.tags` / `workflow_dispatch` entrypoints and the `macos-production` environment. It has no PR path.
- Protected permissions are the least set GitHub's provenance implementation requires: `contents: write`, `id-token: write`, and `attestations: write`; all unspecified scopes are `none`. `attestations: write` is mandatory for `actions/attest-build-provenance`, and was explicitly approved after resolving the original exact-two-permissions conflict. PR CI remains `contents: read` only.
- Added reviewed environment variable pins for exact macOS version/build, runner image/version, CMS Keychain identity hash, and certificate SHA-256. Production endpoints, Team ID, and connector protocol are literal authorities. Secret inputs cover the Developer ID PKCS#12/password, exact app/connector profiles, and App Store Connect API-key notary credentials.
- Added fail-closed orchestration for exact clean tagged commit, exact workflow commit, canonical version/build inputs, strict monotonic comparison against every existing release carrying signed macOS metadata, hosted-runner identity, no background jobs, no unrelated same-UID workloads, mode-0700 transactions, and preexisting-output refusal.
- Orchestration order is: credential-free Universal 2 build → clean checkout recheck → temporary Keychain/profile import → sign/verify → Task 4 private inner notarization/stapling and deterministic dual-DMG pipeline → post-promotion `finalArtifact.sha256` verification → deterministic metadata/checksums → CMS sign/verify → immutable publication-manifest hashing → GitHub build-provenance attestation → manifest/attestation binding → final metadata and `finalArtifact` rechecks → release absence recheck → one `gh release create` with all assets.
- The Task 4 source contract is checked for its private pre/post-promotion `finalArtifact` gates before execution; Task 6 verifies promoted evidence again after packaging, after metadata generation, and immediately before publication.
- The EXIT trap deletes transaction roots, temporary Keychain, provisioning profiles, notary key, and secret files. Tracing is disabled. Failure attempts deletion only when a release contains this run's marker, and an `if: failure()` workflow step independently proves exact release absence.
- `gh release create` is the sole irreversible final command. GitHub does not provide transactionally atomic release creation plus all asset uploads. The implementation preflights exact absence, supplies every asset in one command, marks the created release with this run identity, deletes only that exact owned release on command failure, and then proves absence. This is the unavoidable residual API atomicity limitation.
- PR CI is explicitly read-only, pins all actions, disables persisted checkout credentials, runs the Task 6 provider-free contract, and gates the existing secret-backed cross-identity fixture to manual dispatch only. Universal output is explicitly labeled development-only.

## Strict TDD evidence

### RED

Created `release-workflow.spec.mjs` before either implementation file.

```bash
bun test apps/mac/release/tests/release-workflow.spec.mjs
```

Captured at `/tmp/task-6-red.log`: exit 1, `0 pass`, `10 fail`. Every failure was the missing production workflow/orchestrator contract.

### GREEN

```bash
bun test apps/mac/release/tests/release-workflow.spec.mjs
```

Result: `10 pass`, `0 fail`, `105 expect() calls`.

## Regression and static validation

```bash
bun test apps/mac/release/tests \
  apps/mac/IndexApp/notarize.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Result: `151 pass`, `1 skip`, `0 fail`, `880 expect() calls` across 19 files. The skip is the preexisting Linux-gated real-codesign fixture.

```bash
bash -n apps/mac/IndexApp/build.sh apps/mac/IndexConnector/build.sh apps/mac/release/*.sh
python3 -m py_compile apps/mac/release/snapshot-file.py
git diff --check
```

All passed. The generated `__pycache__` from syntax checking was removed. `actionlint` is not installed, so the workflow is covered by the Bun structural/security contract rather than an actionlint execution.

## Residual risks

- The workflow was deliberately never executed. Real macOS hosted image literals, Apple Keychain/Developer ID behavior, notary submission, deterministic `hdiutil` equality, CMS trust, GitHub OIDC attestation, and final release API behavior remain protected-candidate evidence.
- Release ops must supply all reviewed protected variables/secrets as exact literals. Missing or mutable defaults fail closed.
- `gh release create` and asset upload are not transactionally atomic in GitHub's API. The one-command, owned-marker deletion, and absence proof minimize but cannot eliminate a brief partially visible release if the API fails mid-command.
- Same-UID isolation proves no background shell job and rejects unrelated same-UID processes other than GitHub Runner Listener/Worker infrastructure. This is coupled to a fresh dedicated GitHub-hosted VM and no service/container/second-job workload.

## Attestation

No workflow dispatch, Apple service call, signing, notarization, stapling, mount, upload, attestation, release creation/deletion, publication, deployment, push, or protected operation occurred. No protected secret or credential was read or written during implementation.

## Review fix round 1/5

Addressed all 3 Critical and 5 Important findings in one provider-free strict-TDD security wave.

### Changes

- Removed every secret expression from job scope. Apple credentials exist only on the first-party `prepare` step; `GH_TOKEN: ${{ github.token }}` exists only on first-party steps that actually call GitHub. Checkout, Bun setup, attestation, and attestation binding receive neither.
- The real Universal build now runs through `env -u` for every GitHub/Apple credential variable. Actual `sw_vers`, `ImageOS`, and `ImageVersion` equality is checked before the build, again before secret materialization, and no credential file/Keychain exists until those gates pass. Secret files are orchestrator-owned mode 0600 under the trapped mode-0700 transaction.
- Partial-release cleanup no longer deletes by tag. The final command captures and validates the numeric release database ID immediately, including after a failed `gh release create`; cleanup GETs that numeric ID, verifies ID/tag/target commit/exact run marker, then DELETEs that exact numeric endpoint. A tag replacement cannot be deleted.
- Release tags must be annotated objects. Local tag object/peeled commit and remote exact object/peeled refs are checked after checkout and immediately before publication. A reviewed positive ruleset ID is fetched and must be active, tag-targeted, match the exact tag/all tags, and contain update plus deletion protection.
- Monotonic inventory now treats every semver/macOS-related prior release as mandatory evidence, requires exact `macos-release.json` + `.cms`, downloads both privately, verifies the real opaque CMS signature and pinned signer certificate, enforces canonical closed historical metadata/immutable URLs, then compares strict semver/build. The complete inventory is rerun immediately before publication.
- Same-UID proof now compares exact executable paths, exact ancestry, and a narrow reviewed runner/OS-agent set; substring names such as `FakeRunner.Worker` fail. It rejects background jobs and is rerun before signing-to-Task4 transition, before each inner notarize/package/DMG transform, and before publication.
- Workflow tests now parse YAML with the repository `yaml` package and verify trigger/permission/action/step-env structure. Executable provider-free fixtures prove secret-stripped build children, host-before-secret phase logs, tag/ruleset refusal, numeric-ID replacement-race safety, unsigned historical metadata refusal, and early/late same-UID process detection.

### Strict TDD evidence

```bash
bun test apps/mac/release/tests/release-workflow-fix-round-1.spec.mjs
```

RED captured at `/tmp/task-6-fix-round-1-red.log`: `4 pass`, `7 fail`; failures directly covered job-wide secrets, missing GH auth scoping, build-secret inheritance, missing host phase interface, missing prior CMS verifier, and missing Task4 isolation guard.

Focused GREEN:

```bash
bun test apps/mac/release/tests/release-workflow-fix-round-1.spec.mjs \
  apps/mac/release/tests/release-workflow.spec.mjs
```

Result: `21 pass`, `0 fail`, `172 expect() calls`.

Full Task 1–6 regression:

```bash
bun test apps/mac/release/tests \
  apps/mac/IndexApp/notarize.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Result: `162 pass`, `1 existing platform skip`, `0 fail`, `947 expect() calls` across 20 files.

Shell syntax for all release scripts plus `IndexApp/notarize.sh`, YAML parse for both affected workflows, `git diff --check`, and focused identity/secret logging plus obsolete tag-delete scans passed.

### Residual protected-context risk

Real GitHub ruleset response shape/evaluation, annotated remote tag observations, historical production CMS inventory, hosted-runner exact process inventory, Apple Security/notary behavior, artifact attestation, and numeric-ID partial-release cleanup require a separately authorized protected candidate run. No such operation occurred here.

### Attestation

No workflow dispatch, secret read, GitHub API call, Apple service, real signing/notarization, upload, attestation, release mutation, publication, deployment, push, or protected operation occurred during this fix wave.

## Review fix round 2/5

Addressed both Critical and all four Important findings with a structural phase split and strict TDD.

### Changes

- Split the single protected process into `prepare` (no GH/Apple authority), `authorize` (GH only), `candidate` (Apple only), attestation (third-party action with no env credentials), and `publish` (GH only). Prepare refuses if any GH token or Apple secret exists in its parent environment, validates the exact host/local annotated checkout, runs the Universal build credential-free, and emits a mode-0700 state directory with a SHA-256 handoff manifest. Candidate revalidates host/local checkout/process isolation and both sealed handoffs before materializing any Apple credential.
- Replaced public `gh release create` with a private draft REST transaction. The POST response is the sole authority for numeric `id` and `upload_url`; every asset is uploaded to that returned URL, then the exact numeric release is GET-verified for draft posture and unique name/SHA-256 digest. The sole public irreversible operation is the final numeric-ID PATCH with `draft:false`. Pre-publication failure revalidates and deletes only the exact numeric draft; after public PATCH cleanup never deletes.
- Ruleset validation now requires the exact reviewed ID, active/tag enforcement, exact/all-tag inclusion, no matching exclusion, zero bypass actors, and both update/deletion rules. It is rerun through remote provenance immediately before draft creation and again before public PATCH.
- Added a standalone process scanner over one snapshot. It requires exact Listener → Worker → current-shell ancestry, permits the guard and descendants, checks an exact reviewed OS-agent allowlist whose bytes are independently SHA-256 pinned, and rejects detached exact-path worker lookalikes and late processes. Task 4 continues invoking the same guard before each race-sensitive phase.
- Historical version parsing now requires canonical `0|[1-9][0-9]*` components. Inventory covers every non-draft/non-prerelease release regardless of name; no macOS pair is ignored, while either-side presence requires exactly one JSON and CMS with cryptographic/canonical verification. Duplicate and one-sided assets fail closed. The complete inventory is rerun before draft and publication.
- Removed Task 6 production test bypasses. Round-2 tests use parsed YAML, a real temporary annotated Git repository with bare origin, exact `gh` ruleset stubs, the production process scanner/snapshot, and the real prior CMS verifier contract.

### Strict TDD evidence

```bash
bun test apps/mac/release/tests/release-workflow-fix-round-2.spec.mjs
```

RED captured at `/tmp/task-6-fix-round-2-red.log`: `2 pass`, `5 fail`, demonstrating the unsplit authority, tag-based public publication path, absent scanner, and noncanonical/incomplete historical discovery.

Focused GREEN across Task 6 workflow suites: `28 pass`, `0 fail`, `251 expect() calls`.

Full Task 1–6 regression: `169 pass`, `1 existing platform skip`, `0 fail`, `1026 expect() calls` across 21 files. All release shell syntax, process-scanner Python syntax, both workflow YAML parses, `git diff --check`, and privacy/obsolete-publication scans passed.

### Residual protected-context risk

The private draft itself is an external non-public GitHub state by design. Real GitHub draft POST/upload digest/GET/PATCH semantics, exact ruleset payloads, hosted macOS process allowlist hash, Apple Security/notary/CMS behavior, and attestation remain protected-candidate evidence. Failure after the public PATCH reports but never deletes the public release.

### Attestation

No workflow dispatch, secret read, GitHub API call, Apple service, signing/notarization, draft creation, upload, attestation, release mutation, publication, deployment, push, or protected operation occurred in round 2.

## Review fix round 3/5

Addressed both Critical and all four Important findings with strict TDD.

### Changes

- Added immutable workflow-literal SHA-256 pins for every privileged first-party release executable. Authorize, candidate, and publish run absolute `/usr/bin/shasum`, `/usr/bin/git diff-index`, and `/usr/bin/git status` gates immediately before invoking the pinned orchestrator. Cross-step handoffs now use a canonical complete inventory of every relative path, type, mode, size, and file hash; additions, removals, links/devices, content, and mode changes fail closed. Candidate/publish reverify every prior seal before authority use.
- Draft publication now writes canonical `{"draft":false}` bytes and supplies them via `--input`. PATCH response and an immediate numeric-ID GET must both prove exact ID/tag/commit/marker, public/non-prerelease posture, nonempty `published_at`, and exact asset name/digest inventory. POST response loss uses the exact run/run-attempt/commit marker to recover exactly one matching private draft; zero or multiple matches remain ambiguous and are never deleted. Cleanup GET/DELETE remains exact numeric ID and draft-only.
- Added audited GitHub tag ruleset glob matching for exact, `*`, and `?` patterns. Includes must match the exact full tag ref, exclusions must not, malformed/unsupported patterns fail closed, and active/no-bypass/update/delete gates remain required.
- Runner proof now consumes reviewed Listener/Worker canonical paths and SHA-256 pins. On macOS it uses `proc_pidpath` through ctypes, hashes executable bytes, proves exact Listener → Worker → current-shell ancestry, permits guard descendants only, and rejects detached lookalikes. Injected snapshots use the same algorithm.
- Historical inventory now treats either DMG, JSON, CMS, or checksum presence as macOS evidence and requires exactly one complete five-asset set. Both DMGs and `SHA256SUMS` are downloaded; the real CMS/canonical metadata verifier binds actual artifact bytes, sizes, digests, names, and immutable URLs before monotonic comparison.
- Restored noninteractive temporary Keychain timeout and `apple-tool:,apple:` partition-list setup.

### Strict TDD evidence

Round-3 RED: `1 pass`, `9 fail`, covering absent immutable pins/inventory helper, incomplete PATCH/recovery verification, absent audited ruleset matcher, unpinned runner executables, incomplete historical evidence, and missing Keychain commands.

Focused GREEN across four workflow suites: `38 pass`, `0 fail`, `309 expect() calls`.

Full Task 1–6 regression: `179 pass`, `1 existing platform skip`, `0 fail`, `1084 expect() calls` across 22 files. Shell syntax, Python syntax, YAML parsing, `git diff --check`, pin consistency, and privacy/obsolete-publication scans passed.

### Residual protected-context risk

Real macOS `proc_pidpath` behavior and release-ops runner executable pins, GitHub digest fields/draft recovery/PATCH responses, historical production assets, Apple signing/notary/CMS, and attestation remain protected-candidate evidence.

### Attestation

No workflow dispatch, secret read, GitHub API call, Apple service, signing/notarization, draft creation, upload, attestation, release mutation, publication, deployment, push, or protected operation occurred in round 3.

## Review fix round 4/5

Addressed both Critical and all four Important findings with strict provider-free TDD.

### Changes

- Moved authoritative handoffs into one run-specific mode-0700 `RUNNER_TEMP` work root. Checkout-local `apps/mac/dist` is now only transient compatibility output for Tasks 2–5; it is copied into exact external unsigned/candidate roots, deleted, and followed by separate tracked/untracked source-clean gates. Seal files live in a separate authority directory and bind canonical root path, device/inode, type, mode, size, and every file digest. Publication parses only the five exact approved regular candidate files and refuses incomplete/extra inventory.
- Replaced `ps` process discovery with direct `libproc` PID enumeration and `proc_pidinfo`/`proc_pidpath`. The scanner snapshots PID start identity, classifies the guard/scanner tree before path resolution, hashes opened executable bytes, rechecks PID identity, accepts only classified vanished descendants, and verifies literal Listener → Worker ancestry/path/hash pins. Provider-free production-core fixtures reject PID reuse, detached Worker, and hash mismatch.
- Added bounded Link-header pagination for lost-POST private-draft recovery and exact-one marker matching across every page. Fixtures prove page-2 recovery plus duplicate/API-failure refusal.
- Implemented path-aware GitHub ruleset globs: `*` cannot cross `/`, `**` can, `?` is one non-slash character, supported character classes work, and escapes/braces/extglob/malformed classes fail closed.
- Restored full historical authority verification: exact closed root/artifact keys and values, canonical semver/build/commit, release tag equality, repository/tag-bound immutable URLs, real opaque DER CMS signer pin, and exact DMG/checksum binding. Historical download paths no longer embed untrusted tag strings.
- Every privileged first-party workflow step now contains its own literal executable pins and clean tracked-source gate; there is no job-level script-pin environment. Attestation consumes only the exact external candidate files.

### Strict TDD evidence

Round-4 RED captured at `/tmp/task-6-fix-round-4-red.log`: `0 pass`, `7 fail`, directly covering external seal authority, libproc enumeration, path-aware rules, historical authority, and paginated recovery.

Focused GREEN across all five Task 6 workflow suites: `45 pass`, `0 fail`, `352 expect() calls`.

Full Task 1–6 regression: `186 pass`, `1 existing platform skip`, `0 fail`, `1127 expect() calls` across 23 files. Shell/Python syntax, both workflow YAML parses, literal pin consistency, `git diff --check`, and privacy/obsolete-publication scans passed.

### Residual protected-context risk

Real hosted macOS `libproc` layout/path behavior and reviewed Listener/Worker hashes, GitHub REST response headers/digests, Apple signing/notary/CMS trust, and attestation remain protected-candidate evidence. No external or protected operation was performed.

### Attestation

No workflow dispatch, secret read, GitHub API call, Apple service, signing/notarization, draft creation, upload, attestation, release mutation, publication, deployment, push, or protected operation occurred in round 4.

## Review fix round 5/5

Addressed the final Critical finding and all three Important findings with strict provider-free TDD. Task 6 remains reviewer-owned and is not marked complete.

### Changes

- Live process scanning now revalidates the complete classification-bearing identity tuple `(ppid, uid, start identity)` after path/hash work. Production-core snapshot fixtures model the initial and rechecked tuple independently and reject Worker reparenting or UID changes even when start identity is unchanged.
- Tag ruleset validation compiles every include and exclusion before performing any match. A prior matching `~ALL` or valid glob can no longer hide a later unsupported brace or malformed character-class pattern.
- Historical discovery now includes each release object's `target_commitish`, refuses macOS evidence unless it is canonical exact lowercase 40-hex authority, passes it into the real CMS/metadata verifier, and requires signed metadata `commit` equality while preserving exact tag/repository/bytes/CMS/checksum gates.
- Extracted narrow production functions for checkout cleanup → external unsigned handoff sealing and approved candidate uploading. Provider-free fixtures source and invoke these real functions with route-aware stubs, proving cleanup precedes clean-source verification/sealing and uploads are exactly the five sealed regular files. Missing, extra, non-file, and unclean cases fail closed; no production bypass was added.
- Updated immutable workflow SHA-256 pins for every changed privileged executable.

### Strict TDD evidence

RED (tests were added before production changes):

```bash
bun test apps/mac/release/tests/release-workflow-fix-round-5.spec.mjs
```

Captured at `/tmp/task-6-fix-round-5-red.log`: exit `1`, `0 pass`, `5 fail`, `8 expect() calls`. Failures showed the old 7-column scanner fixture contract, short-circuited malformed ruleset acceptance, absent target-commit verifier argument, and absent executable handoff/upload production functions.

Focused GREEN:

```bash
bun test apps/mac/release/tests/release-workflow.spec.mjs \
  apps/mac/release/tests/release-workflow-fix-round-1.spec.mjs \
  apps/mac/release/tests/release-workflow-fix-round-2.spec.mjs \
  apps/mac/release/tests/release-workflow-fix-round-3.spec.mjs \
  apps/mac/release/tests/release-workflow-fix-round-4.spec.mjs \
  apps/mac/release/tests/release-workflow-fix-round-5.spec.mjs
```

Result: `50 pass`, `0 fail`, `381 expect() calls` across 6 files.

Full provider-free Tasks 1–6 release regression:

```bash
bun test apps/mac/release/tests \
  apps/mac/IndexApp/notarize.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Result: `191 pass`, `1 existing platform skip`, `0 fail`, `1156 expect() calls` across 24 files. The skip is the preexisting non-macOS real-profile fixture.

Static validation:

```bash
bash -n apps/mac/IndexApp/build.sh apps/mac/IndexConnector/build.sh \
  apps/mac/IndexApp/notarize.sh apps/mac/release/*.sh
python3 -m py_compile apps/mac/release/*.py
bun -e 'import YAML from "yaml"; for (const p of [".github/workflows/mac-production-release.yml",".github/workflows/mac-app-build.yml"]) YAML.parse(await Bun.file(p).text())'
# literal SHA-256 pin consistency for all five privileged first-party files
# credential-literal privacy scan and obsolete publication/test-bypass scans
git diff --check
```

All passed: `YAML_OK=2`, `PIN_CONSISTENCY_OK=5`, `PRIVACY_SCAN_OK=2`, `STATIC_VALIDATION_OK`. Generated Python caches were removed.

### Changed files

- `.github/workflows/mac-production-release.yml`
- `apps/mac/release/build-release.sh`
- `apps/mac/release/process-isolation.py`
- `apps/mac/release/verify-tag-ruleset.mjs`
- `apps/mac/release/verify-prior-release-metadata.sh`
- `apps/mac/release/tests/release-workflow-fix-round-4.spec.mjs`
- `apps/mac/release/tests/release-workflow-fix-round-5.spec.mjs` (new)
- `.superpowers/sdd/2026-08-09-hermes-macos-production-release/task-6-report.md`

### Protected residual evidence

Real hosted-macOS `libproc` ABI/path behavior and reviewed Runner Listener/Worker hashes, GitHub REST `target_commitish` and upload/digest semantics, historical production release objects/assets, Apple signing/notary/CMS trust, and GitHub attestation remain protected-candidate evidence. Provider-free fixtures execute the real parsers and extracted orchestration functions but deliberately do not claim external provider behavior.

### Attestation

No workflow dispatch, GitHub API network call, secret access, Apple service, signing/notarization, upload, attestation, release/draft mutation, publication, deployment, merge, or push occurred in round 5. Only local provider-free fixtures with temporary files, a generated local fixture certificate, and route-aware command stubs ran.

Task 6: fix round 5/5 (4 addressed/0 open; commits 913f3cc4b..fe5d95c98)
