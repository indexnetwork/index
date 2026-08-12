# Exact-head CI repair 2 report

## Starting authority and merge
- Verified clean branch/upstream at `0e3e04cb5e8018f9181df9d04f10e33893661e02`.
- Fetched `origin/dev`; it remained the reviewed `c39e12c732aed4e2fe4f148ae9ba3ae70f398547`.
- True-merged `origin/dev` with merge commit `8af479fcb`; no rebase or history rewrite.
- `.pi/settings.json` remained byte-identical at SHA-256 `03fb70ed6b9e5288b335d68b5dbd74cfb25597f95d1f6df3c87f1afa7c0d29fa`.

## Root causes and changes
1. Hosted `otool -X` emits a 16-hex address followed by 8- or 16-hex data fields. The extractor now validates the address, decodes only data, requires one consistent field width/cardinality, and enforces exact address continuity by bytes consumed. Canonical JSON and exact compiler NUL padding remain unchanged.
2. The packaging integration fixture now intercepts `xcrun otool`, matching the macOS wrapper route, without changing production tool selection.
3. The mount assertion normalizes both logged and captured `/private/var` aliases while still comparing the exact requested mount.
4. The stale notarization assertion now expects the intentional fail-closed `embedded.provisionprofile is missing` text.
5. The ancestry audit requires reviewed immutable checkout SHA `11d5960a326750d5838078e36cf38b85af677262` plus `fetch-depth: 0`.

## TDD evidence
- RED Universal focused run: 20 pass / 2 fail; both real address-prefixed acceptance cases failed with `malformed data row` before production repair.
- Existing hosted RED evidence: `notarize.spec.mjs` expected legacy text; packaging-order compared normalized log to unnormalized capture; packaging integration was bypassed by real `xcrun`; action audit required mutable `@v4`.
- GREEN focused exact-fix matrix: 42 pass / 0 fail.

## Validation
- `bun test apps/mac/release`: 192 pass / 0 fail, 1255 assertions.
- Exact discovery audit: 9 pass / 0 fail.
- `bun run --cwd services/api typecheck:cli-specs`: pass.
- `bun install --frozen-lockfile`: pass, no changes.
- `bash -n apps/mac/release/build-universal.sh`: pass.
- `git diff --check`: pass.
- Broader `bun test apps/mac` on Linux: 441 pass, 1 platform skip, 4 macOS-tool failures (`sips`/`codesign` unavailable); release matrix itself is fully green.

## Residual protected evidence
No signing, notarization, attestation, candidate/publish dispatch, deployment, provider, database, or PR merge operation was run. Hosted macOS Universal build and complete PR checks must rerun at the pushed exact head; this report does not claim hosted green prematurely.

## Review fix round 1/5

### Findings addressed
1. Added an adversarial address-contiguous identity dump whose first row is short but non-final. The extractor now requires every non-final row to contain the full field count (4 × 8-hex or 2 × 16-hex); only the final row may be short. Existing address continuity, field-width, canonical JSON, and exact padding checks remain intact.
2. Replaced detach substring containment with exact command parsing: exactly one `detach` line is required, both aliases are normalized, and the detached argument must equal the requested mount exactly. Production cleanup was not changed.

### Strict TDD evidence
- RED: `bun test apps/mac/release/tests/universal-build-contract.spec.mjs` — 22 pass / 1 fail; `an interior short row followed by contiguous data` was incorrectly accepted (`exitCode` was 0).
- RED: `bun test apps/mac/release/tests/packaging-order.spec.mjs` with a fixture-appended `appended-suffix` — 9 pass / 1 fail; exact assertion received `<requestedMount> appended-suffix`, proving the prior substring assertion was insufficient.
- GREEN: `bun test apps/mac/release/tests/universal-build-contract.spec.mjs apps/mac/release/tests/packaging-order.spec.mjs` — 33 pass / 0 fail, 153 assertions.
- GREEN matrix: `bun test apps/mac/release` — 193 pass / 0 fail, 1258 assertions.
- `bash -n apps/mac/release/build-universal.sh` — pass.
- `git diff --check` — pass.

No protected operation or merge was performed.

## Review fix round 2/5

### Findings addressed
1. The detach proof now counts every logged line whose first command token is exactly `detach`, including a bare invocation. It requires exactly one such command, requires exactly one argument, normalizes `/private/var` aliases, and compares exact equality with the requested mount. Production cleanup was not changed.
2. The requested positive short-final parser row was adjudicated impossible: canonical JSON plus exact compiler NUL padding is always a multiple of 16 bytes, and each supported `otool` row is exactly 16 data bytes. A short final row therefore cannot preserve the byte contract. The grammar was tightened to require full field cardinality on every row, and a negative fixture proves rejection at the row grammar boundary rather than later padding validation.

### Strict TDD evidence
- RED: `bun test apps/mac/release/tests/packaging-order.spec.mjs apps/mac/release/tests/universal-build-contract.spec.mjs` — 33 pass / 2 fail. The extra bare `detach` escaped the old `/^detach .+$/` count; the attempted positive short-final row failed exact compiler padding, proving the reviewer premise incompatible with the byte contract.
- Adjudicated parser RED: `bun test apps/mac/release/tests/universal-build-contract.spec.mjs` — the short-final negative expected `malformed data row` but received `invalid compiler section padding`, proving current grammar admitted the incomplete row too far.
- GREEN focused: `bun test apps/mac/release/tests/packaging-order.spec.mjs apps/mac/release/tests/universal-build-contract.spec.mjs` — 35 pass / 0 fail, 159 assertions.
- GREEN release matrix: `bun test apps/mac/release` — 195 pass / 0 fail, 1264 assertions.
- `bash -n apps/mac/release/build-universal.sh` — pass.
- `git diff --check` — pass.

No protected operation or merge was performed.
