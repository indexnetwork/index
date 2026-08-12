# Hermes macOS Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible Universal 2 Index app and Index Connector artifacts that can be published only after production endpoint, signing, Hardened Runtime, notarization, stapling, checksum, provenance, and clean-account gates pass.

**Architecture:** Pull-request CI validates deterministic release contracts without secrets. A protected macOS GitHub Environment performs optimized dual-architecture builds from one tagged checkout, signs nested code inside-out, notarizes and staples inner bundles, packages and notarizes final DMGs, emits CMS-signed metadata/checksums, and publishes immutable release assets only after final mounted-artifact verification.

**Tech Stack:** Swift 5/macOS 13, shell, `swiftc`, `lipo`, `otool`, `codesign`, `security`, `notarytool`, `stapler`, `spctl`, `hdiutil`, Bun tests, GitHub Actions protected environments, React download page.

## Global Constraints

- Stack this PR on the backend production-assurance PR.
- Direct Developer ID distribution is intentional; do not add App Sandbox.
- Every production Mach-O is optimized, Universal 2 (`arm64` + `x86_64`), and targets macOS 13.0.
- Production builds require immutable HTTPS API/web endpoints and reject localhost, loopback, credentials, query/fragment components, and development/staging hosts.
- Production Web Inspector, developer extras, runtime endpoint overrides, JIT/debug entitlements, `get-task-allow`, and library-validation exceptions are forbidden.
- Sign nested code inside-out with Developer ID and Hardened Runtime. Never use `codesign --deep` as the signing strategy.
- Staple and validate inner app/connector bundles before DMG creation; notarize, staple, and validate the final DMGs too.
- Package only after stapling. Final verification mounts the bytes that will be published.
- Release metadata binds release version, commit, Team ID, endpoints, architectures, macOS floor, connector protocol, artifact sizes, and SHA-256 values; it is CMS-signed and accompanied by GitHub build provenance.
- Pull-request jobs have no release secrets and never label ad-hoc output production-ready.
- Release workflow uses a protected `macos-production` environment and cannot publish when any input or gate is absent.
- Manual install is the only update mechanism in this scope; do not add Sparkle.
- No production publication, deployment, or merge occurs without explicit authorization.

---

### Task 1: Define one immutable release configuration and version contract

**Files:**
- Create: `apps/mac/release/release-config.sh`
- Create: `apps/mac/release/tests/release-contract.spec.mjs`
- Modify: `apps/mac/IndexApp/Info.plist`
- Modify: `apps/mac/IndexConnector/Info.plist`
- Modify: `apps/mac/IndexApp/Sources/main.swift`
- Modify: `apps/mac/IndexConnector/Sources/ConnectorIdentity.swift`
- Modify: `apps/web/src/app/download/page.tsx`
- Modify: `apps/web/tests/download-page.test.tsx`

**Interfaces:**
- Produces `validate_release_version`, `validate_production_url`, and `write_release_config` shell functions.
- Produces embedded keys `IndexReleaseChannel`, `IndexReleaseVersion`, `IndexReleaseCommit`, `IndexAPIURL`, `IndexWebURL`, `IndexExpectedTeamID`, `IndexConnectorProtocolVersion`, and `IndexDevelopmentBuild`.
- Sets marketing version `1.0.0` for the first production artifact; build number is a strictly increasing numeric workflow input.

- [ ] **Step 1: Write failing release configuration tests**

```javascript
expect(validateUrl('https://protocol.index.network')).toEqual({ ok: true });
for (const value of [
  'http://protocol.index.network', 'https://localhost:3001',
  'https://dev.index.network', 'https://user@index.network',
  'https://index.network/path?debug=1',
]) expect(validateUrl(value).ok).toBe(false);
expect(releasePlist.LSMinimumSystemVersion).toBe('13.0');
expect(releasePlist.CFBundleShortVersionString).toBe('1.0.0');
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/release-contract.spec.mjs apps/web/tests/download-page.test.tsx
```

Expected: FAIL because release configuration is not centralized and the app still permits localhost/macOS 11.

- [ ] **Step 3: Implement fail-closed configuration generation**

`release-config.sh` requires `INDEX_RELEASE_VERSION`, `INDEX_BUILD_NUMBER`, `INDEX_RELEASE_COMMIT`, `INDEX_API_URL`, `INDEX_WEB_URL`, `INDEX_EXPECTED_TEAM_ID`, and `INDEX_CONNECTOR_PROTOCOL_VERSION`. Production source reads only embedded values; development builds retain explicit local defaults and display a development marker.

