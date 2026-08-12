# macOS clean-account acceptance evidence

Create one JSON evidence file per architecture (`arm64` and `x86_64`) after the protected candidate exists. Validate each with:

```bash
bun apps/mac/release/verify-clean-account-evidence.ts evidence.json
```

The closed schema requires release `1.0.0`, exact commit and artifact SHA-256, macOS 13+, tester and approver identities, quarantine/Gatekeeper proof, standalone connector operation with Index absent, all six canonical capability families, negotiation pickup/respond/consultation and Index fallback, near-expiry reconnect, disconnect/revocation, plaintext migration, zero secret-scan matches, uninstall/reinstall, and nonempty screenshot/log SHA-256 evidence lists.

Evidence must contain no credential, authorization code, verifier, request/response body, transcript, owner memory, or raw private log. Store only the fixed booleans/identities and hashes of separately access-controlled evidence.
