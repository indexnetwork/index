# Task 5 implementation report — deterministic metadata, checksums, CMS contracts, and provenance

## Result

Implemented the approved provider-free Task 5 scope. The generator emits exactly `macos-release.json` and `SHA256SUMS`; the protected signing contract later emits exactly `macos-release.cms`. Metadata is canonical one-line JSON with recursively sorted object keys, exact approved schema keys/values, exact sorted artifact order, immutable `v1.0.0` GitHub release URLs, byte sizes, and SHA-256 values calculated from the two promoted final DMGs. No signing identity, Apple provider, publication, notary, deploy, protected operation, credential, or real production artifact was used.

Task 4's separate credential-free `<dmg>.reproducibility.txt` files are required and strictly parsed before generation. Generation requires exact approved fields only, actual==expected macOS/build/runner evidence, canonical SHA-256 values, and `finalArtifact.sha256` equality with final DMG bytes. Provenance is not widened into the approved metadata schema.

## Changed files

- `apps/mac/release/release-metadata.schema.json`
- `apps/mac/release/generate-release-metadata.ts`
- `apps/mac/release/sign-release-metadata.sh`
- `apps/mac/release/verify-release-metadata.sh`
- `apps/mac/release/tests/release-metadata.spec.mjs`
- `.superpowers/sdd/2026-08-09-hermes-macos-production-release/task-5-report.md`
- `.superpowers/sdd/2026-08-09-hermes-macos-production-release/progress.md`

## Implementation details

- Exact release identity: schema 1, version `1.0.0`, positive canonical decimal build, full lowercase 40-hex commit, Team `LMQ3XNXLAD`, production API/web origins, `arm64` + `x86_64`, macOS `13.0`, connector protocol 1.
- Exact artifacts: `Index-macOS-1.0.0-universal.dmg` / `app-dmg` and `IndexConnector-1.0.0-universal.dmg` / `connector-dmg` only.
- Exact immutable URLs: `https://github.com/indexnetwork/index/releases/download/v1.0.0/<approved-name>`.
- Exact schema closure at root and artifact levels; the standalone exact validator re-derives all values from inputs/final bytes rather than depending on a TypeScript JSON Schema runtime package.
- Generation requires a separate empty mode-0700 output directory, refuses final/public/publishing output paths, creates mode-0600 outputs with exclusive temporary files plus atomic rename, and rolls back both generated outputs on failure.
- `SHA256SUMS` contains exactly two sorted basename-only entries and is verified from the final artifact directory, preventing local path leakage.
- Signing consumes only `INDEX_RELEASE_CMS_SIGNING_IDENTITY`, disables tracing, independently locates the installed certificate, and requires Developer ID Application plus Team `LMQ3XNXLAD` before `security cms -S`.
- Verification re-runs canonical metadata/final-byte checks, executes `security cms -V` and `security cms -D`, compares recovered canonical bytes byte-for-byte, extracts and verifies the actual CMS signer with `openssl cms -verify`, pins its SHA-256 certificate fingerprint to the independently located expected certificate, and verifies the exact checksums.

## Strict TDD evidence

### RED

The test file was created before all implementation files.

```bash
bun test apps/mac/release/tests/release-metadata.spec.mjs
```

Captured at `/tmp/task-5-red.log`. Exit 1: `1 pass`, `5 fail`. Failures proved generation was absent, schema/sign/verify files were absent, and no valid metadata could be produced.

### GREEN

```bash
bun test apps/mac/release/tests/release-metadata.spec.mjs
```

Result: `6 pass`, `0 fail`, `57 expect() calls`. Coverage includes canonicality, exact schema closure, immutable URLs, final hashes/sizes, sorted checksums, canonical input rejection, strict Task 4 evidence consumption, extra/mutable/wrong metadata rejection, CMS command contracts, byte recovery, and wrong-signer rejection.

## Regression, syntax, type, and privacy evidence

```bash
bun test apps/mac/release/tests apps/mac/IndexApp/notarize.spec.mjs apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Result: `124 pass`, `1 skip`, `0 fail`, `634 expect() calls` across 14 files. The existing skip is the platform-gated real-codesign fixture on Linux.

```bash
bash -n apps/mac/release/sign-release-metadata.sh apps/mac/release/verify-release-metadata.sh
bunx tsc --noEmit --skipLibCheck --allowImportingTsExtensions \
  --moduleResolution bundler --module preserve --target es2022 --types bun \
  apps/mac/release/generate-release-metadata.ts
