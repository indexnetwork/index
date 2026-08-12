# PR #1369 final reconciliation and security fix report

## Reconciliation

- Started clean at exact branch/upstream `72bf267b2985e0638a198d44a8b1ebeca3571a14` and `origin/dev` `8427d3fa2298461608495142fd55ce50f6d3c2d1`.
- Merged `origin/dev` with true merge commit `72880cee37be5596674faf94e41411bef570d05a` (parents: required branch head and required dev head).
- Resolved native notification conflicts by retaining dev's retry/cancellation tests and bridge behavior while preserving the credential-bearing native SSE boundary and exact native route admission.
- Preserved `.pi/settings.json` byte-for-byte (SHA-256 `03fb70ed6b9e5288b335d68b5dbd74cfb25597f95d1f6df3c87f1afa7c0d29fa`).

## Reviewer findings fixed with RED/GREEN tests

1. Architecture-specific pins now require the arm64-pinned record to declare `arm64` and the x86_64-pinned record to declare `x86_64`.
2. Signed evidence bytes must exactly equal recursive lexicographic object-key ordering encoded by compact `JSON.stringify`, plus exactly one final newline. Reordered, whitespace-modified, alternate-escaped, and duplicate-key bytes fail canonical reserialization.
3. Attestation subject names are compared as exact approved relative filenames; no basename/path normalization is performed.
4. Attestation identity accepts only exact `attestation.id`, or when that documented field is absent, the exact canonical GitHub attestation URL. Certificate source ref is required to be `refs/tags/v1.0.0`, and `gh attestation verify` is also invoked with the corresponding `--source-ref` policy.

## Validation

- RED proof: focused suite initially failed swapped pins, noncanonical signed bytes, and path-prefixed subjects (`1 pass, 3 fail`).
- GREEN focused reviewer suite: `4 pass, 0 fail`.
- Full provider-free macOS release matrix: `177 pass, 0 fail` (`1215` assertions).
- Combined release/native notification/bridge/assembly suite: `237 pass, 0 fail` (`1997` assertions).
- Focused Hermes runtime/native notification/bridge/assembly: `115 pass, 0 fail` (`1291` assertions).
- Web release tests, production build, and lint passed. Lint emitted existing warnings only (`0 errors`, `85 warnings`); build emitted the existing chunk-size advisory.
- Hermes plugin desktop notification and Python smoke/dashboard registration passed.
- Shell syntax, Python compilation, workflow YAML parsing, subtree exact-pin parity, frozen install, generated skills diff, assembled bundle diff, TypeScript lint, and `git diff --check` passed.

## Protected boundaries and residuals

No protected workflow, signing, provider operation, attestation issuance, deployment, publication, or PR merge was run. Local Linux validation cannot prove macOS `openssl cms`, real `gh attestation verify --format json` response shape, Developer ID/Keychain/notary/stapling/Gatekeeper, or protected clean-account execution. Hosted checks must be observed after push.