- [ ] **Step 4: Remove production runtime overrides and inspection**

`AppConfig` ignores `UserDefaults` in production. Set `developerExtrasEnabled` and `isInspectable` only when `IndexDevelopmentBuild == true`. Connector rejects endpoint fields in JSON requests and reports only a non-secret endpoint environment label.

- [ ] **Step 5: Update the download-page contract**

Replace the macOS 11 copy and bare download URL with macOS 13+, version, app/connector links, SHA-256 values, and signed-metadata link read from `VITE_MAC_RELEASE_METADATA_URL`.

- [ ] **Step 6: Run tests and commit**

```bash
bun test apps/mac/release/tests/release-contract.spec.mjs apps/web/tests/download-page.test.tsx
git add apps/mac apps/web
git commit -m "feat(mac): define production release configuration"
```

---

### Task 2: Build optimized Universal 2 app and connector bundles

**Files:**
- Modify: `apps/mac/IndexApp/build.sh`
- Modify: `apps/mac/IndexConnector/build.sh`
- Create: `apps/mac/release/build-universal.sh`
- Create: `apps/mac/release/tests/universal-build-contract.spec.mjs`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Produces `compile_slice(target, arch, output)`, `merge_universal(arm64, x86_64, output)`, and `verify_macho(binary)`.
- Produces unsigned/ad-hoc `Index.app` and `IndexConnector.app` Universal 2 bundles in `apps/mac/dist/unsigned/`.

- [ ] **Step 1: Write failing source-contract tests**

```javascript
expect(buildSource).toContain('-target arm64-apple-macos13.0');
expect(buildSource).toContain('-target x86_64-apple-macos13.0');
expect(buildSource).toContain('-O');
expect(buildSource).toContain('-whole-module-optimization');
expect(buildSource).toContain('lipo -create');
expect(buildSource).not.toContain('-Onone');
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/universal-build-contract.spec.mjs
```

Expected: FAIL because current scripts compile only the host architecture with `-Onone`.

- [ ] **Step 3: Implement dual-slice builds from one checkout**

Compile each native target twice with `-O -whole-module-optimization -target "$ARCH-apple-macos13.0"`, merge with `lipo -create`, and compare exported configuration/build IDs across slices before bundling.

- [ ] **Step 4: Verify architectures and deployment targets**

```bash
lipo -archs apps/mac/dist/unsigned/Index.app/Contents/MacOS/Index
lipo -archs apps/mac/dist/unsigned/IndexConnector.app/Contents/MacOS/IndexConnector
otool -l apps/mac/dist/unsigned/Index.app/Contents/MacOS/Index | grep -A6 LC_BUILD_VERSION
```

Expected: both commands report `x86_64 arm64`; every `minos` is `13.0`.

- [ ] **Step 5: Preserve fast host-architecture PR fixtures**

Keep fixture-only `--fixture` builds for native tests, but add one macOS PR job that runs the real Universal 2 ad-hoc build and verifies both slices without signing secrets.

- [ ] **Step 6: Run tests and commit**

```bash
bun test apps/mac/release/tests/universal-build-contract.spec.mjs
bash -n apps/mac/IndexApp/build.sh apps/mac/IndexConnector/build.sh apps/mac/release/build-universal.sh
git add apps/mac .github/workflows/mac-app-build.yml
git commit -m "build(mac): produce Universal 2 bundles"
```

---

### Task 3: Enforce Developer ID, Hardened Runtime, and exact entitlements

**Files:**
- Create: `apps/mac/release/sign-bundles.sh`
- Create: `apps/mac/release/verify-signatures.sh`
- Create: `apps/mac/release/tests/signing-contract.spec.mjs`
- Modify: `apps/mac/IndexApp/provisioning-profile.sh`
- Modify: `apps/mac/IndexApp/provisioning-profile.spec.mjs`
- Modify: `apps/mac/IndexApp/IndexApp.entitlements`
- Modify: `apps/mac/IndexConnector/IndexConnector.entitlements`

**Interfaces:**
- Produces `sign_inside_out(bundle, identity)` and `verify_designated_requirement(bundle, teamId)`.
- Produces exact app associated-domain/app-Keychain entitlements and connector-only Keychain entitlements.

- [ ] **Step 1: Write failing signing/entitlement tests**

```javascript
for (const forbidden of [
  'com.apple.security.app-sandbox', 'com.apple.security.get-task-allow',
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.disable-library-validation',
]) expect(releaseEntitlements).not.toContain(forbidden);
expect(signScript).toContain('--options runtime');
expect(signScript).toContain('--timestamp');
expect(signScript).not.toMatch(/codesign[^\n]*--deep[^\n]*--sign/);
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/signing-contract.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
```

