# macOS 1.0.0 protected release runbook

The protected workflow is the only production candidate builder. Pull-request and local output is development evidence and must never be published.

## Preconditions

1. The macOS production-release PR is merged to `dev` after checks and security review.
2. A separate release approval authorizes the exact full commit, annotated `v1.0.0` tag, and strictly increasing build number.
3. The `macos-production` GitHub Environment has required reviewers and the reviewed variables/secrets named in `.github/workflows/mac-production-release.yml`.
4. The tag ruleset is active, bypass-free, and protects update and deletion.
5. No `v1.0.0` GitHub Release exists.

## Protected candidate

Create and push an annotated tag at the exact approved commit, then approve the **Protected macOS production release** environment deployment. Alternatively dispatch the workflow with the exact tag, full commit, and build number after the annotated tag exists remotely.

A tag push or `operation=candidate` dispatch builds Universal 2 app/connector bundles, signs with Developer ID and Hardened Runtime, notarizes and staples inner bundles and DMGs, verifies mounted final bytes, emits checksums and CMS-signed release metadata, attests the five eventual public assets, and uploads a private immutable candidate handoff. **Candidate execution never creates, uploads to, or PATCHes a GitHub Release.** It never consumes signing authority in pull-request CI.

The workflow also emits a **private one-day connector plugin handoff** containing:

- `connector-release.cms` — opaque CMS over the exact connector executable trust metadata;
- `connector-release.cms.sha256` — lowercase SHA-256 of those CMS bytes.

Those files are deliberately not public release assets and are not committed automatically.

## Connector plugin pin follow-up

Release/security operators must download the private handoff, verify its workflow run/attempt, CMS signer certificate pin, recovered canonical JSON, and connector executable SHA-256, then open a separate reviewed PR that:

1. adds the exact CMS bytes at `packages/hermes-plugin/connector-release.cms`;
2. replaces `PINNED_CONNECTOR_RELEASE_CMS_SHA256 = None` with that exact digest;
3. bumps all Hermes plugin version surfaces and lockfile as required;
4. runs `packages/hermes-plugin/tests/connector_protocol.py`, smoke/gateway/migration tests, package inventory, and generated-skill checks.

Never synthesize the CMS, copy a digest from logs, accept a different signer, or allow the signed metadata to override the locally pinned Team ID, bundle ID, or designated requirement.

## Clean-account acceptance and public promotion

Before any public release, download the private candidate handoff and test those exact DMG bytes with quarantine preserved on macOS 13+ for Apple Silicon and Intel (or an approved equivalent): Gatekeeper launch, standalone connector with Index app absent, browser authorization, all capability families, negotiation pickup/respond/consultation/fallback, near-expiry reconnect, disconnect/revocation, plaintext migration, no-secret scans, uninstall, and reinstall.

Create the two schema-v3 canonical JSON records and opaque CMS signatures documented in `macos-clean-account-evidence.md`. Each record binds both DMG hashes, the candidate manifest seal, attestation URL, version, commit, floor, tester, and independent approver, and each CMS must be signed by its architecture-specific reviewed certificate pin. Validate all four input files provider-free with:

```bash
INDEX_RELEASE_APPROVAL_CERT_SHA256_ARM64=<reviewed-sha256> \
INDEX_RELEASE_APPROVAL_CERT_SHA256_X86_64=<reviewed-sha256> \
  bun apps/mac/release/verify-clean-account-evidence.ts --pair \
    arm64.json arm64.cms x86_64.json x86_64.cms
```

The signed CMS, not an unsigned or self-asserted JSON record, is the approval authority. Then obtain a separate protected-environment approval and dispatch `operation=publish` with the exact candidate run ID, candidate run attempt, and the base64-encoded canonical records. The publish job downloads the exact private handoff, rehashes every byte, validates both records and independence, rechecks CMS/metadata/checksums/tag/ruleset/history/attestation, and only then may create a private draft and issue the sole public `PATCH {"draft":false}`. Never publish from a tag push or candidate dispatch.

## Download page publication

Set `VITE_MAC_RELEASE_METADATA_URL` only to the immutable URL:

`https://github.com/indexnetwork/index/releases/download/v1.0.0/macos-release.json`

Deploy the web app only after public asset downloads match `SHA256SUMS` and CMS verification succeeds. The page parses the exact closed metadata contract and exposes no download when metadata is absent, mutable, malformed, or inconsistent. Rollback restores the previous immutable metadata URL; never replace bytes at an existing tag URL.
