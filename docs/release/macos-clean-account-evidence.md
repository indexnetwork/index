# macOS clean-account acceptance evidence

Create one JSON evidence file per architecture (`arm64` and `x86_64`) only after the private protected candidate handoff exists. Validate the exact pair with:

```bash
bun apps/mac/release/verify-clean-account-evidence.ts --pair arm64.json x86_64.json
```

The schema-v2 records bind the same exact release version, commit, **both** final DMG SHA-256 values, private candidate-manifest SHA-256, GitHub attestation URL, and macOS floor. They require distinct architectures and independent tester/approver identities; a tester cannot approve their own record and the two architecture records cannot share one approver. The remaining closed schema requires macOS 13+, quarantine/Gatekeeper proof, standalone connector operation with Index absent, all six canonical capability families, negotiation pickup/respond/consultation and Index fallback, near-expiry reconnect, disconnect/revocation, plaintext migration, zero secret-scan matches, uninstall/reinstall, and nonempty screenshot/log SHA-256 evidence lists.

Missing, one-architecture, duplicate-architecture, mismatched-candidate, unapproved, or non-independent records are publication failures. Evidence is supplied only to a later explicitly authorized `operation=publish` dispatch; candidate/tag execution cannot publish.

Evidence must contain no credential, authorization code, verifier, request/response body, transcript, owner memory, or raw private log. Store only the fixed booleans/identities and hashes of separately access-controlled evidence.