Expected: FAIL because connector signing and forbidden-entitlement verification are absent.

- [ ] **Step 3: Implement explicit inside-out signing**

Sign nested frameworks/helpers/connector executable first, then each bundle. Require Developer ID Application identity, expected Team ID, matching bundle/application identifiers, non-expired profiles, timestamp, and Hardened Runtime. Never infer the Team ID solely from caller input; compare certificate, profile, and embedded release config.

- [ ] **Step 4: Verify every Mach-O and entitlement set**

Use `find` plus `file` to enumerate Mach-O files, then `codesign --verify --strict`, inspect flags for `runtime`, compare designated requirements, and reject any unexpected entitlement key. `codesign --deep --strict` may run only as an additional final verification.

- [ ] **Step 5: Run tests and commit**

```bash
bun test apps/mac/release/tests/signing-contract.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs
bash -n apps/mac/release/sign-bundles.sh apps/mac/release/verify-signatures.sh
git add apps/mac
git commit -m "build(mac): enforce production code signing"
```

---

### Task 4: Notarize and staple before final packaging

**Files:**
- Create: `apps/mac/release/notarize-bundle.sh`
- Create: `apps/mac/release/create-dmg.sh`
- Create: `apps/mac/release/notarize-dmg.sh`
- Create: `apps/mac/release/verify-mounted-dmg.sh`
- Create: `apps/mac/release/tests/packaging-order.spec.mjs`
- Modify: `apps/mac/IndexApp/notarize.sh`
- Modify: `apps/mac/IndexApp/notarize.spec.mjs`

**Interfaces:**
- Produces stapled `Index.app` and `IndexConnector.app` before packaging.
- Produces `Index-macOS-1.0.0-universal.dmg` and `IndexConnector-1.0.0-universal.dmg`.

- [ ] **Step 1: Write a failing order test**

```javascript
const stapleApp = script.indexOf('notarize-bundle.sh');
const createDmg = script.indexOf('create-dmg.sh');
const stapleDmg = script.indexOf('notarize-dmg.sh');
expect(stapleApp).toBeGreaterThan(-1);
expect(createDmg).toBeGreaterThan(stapleApp);
expect(stapleDmg).toBeGreaterThan(createDmg);
expect(script).toContain('verify-mounted-dmg.sh');
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/packaging-order.spec.mjs apps/mac/IndexApp/notarize.spec.mjs
```

Expected: FAIL because current notarization creates no final DMG and does not verify shipped bytes.

- [ ] **Step 3: Implement inner notarization and stapling**

Zip each signed bundle only for notary submission, call `notarytool submit --wait`, require Accepted status, staple, validate, run `spctl`, and re-run signature/architecture/config verification.

- [ ] **Step 4: Create, sign, notarize, and staple DMGs**

Create deterministic read-only DMGs from already stapled bundles, sign each DMG, submit/wait, staple, validate, mount read-only, and run all final checks against mounted content. Unmount through `trap` on every exit path.

- [ ] **Step 5: Run provider-free tests and protected candidate command**

```bash
bun test apps/mac/release/tests/packaging-order.spec.mjs apps/mac/IndexApp/notarize.spec.mjs
bash -n apps/mac/release/notarize-bundle.sh apps/mac/release/create-dmg.sh \
  apps/mac/release/notarize-dmg.sh apps/mac/release/verify-mounted-dmg.sh
```

Protected macOS environment:

```bash
apps/mac/release/notarize-bundle.sh apps/mac/dist/signed/Index.app
apps/mac/release/notarize-bundle.sh apps/mac/dist/signed/IndexConnector.app
apps/mac/release/create-dmg.sh apps/mac/dist/signed/Index.app apps/mac/dist/final/Index-macOS-1.0.0-universal.dmg
apps/mac/release/notarize-dmg.sh apps/mac/dist/final/Index-macOS-1.0.0-universal.dmg
```

Expected: every notary status is Accepted and stapler/spctl/final mounted verification pass.

- [ ] **Step 6: Commit**

```bash
git add apps/mac
git commit -m "build(mac): notarize final distribution artifacts"
```

---

### Task 5: Emit checksums, signed metadata, and provenance

**Files:**
- Create: `apps/mac/release/release-metadata.schema.json`
- Create: `apps/mac/release/generate-release-metadata.ts`
- Create: `apps/mac/release/sign-release-metadata.sh`
- Create: `apps/mac/release/verify-release-metadata.sh`
- Create: `apps/mac/release/tests/release-metadata.spec.mjs`