bunx eslint --no-warn-ignored apps/mac/release/generate-release-metadata.ts
git diff --check
```

All passed without diagnostics. `shellcheck` is not installed. Focused scans passed for credential-like assignments and identity/environment logging (`privacy assignment scan: PASS`; `identity/environment logging scan: PASS`).

## Self-review

- Confirmed only the approved schema keys exist and both schema/object layers reject extras.
- Confirmed metadata and checksum verification re-derive digest and size from promoted final bytes, while independently enforcing Task 4 `finalArtifact.sha256` evidence.
- Confirmed mutable `latest` URLs, wrong names, URLs, sizes, hashes, builds, commits, evidence fields, provenance mismatches, and noncanonical JSON bytes fail closed.
- Confirmed no release metadata contains signing identity, key/token/credential/notary data, local path, OS/runner provenance, or any identifier beyond approved commit/Team/public URLs.
- Confirmed signer validation does not trust the caller string alone: both expected certificate semantics and actual CMS signer fingerprint are checked.
- Confirmed no production output, CMS, signing, publication, or provider action occurred.

## Residual protected-context risks

- Linux provider-free mocks establish command semantics, exact-byte recovery, and wrong-signer refusal, but real macOS `security cms -S/-V/-D`, Keychain certificate selection, OpenSSL parsing of Apple's CMS encoding, and trust-chain behavior require the later protected isolated macOS Task 6 run.
- Task 6 must retain Task 4 evidence beside both promoted DMGs, use a new private mode-0700 metadata output directory, supply reviewed `INDEX_RELEASE_CMS_IDENTITY_HASH` and `INDEX_RELEASE_CMS_CERT_SHA256` pins without tracing/logging them, and run verification before publication.
- No `macos-release.cms` was generated here because no signing identity was used, as required.

## Attestation

No Apple service, signing identity, certificate material, credential, notary data, real CMS signature, real DMG, publication, deployment, upload, protected environment, push, or protected operation was accessed or used.

## Review fix round 1/5 — supply-chain hardening

Addressed the Critical and all seven Important findings in one strict-TDD provider-free wave.

### Changes

- Platform `security cms -V` remains the CMS trust authority. OpenSSL now performs only explicit opaque binary parsing/content/signature extraction with `-binary -noverify -purpose any`, so a code-signing-only Developer ID certificate is not incorrectly subjected to S/MIME purpose trust.
- CMS structure inspection requires exactly one `SignerInfo` and exactly one embedded signer certificate before certificate pinning.
- Replaced label-only selection with protected `INDEX_RELEASE_CMS_IDENTITY_HASH` (canonical lowercase 40-hex Keychain identity hash) and `INDEX_RELEASE_CMS_CERT_SHA256` (canonical lowercase 64-hex DER certificate digest). The obsolete misnamed `INDEX_RELEASE_CMS_IDENTITY_SHA256` is explicitly refused. Identity enumeration must produce exactly one Developer ID Application row; exact-label certificate export must produce one certificate whose CN, Team `LMQ3XNXLAD`, and DER digest all match independently.
- Generation and verification now load and evaluate the committed draft-2020-12 schema directly. The closed evaluator is driven by the schema file and supports the schema's used `type`, `const`, `enum`, `pattern`, `minimum`, `required`, `additionalProperties`, `prefixItems`, `items`, `allOf`, and local `$ref` vocabulary; release-specific byte/artifact checks remain additional gates.
- Final artifacts, evidence, metadata, checksums, and schema are opened with `O_NOFOLLOW`; content is read through stable descriptors with before/after `fstat` plus path inode checks. Existing directories are physical/canonical, symlink aliases and overlapping final/output containment are refused.
- Metadata/checksum writes use exclusive same-directory owned files and hard-link no-clobber publication. Cleanup removes only recorded owned inode identities. There is no cross-filesystem rename or `.incomplete` destination.
- Signing now takes `FINAL_DIR OUTPUT_DIR BUILD FULL_COMMIT`, runs the canonical schema/final-artifact validator first, writes an exact validated private copy inside the output transaction, signs only that copy, recovers and byte-compares it, rechecks against canonical metadata, then no-clobber publishes CMS in the same destination directory.
- Replaced circular plaintext verification coverage with locally generated real DER opaque CMS fixtures and code-signing-only certificates. Tests mock only macOS Security trust/Keychain surfaces and reject wrong signer, multiple signers, tampering, malformed CMS, detached CMS, and ambiguous Keychain identities.

### Strict TDD RED

```bash
bun test apps/mac/release/tests/release-metadata-security.spec.mjs
```

Captured at `/tmp/task-5-fix-round-1-red.log`: exit 1, `3 pass`, `4 fail`. Failures demonstrated that schema mutation was ignored, descriptor/no-follow/no-clobber primitives were absent, exact hash pins were absent, and a valid real code-signing-only DER CMS fixture was rejected.

### GREEN and regression evidence

```bash
bun test apps/mac/release/tests/release-metadata-security.spec.mjs \
  apps/mac/release/tests/release-metadata.spec.mjs
