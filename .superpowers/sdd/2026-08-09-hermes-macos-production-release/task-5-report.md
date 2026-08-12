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
- Task 6 must retain Task 4 evidence beside both promoted DMGs, use a new private mode-0700 metadata output directory, supply `INDEX_RELEASE_CMS_SIGNING_IDENTITY` without tracing/logging it, and run verification before publication.
- No `macos-release.cms` was generated here because no signing identity was used, as required.

## Attestation

No Apple service, signing identity, certificate material, credential, notary data, real CMS signature, real DMG, publication, deployment, upload, protected environment, push, or protected operation was accessed or used.
