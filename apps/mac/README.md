# Index macOS Client

Index is a macOS 13+ WKWebView client with a native, credential-free request bridge. It is an optional owner-control surface: standalone Hermes connection does **not** require the Index app to be installed or running.

## Security model

The signed app owns an `idxo_` credential with audience `index-app-owner`; the standalone Index Connector owns the separate `idxh_` Hermes credential with audience `hermes-agent`. They use separate Keychain services/access groups and neither process can read the other item's credential. Raw credentials, PKCE verifiers, authorization codes, activation proofs, and authorization headers never enter browser JavaScript, WebKit storage, Application Support records, logs, callback URLs, or generated HTML.

The native `indexAPI` bridge accepts only the exact bundled main document and document generation. JavaScript supplies structured, allowlisted requests; Swift constructs the fixed API/MCP URLs, reads the owner credential natively, validates body/schema/resource bounds, and returns sanitized data only. It permits bounded REST, upload, and SSE operations (32 pending requests, 1 MiB ordinary request/response, 8 MiB decoded images, 64 KiB events, 256 events; 30-second ordinary and five-minute stream deadlines). It never accepts a browser-supplied URL, header, credential, or transport override.

## Owner sign-in and migration

The app uses PKCE S256 with the canonical callback `http://127.0.0.1:<49152-65535>/callback`. The first-party flow creates a pending `idxo_` credential, verifies its Keychain write/read-back, and activates it with a one-time native proof. It expires after 30 days with no refresh path.

Historical `credential.json` installations are not migrated into Keychain. Startup preserves only nonsecret legacy key-ID recovery evidence, securely deletes and verifies absence of the exact plaintext file, remains signed out, and requires a fresh browser login. During approved replacement, the server revokes the legacy credential before issuing the pending replacement. Offline or uncertain cases remain recovery-only; the Application Support parent is retained because it contains nonsecret runtime journals.

Logout quarantines bridge work, pauses/scrubs Hermes local activity, revokes the exact owner credential, verifies denial, then deletes the Keychain item. Uncertain network or persistence outcomes retain nonsecret recovery evidence and never claim logout completed.

## Hermes runtime

The native app may show the same owner controls as the web, but it is not required for direct Hermes use. Connector-backed selection requires verified connector trust/status, exact installation/agent/setup-generation equality, active health, exact six-action grant, and valid expiry. The local runtime uses generation-fenced fallback and cron ownership markers: it pauses only the exact owned schedule, preserves unrelated Hermes state, and never recreates plaintext credentials. Disconnect is ordered connector status/disconnect → exact owner CAS to Index → fenced local cleanup; uncertain state remains recovery-only.

## Build and source checks

```bash
cd apps/mac
python3 assemble.py       # regenerates Resources/index.html
./scripts/build.sh                # macOS Swift build

cd ..
bun test api/native-api-bridge.spec.mjs api/agent-runtime.spec.mjs \
  api/agent-runtime-saga.spec.mjs hermes-runtime.spec.mjs
```

Generated HTML must be regenerated through `assemble.py`, never hand-edited. The production source boundary disables Web Inspector; development inspection requires the explicit development build flag.

## Direct Developer ID distribution

Production distribution is direct Developer ID distribution, not the Mac App Store. It requires macOS 13+, Universal 2 artifacts, Hardened Runtime, Developer ID signing, notarization, stapling, checksums, immutable production HTTPS endpoint inputs, and a clean-account acceptance run. **App Sandbox is not a production requirement** for this direct-distribution model; release validation rejects unexpected sandbox/debug entitlements rather than requiring them.

### Developer ID dev handoff

This operator-only handoff runs on macOS with a Developer ID Application identity and local notarytool profile. It never places endpoint credentials in the bundle.

1. Register the explicit App ID `network.index.system6`, enable **Associated Domains enabled**, and create a **Developer ID provisioning profile** that authorizes exactly the owner Keychain group.
2. Build with all four required inputs. The prefix has a trailing period and must match the profile/Team application-identifier prefix:

```bash
cd apps/mac
INDEX_LINK_HOST=dev.index.network \
INDEX_APP_IDENTIFIER_PREFIX='TEAM123ABC.' \
CODESIGN_IDENTITY='Developer ID Application: <name> (<team-id>)' \
PROVISIONING_PROFILE='<path-to-downloaded-profile>' \
./scripts/build.sh
```

3. Verify `embedded.provisionprofile`, signature/entitlements, then notarize using a local keychain profile:

```bash
NOTARYTOOL_PROFILE='<local-keychain-profile>' ./scripts/notarize.sh
```

A runtime error such as `No matching profile found` means the profile does not authorize the launched app; do not treat prior signing/notarization checks as success. Verify that `https://dev.index.network/u/<id>/chat` stays in the browser while an allowed opportunity/profile link opens the signed app.

Record only redacted commands and pass/fail status in PR evidence; never IDs, credentials, certificate subjects, or profile names.
