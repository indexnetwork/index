# PR #1369 exact fallback URL and dev reconciliation report

## Surgical security fix

When GitHub's verified attestation result has no explicit `attestation.id`, `verifyCandidateAttestationResult` now accepts only the exact byte-for-byte string `https://github.com/indexnetwork/index/attestations/<recorded-id>`. It no longer parses the fallback through WHATWG `URL`, so normalized equivalents such as an explicit `:443`, differently cased host, or dot-segment path are refused. The existing explicit `attestation.id` comparison remains unchanged.

Strict TDD evidence:

- RED: the focused suite failed on the new explicit-`:443` case before the implementation change (`3 pass, 1 fail`).
- GREEN: the focused suite passed all four cases (`4 pass, 0 fail`, `59` assertions).
- Added fallback cases for the exact canonical string (accepted), explicit `:443` (refused), host casing (refused), and a dot-segment path (refused).

## Dev reconciliation

- Started clean at exact branch/upstream `d129939d71631cdf993a37975012d97b4ba3c78f` and exact `origin/dev` `0d1d80a1eec9b2bf72e398163fdf1a4eb81cafc8`.
- Fix commit: `79bb2479571503216e5270d9103c4a9f63e38553`.
- True merge commit: `0058bf2a07dc05e5d2d2827f464ffd25c0d72199` with parents `79bb2479571503216e5270d9103c4a9f63e38553` and `0d1d80a1eec9b2bf72e398163fdf1a4eb81cafc8`.
- The only merge conflicts were independent web version bumps in `apps/web/package.json` and `bun.lock`; they were reconciled as `0.52.1`, preserving both release and dev increments.
- `.pi/settings.json` stayed byte-for-byte unchanged (SHA-256 `03fb70ed6b9e5288b335d68b5dbd74cfb25597f95d1f6df3c87f1afa7c0d29fa`).

## Validation

Passed:

- Focused reviewer suite: `4 pass, 0 fail`, `59` assertions.
- Full macOS release matrix: `177 pass, 0 fail`, `1219` assertions.
- Linux-compatible native notification/bridge/assembly suite after protocol build: `242 pass, 1 platform-gated skip, 0 fail`, `2248` assertions.
- Protocol build, complete architecture check, and focused dev tool registry/runtime tests: architecture `30 pass`; focused `15 pass`.
- Focused web/release/dev tests, web production build, and web lint. Lint completed with `0 errors` and `85` pre-existing warnings; build emitted only the existing chunk-size advisory.
- Hermes plugin Python transport/migration/smoke/gateway tests, dashboard registration, and dashboard JavaScript syntax.
- Mac HTML assembly, shell syntax, Python compilation, workflow YAML parsing, generated skills diff, exact subtree dependency parity, frozen install, assembled output diff, and `git diff --check`.

A deliberately over-broad local command that included macOS-only `dmg.spec.mjs` failed because Linux has no `swiftc` or `codesign`; the supported Linux-compatible native matrix was then run explicitly and passed. Its first attempt also ran before protocol `dist` existed; after the required protocol build, the complete supported matrix passed. These are host/precondition limitations rather than product failures.

## Boundaries and residuals

No protected release workflow, signing, provider operation, attestation issuance, deployment, publication, or PR merge was run. Linux cannot prove Swift compilation, codesigning, Keychain, notarization, stapling, Gatekeeper, real GitHub attestation response shape, or clean-account execution. Hosted macOS and PR checks remain the authoritative evidence for those boundaries.