```

Result: `12 pass`, `0 fail`, `119 expect() calls`.

```bash
bun test apps/mac/release/tests \
  apps/mac/IndexApp/notarize.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Result: `130 pass`, `1 skip`, `0 fail`, `696 expect() calls` across 15 files. The one existing skip is the Linux platform gate for a real-codesign fixture.

Shell syntax, focused ESLint, focused TypeScript checking, `git diff --check`, identity-logging scan, and privacy-assignment scan passed. `shellcheck` remains unavailable.

### Self-review and residual protected-context risk

Confirmed exact schema/URLs/checksums/reproducibility fields are unchanged; no metadata schema widening occurred. Confirmed pins are never printed and ambiguous/misnamed pins fail closed. Confirmed same-directory no-clobber publication and owned-inode cleanup for generated files/CMS. Provider-free Linux tests exercise real OpenSSL DER CMS parsing/signatures and code-signing EKU behavior, but protected Task 6 must still prove the exact macOS `security find-identity`, `find-certificate`, and `cms -S/-V/-D` output/behavior against the reviewed real Developer ID identity on an isolated runner.

### Attestation

No Apple identity/service, production certificate, credential, notary data, real release CMS, publication, deployment, protected operation, or push was used.

## Review fix round 2/5

Addressed all four open Important findings with strict TDD.

### Changes

- Factored `cms-verify.sh` so signing and verification run the same exact opaque DER structure/signature/content/signer check. Before publication, the private CMS must contain exactly one SignerInfo and certificate, recover exact validated bytes, and expose a signer certificate whose DER SHA-256 equals `INDEX_RELEASE_CMS_CERT_SHA256`; a same-label wrong certificate cannot publish.
- `publish_owned_noreplace` now explicitly returns on hard-link failure, checks the candidate/destination inode identity around link creation, removes only the owned candidate after link success, and propagates cleanup failure. Concurrent destination creation fails nonzero without clobber or owned residue.
- Added recursive schema-document validation against an exact supported draft-2020-12 vocabulary and keyword value shapes before instance evaluation. Unknown keywords, malformed types/patterns, non-local refs, unresolved refs, and unsupported schema forms fail closed while runtime remains schema-file-driven.
- Added `snapshot-file.py`: verification opens CMS with `O_NOFOLLOW`, requires stable regular-file descriptor/path identity, copies into an exclusive mode-0600 same-output private snapshot, and returns its SHA-256. Every `security` and OpenSSL phase consumes only that snapshot, whose hash is checked before/after phases; source replacement cannot switch verifier inputs. Owned transaction cleanup removes the snapshot.
- Corrected the stale Task 6 report instruction to the reviewed identity/certificate pins.

### Strict TDD RED

```bash
bun test apps/mac/release/tests/release-metadata-fix-round-2.spec.mjs
```

Captured at `/tmp/task-5-fix-round-2-red.log`: exit 1, `1 pass`, `4 fail`. Failures demonstrated wrong-cert CMS publication, permissive schema vocabulary, CMS symlink reaching Security, and mutable-path verification failure.

### GREEN and regression evidence

Focused metadata suites: `17 pass`, `0 fail`, `149 expect() calls`. Full Task 1-5 regression: `135 pass`, `1 skip`, `0 fail`, `726 expect() calls` across 16 files. Shell syntax, Python syntax, focused ESLint, focused TypeScript, `git diff --check`, identity logging scan, and privacy assignment scan passed.

### Residual and attestation

Real macOS Security/Keychain output and trust behavior remain protected Task 6 evidence. No Apple identity/service, production certificate, credential, protected operation, real release CMS, publication, deployment, or push was used.