**Interfaces:**
- Produces `macos-release.json`, `macos-release.cms`, and `SHA256SUMS`.
- Metadata schema contains only `schemaVersion`, `releaseVersion`, `buildNumber`, `commit`, `teamId`, `apiUrl`, `webUrl`, `architectures`, `minimumMacOS`, `connectorProtocolVersion`, and artifact `{name,url,sha256,size,kind}` entries.

- [ ] **Step 1: Write failing deterministic schema/checksum tests**

```javascript
expect(metadata.architectures).toEqual(['arm64', 'x86_64']);
expect(metadata.minimumMacOS).toBe('13.0');
expect(metadata.artifacts.map((item) => item.kind).sort()).toEqual(['app-dmg', 'connector-dmg']);
expect(JSON.stringify(metadata)).not.toMatch(/key|token|credential|notaryPassword/i);
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/release-metadata.spec.mjs
```

Expected: FAIL because metadata generation is missing.

- [ ] **Step 3: Generate canonical metadata from final artifacts**

Sort object keys and artifacts deterministically, calculate SHA-256 and byte size from final DMGs, bind immutable GitHub release URLs and all embedded release identity fields, then validate against the JSON schema.

- [ ] **Step 4: CMS-sign and verify metadata**

Use the Developer ID identity through `security cms -S`; verify with `security cms -D`, compare recovered canonical JSON byte-for-byte, and verify `shasum -a 256 -c SHA256SUMS`. Never log signing environment values.

- [ ] **Step 5: Run tests and commit**

```bash
bun test apps/mac/release/tests/release-metadata.spec.mjs
bash -n apps/mac/release/sign-release-metadata.sh apps/mac/release/verify-release-metadata.sh
git add apps/mac/release
git commit -m "build(mac): sign release metadata"
```

---

### Task 6: Add a protected, all-or-nothing release workflow

**Files:**
- Create: `.github/workflows/mac-production-release.yml`
- Create: `apps/mac/release/build-release.sh`
- Create: `apps/mac/release/tests/release-workflow.spec.mjs`
- Modify: `.github/workflows/mac-app-build.yml`

**Interfaces:**
- Consumes exact release config, build, signing, notarization, DMG, and metadata scripts from Tasks 1-5.
- Produces an immutable GitHub Release only after all verification passes.

- [ ] **Step 1: Write failing workflow security tests**

```javascript
expect(workflow).toContain('environment: macos-production');
expect(workflow).toContain('contents: write');
expect(workflow).toContain('id-token: write');
expect(workflow).toContain('cancel-in-progress: false');
expect(workflow).not.toMatch(/pull_request:[\s\S]*macos-production/);
expect(workflow.indexOf('verify-release-metadata.sh')).toBeLessThan(workflow.indexOf('gh release create'));
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/release-workflow.spec.mjs
```

Expected: FAIL because no production workflow exists.

- [ ] **Step 3: Implement protected tag/manual orchestration**

Require clean tagged provenance, monotonic version/build number, exact commit, production URLs, Team ID, connector protocol, Developer ID/profile/notary credentials, and protected environment approval. Use one checkout for both architectures. Set concurrency without cancellation once notarization begins.

- [ ] **Step 4: Make publication the final irreversible step**

Build → sign → verify → notarize/staple inner → package → notarize/staple DMGs → mount/final verify → metadata/checksums/CMS verify → GitHub artifact attestation → `gh release create`. A trap deletes temporary keychains/profiles and leaves no partial release when a pre-publication gate fails.

- [ ] **Step 5: Keep PR CI secret-free**

PR CI runs all Bun/shell contracts and the ad-hoc Universal 2 build. It cannot access `macos-production`, notary, certificate, or publication permissions and labels outputs `development-only`.

- [ ] **Step 6: Run tests and commit**

```bash
bun test apps/mac/release/tests/release-workflow.spec.mjs
bash -n apps/mac/release/build-release.sh
git add .github/workflows apps/mac/release
git commit -m "ci(mac): gate production releases"
```

---

### Task 7: Publish verified release information on the download page

**Files:**
- Create: `apps/web/src/lib/mac-release.ts`
- Create: `apps/web/src/lib/__tests__/mac-release.test.ts`
- Modify: `apps/web/src/app/download/page.tsx`
- Modify: `apps/web/tests/download-page.test.tsx`
- Create: `docs/release/macos-release-runbook.md`

**Interfaces:**
- Produces strict `MacReleaseMetadata` parser.
- Consumes `VITE_MAC_RELEASE_METADATA_URL` pointing to immutable release JSON.
- Displays app/connector DMG URLs, version, macOS floor, architectures, SHA-256, signed metadata, and installation instructions.

