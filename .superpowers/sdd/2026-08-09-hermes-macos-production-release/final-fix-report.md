# Final whole-branch fix report

## Result

Implemented the provider-free A–E final fix wave from clean base `f6e193ed5c0c62baf5001293215092cf86680916`. Final re-review is pending. No workflow was dispatched and no protected operation occurred.

## Fixed findings

- **A publication gate:** production workflow is now a real two-stage transaction. Candidate/tag runs end at a private immutable Actions handoff. Only a later `operation=publish` dispatch under `macos-production` consumes the exact candidate run/attempt plus arm64 and x86_64 schema-v2 records. The publish path rehashes the candidate manifest/files, validates independent approvals and exact release bindings, rechecks metadata/CMS platform trust/checksums/tag/ruleset/history/GitHub attestations, then creates a private draft and makes the sole public `PATCH {"draft":false}`.
- **B isolation guard:** repeated Task-4 guard derives `$INDEX_RELEASE_WORK_ROOT/authority/state/process.allow`, refuses missing/non-regular state, and passes the listener/worker path and SHA pins. Execution fixtures prove exact arguments and fail-closed state loss.
- **C Bash 3:** CMS identity lowercase conversion uses `tr`; the subject parser handles OpenSSL's `subject=` prefix. A compatibility execution fixture exercises identity resolution through both CMS signing source contracts with Bash compatibility mode.
- **D web delivery:** immutable request authority remains exact `github.com/indexnetwork/index/releases/download/vX.Y.Z/macos-release.json`; fetch follows GitHub's redirect only and requires a successful redirected final URL on HTTPS `release-assets.githubusercontent.com` with no credentials or custom port. Metadata retains exact immutable artifact URLs. Redirect/evil-host/direct/mutable tests pass.
- **E hosted CI:** exact-head run `31611374861` remained red: universal failed at the production bundle step; build failed at the shell/handoff suite with public annotations for the inventory fixture, mount detach fixture, and notary fixture. Fixes use system `hashlib.sha256`, set mounted state only after successful attach, preserve the complete notary fixture contract, run the full release test glob in macOS CI, and use `xcrun otool -X` on hosted macOS with provider-free fallback. The universal/runtime regression contracts pass locally; hosted checks must rerun after push.

## Strict TDD evidence

RED before implementation:

- `bun test apps/mac/release/tests/final-fix-wave.spec.mjs`: `0 pass`, `6 fail`.
- `cd apps/web && bun --bun vitest run src/lib/__tests__/mac-release-redirect.test.ts`: `0 pass`, `2 fail`.

Focused GREEN:

- `bun test apps/mac/release/tests/final-fix-wave.spec.mjs`: `6 pass`, `0 fail`, `50 expect()` calls.
- `bun test apps/mac/release/tests apps/mac/IndexApp/notarize.spec.mjs apps/mac/IndexApp/provisioning-profile.spec.mjs`: `173 pass`, `0 fail`, `1160 expect()` calls across 26 files.
- Web release tests: `7 pass`, `0 fail` across 3 files.
- Mac runtime/API regression: `191 pass`, `0 fail`, `2029 expect()` calls across 14 files.
- Hermes plugin regression: connector protocol `15/15`, migration `10/10`, smoke/gateway/dashboard checks passed.

## Static/build validation

- Frozen install: 878 installs / 988 packages checked, no changes.
- Release/mac shell syntax passed.
- Release Python compile passed; caches removed.
- Both workflow YAML documents parsed.
- Privileged literal pin consistency passed: build-release (4), sealed inventory (3), ruleset (3), process isolation (3), prior metadata verifier (3).
- `apps/mac/scripts/assemble.py` regenerated `Resources/index.html`; generated diff was empty.
- Protocol Atlas current: 60 nodes, 67 edges, 20 experiments, 61 modes.
- Subtree parity: 9 dependency ranges across 4 mirrored packages matched.
- Web lint completed with 0 errors / 85 pre-existing warnings. Web build passed with existing VITE protocol/CSS/chunk warnings.
- `git diff --check` passed.
- `.pi/settings.json` remained SHA-256 `03fb70ed6b9e5288b335d68b5dbd74cfb25597f95d1f6df3c87f1afa7c0d29fa`.

## Protected residual evidence

Real Developer ID/Keychain/provisioning identity, Bash 3.2 system execution, signing, Apple notarization/stapling/Gatekeeper, hosted-runner process pins, GitHub private-artifact download, attestation verification, release REST draft/upload/PATCH semantics, clean-account behavior, and public-download CORS remain protected-run evidence. No checks are claimed green until GitHub reruns them at the pushed head.

## Attestation

No secret was read or written. No workflow dispatch, signing, notarization, stapling, Apple/GitHub provider mutation, draft/release creation, upload, attestation, public publication, deployment, merge, or protected operation occurred during implementation/validation. Only the authorized branch push and PR body update are performed after local commit.