## Review fix round 3/5

Addressed the remaining Important schema-document finding with strict TDD.

### Changes

- `minItems` and `maxItems` now require nonnegative integers and reject negative, fractional, string/NaN analogues; a schema with `minItems > maxItems` is refused.
- `minimum` requires a finite number.
- `required` requires unique strings; `enum` requires a nonempty array with JSON-deep-unique entries.
- `type` accepts only the exact supported string forms (`object`, `array`, `string`, `integer`) and explicitly refuses array union forms.
- `pattern` requires a compilable regex string.
- `properties` and `$defs` require records of object schemas; `prefixItems` and `allOf` require arrays of object schemas, with `allOf` nonempty.
- `additionalProperties` and `items` accept supported `false` or object-schema forms; `true` boolean schemas are explicitly refused rather than silently mishandled. Boolean child/root schemas are likewise refused explicitly.
- Local `$ref` values require canonical fragment-pointer form, valid escapes, existing path components, and an object-schema target; remote, malformed, and unresolved refs fail closed.
- Added evaluator support for object-schema `additionalProperties` and `items` forms so every admitted supported form is actually evaluated.

### Strict TDD evidence

RED command captured at `/tmp/task-5-fix-round-3-red.log`: `1 pass`, `1 fail`; the table stopped on accepted negative `minItems`, proving the gap. GREEN focused metadata command passes `19 pass`, `0 fail`, `177 expect() calls`. The table covers 26 malformed numeric/container/reference cases, and a committed-schema positive test preserves exact generation.

Full Task 1-5 regression passes `137 pass`, `1 skip`, `0 fail`, `754 expect() calls` across 17 files. Focused ESLint, TypeScript, and `git diff --check` pass.

### Residual and attestation

The schema evaluator intentionally supports only the committed closed vocabulary and fails on unimplemented draft keywords/forms. Real protected macOS CMS/Keychain behavior remains Task 6 evidence. No identity, Apple service, protected operation, publication, deployment, or push was used.

## Review fix round 4/5

Addressed the three open Important schema-evaluator semantic findings with strict TDD.

### Changes

- Schema-document traversal now records the exact JSON pointers of actual schema nodes only: root, property and `$defs` values, indexed `prefixItems`/`allOf` entries, and schema-valued `items`/`additionalProperties`. Local `$ref` targets must be in this marked set, so object/array containers such as `#/properties`, `#/$defs`, and `#/properties/artifacts/prefixItems` fail closed while committed `#/$defs/artifact` resolves. Active evaluator schema nodes are tracked and recursive `$ref`/`allOf` evaluation cycles are explicitly refused.
- Every admitted type-specific constraint now requires its supported explicit type: `pattern` requires `string`; `minimum` requires `integer`; `minItems`, `maxItems`, `prefixItems`, and `items` require `array`; and `properties`, `required`, and `additionalProperties` require `object`. The two committed `allOf` object refinements now state `type: object`; the metadata vocabulary and emitted metadata bytes remain unchanged.
- Added recursive JSON-semantic equality for `const`, `enum`, and enum uniqueness. Finite numbers use mathematical JSON equality, so `0` and `-0` compare equal; arrays remain ordered; objects compare own keys and values recursively; strings, booleans, and null remain exact. Canonical JSON output still normalizes signed zero to `0` and byte verification remains strict.

### Strict TDD evidence

RED command captured at `/tmp/task-5-fix-round-4-red.log`: `0 pass`, `4 fail`. It proved container refs, inapplicable constraints, signed-zero enum duplicates, and signed-zero const equality were mishandled. GREEN focused metadata suites pass `23 pass`, `0 fail`, `198 expect() calls`. Added direct coverage for three non-schema container refs, committed ref success, self-cycle refusal, eight type-applicability failures, `enum: [0,-0]`, `const: 0` against parsed `-0`, and unchanged canonical output normalization.

Full Task 1-5 regression passes `141 pass`, `1 skip`, `0 fail`, `775 expect() calls` across 18 files. Focused TypeScript, ESLint, shell/Python syntax, and `git diff --check` pass.

### Residual and attestation

Cycle refusal is deliberately conservative for this closed evaluator; the committed acyclic schema remains supported. Real protected macOS CMS/Keychain behavior remains Task 6 evidence. No identity, Apple service, protected operation, publication, deployment, push, or protected output was used.