- [ ] **Step 1: Write failing metadata parser and stale-publication tests**

```typescript
expect(parseMacReleaseMetadata(validFixture).releaseVersion).toBe('1.0.0');
expect(() => parseMacReleaseMetadata({ ...validFixture, minimumMacOS: '11.0' }))
  .toThrow('unsupported macOS floor');
expect(() => parseMacReleaseMetadata({ ...validFixture, architectures: ['arm64'] }))
  .toThrow('Universal 2 required');
```

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/web
bun test src/lib/__tests__/mac-release.test.ts tests/download-page.test.tsx
```

Expected: FAIL because the page accepts a bare URL and stale macOS 11 copy.

- [ ] **Step 3: Implement fail-closed publication rendering**

If metadata is absent, malformed, mutable, non-HTTPS, wrong-platform, or incomplete, show **Download unavailable** and no artifact link. Never fall back to an older URL. Display checksum and CMS/provenance verification instructions.

- [ ] **Step 4: Document atomic publication**

The runbook uploads immutable assets first, verifies public downloads against checksums, updates `VITE_MAC_RELEASE_METADATA_URL` to the immutable tag URL, deploys web, then verifies the page. Rollback restores the prior immutable metadata URL; it never replaces bytes at an existing URL.

- [ ] **Step 5: Run tests and commit**

```bash
cd apps/web
bun test src/lib/__tests__/mac-release.test.ts tests/download-page.test.tsx
cd ../..
git add apps/web docs/release/macos-release-runbook.md
git commit -m "feat(web): publish verified Mac releases"
```

---

### Task 8: Add clean-account acceptance and finish release verification

**Files:**
- Create: `docs/release/macos-clean-account-evidence.md`
- Create: `apps/mac/release/verify-clean-account-evidence.ts`
- Create: `apps/mac/release/tests/clean-account-evidence.spec.mjs`
- Modify: `apps/mac/README.md`
- Modify: `docs/guides/development-reference.md`

**Interfaces:**
- Produces a machine-checked evidence record tied to release version, commit, artifact SHA, macOS version, hardware architecture, tester, and approval.

- [ ] **Step 1: Write a failing evidence-schema test**

```javascript
expect(() => verifyEvidence({ ...validEvidence, quarantinePreserved: false }))
  .toThrow('quarantine evidence required');
expect(() => verifyEvidence({ ...validEvidence, indexAppInstalled: true, appFreeHermesVerified: false }))
  .toThrow('standalone Hermes evidence required');
expect(() => verifyEvidence({ ...validEvidence, secretScanMatches: 1 }))
  .toThrow('secret scan must be clean');
```

- [ ] **Step 2: Run and verify RED**

```bash
bun test apps/mac/release/tests/clean-account-evidence.spec.mjs
```

Expected: FAIL because no acceptance evidence validator exists.

- [ ] **Step 3: Define the exact clean-account checklist**

Require quarantine preservation, Gatekeeper launch, macOS 13+, Apple Silicon and Intel evidence (physical or approved equivalent), connector install with app absent, browser login, every canonical capability family, negotiation/consultation/fallback, near-expiry reconnect, disconnect/revocation, plaintext migration, no-secret scans, uninstall, reinstall, screenshot/log hashes, and approver identity.

- [ ] **Step 4: Run the full provider-free PR 3 matrix**

```bash
bun test apps/mac/release/tests/*.spec.mjs \
  apps/mac/IndexApp/notarize.spec.mjs \
  apps/mac/IndexApp/provisioning-profile.spec.mjs \
  apps/web/tests/download-page.test.tsx
bash -n apps/mac/IndexApp/build.sh apps/mac/IndexConnector/build.sh apps/mac/release/*.sh
cd apps/mac/IndexApp
python3 assemble.py
cd ../../..
bun install --frozen-lockfile
git diff --check
git status --short
```

Expected: all release contracts pass and generated app HTML is current.

- [ ] **Step 5: Run protected candidate verification**

Execute `apps/mac/release/build-release.sh` in the protected environment, verify final public-download bytes, complete clean-account evidence, and obtain security plus release-operator approval. Do not publish publicly without explicit authorization.

- [ ] **Step 6: Run independent reviews and commit**

Request release-security, signing/notarization, supply-chain, macOS compatibility, and download-publication reviews. Resolve every blocker/high/medium finding.

```bash
git add docs apps/mac/README.md
git commit -m "docs(mac): finalize production release gates"
```
