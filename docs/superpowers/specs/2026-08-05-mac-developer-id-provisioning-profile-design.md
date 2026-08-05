# macOS Developer ID provisioning-profile design

**Date:** 2026-08-05
**Issue:** IND-616
**Pull request:** #1333

## Context

PR #1333 added a strict Developer ID signing and notarization path for the macOS app's universal-link handoff. Operator acceptance produced a Developer ID-signed bundle with hardened runtime and the expected `com.apple.developer.associated-domains` entitlement. Apple accepted the notarization submission, stapling succeeded, `codesign` passed, and Gatekeeper accepted the bundle.

The bundle still could not launch. AMFI rejected it with `No matching profile found` because Associated Domains is a restricted entitlement and the app contained no eligible `embedded.provisionprofile`. Static signing and notarization checks do not prove that restricted entitlements are authorized at process launch.

## Goals

- Require an operator-supplied Developer ID provisioning profile for every Developer ID build.
- Validate the profile before signing and before notarization upload.
- Embed the original profile in the app bundle.
- Fail with actionable, redacted errors for missing or incompatible profiles.
- Preserve the existing ad-hoc local-development build.
- Complete signed, notarized runtime and deep-link acceptance with redacted evidence.

## Non-goals

- Do not commit a provisioning profile, certificate identity, team identifier, notary profile name, API credential, or real test object identifier.
- Do not auto-discover profiles from the operator's machine.
- Do not automate UI-level routing assertions or process lifecycle cleanup.
- Do not change the AASA path set, web fallback routing, app deep-link route table, or authentication behavior.
- Do not add production-host acceptance before the production web release.

## Operator interface

A Developer ID build supplies three explicit inputs:

```bash
INDEX_LINK_HOST=dev.index.network \
CODESIGN_IDENTITY='Developer ID Application: <name> (<team-id>)' \
PROVISIONING_PROFILE='/path/to/profile.provisionprofile' \
./build.sh
```

`PROVISIONING_PROFILE` is required only when `CODESIGN_IDENTITY` is set. The ad-hoc path embeds neither the profile nor the restricted Associated Domains entitlement.

## Components

### `provisioning-profile.sh`

Add a focused shell helper beside `link-host.sh`. It owns CMS decoding, decoded-plist validation, and embedding. It exposes:

- a production mode that decodes an operator-supplied profile with `security cms -D`, validates it, and copies the original CMS profile to `Contents/embedded.provisionprofile`;
- a read-only embedded-profile mode used by notarization preflight;
- a decoded-plist validation mode so deterministic tests exercise the same validation logic without requiring Apple-signed fixture profiles.

The helper receives the expected bundle identifier, selected link host, and Developer ID identity. It derives the signing team from the matching certificate in the keychain rather than trusting a separately supplied team value.

### `build.sh`

For a Developer ID build:

1. Resolve `INDEX_LINK_HOST` and generate the signed entitlement.
2. Require `PROVISIONING_PROFILE`.
3. Invoke the helper to decode, validate, and embed the profile.
4. Sign the completed bundle with hardened runtime and the generated entitlement.
5. Preserve the current strict no-fallback behavior.

The ad-hoc branch remains unchanged.

### `notarize.sh`

Before creating or uploading the archive, revalidate the app's embedded profile against the signed app's bundle identifier, team, and Associated Domains entitlement. Refuse the upload when the profile is absent, invalid, expired, or incompatible. The existing submit, wait, staple, validate, `codesign`, and `spctl` sequence remains unchanged.

## Validation contract

The helper must reject the profile unless all of the following hold:

1. The CMS payload decodes successfully.
2. `ExpirationDate` is later than the current time.
3. The profile's team identifier matches the selected Developer ID certificate.
4. The profile application identifier equals `<team>.network.index.system6`.
5. The profile contains `com.apple.developer.associated-domains` authorization.
6. That authorization covers `applinks:<selected-host>`, either explicitly or through Apple's wildcard representation.
7. Before notarization, the signed bundle entitlement contains exactly `applinks:<selected-host>` and the embedded profile still authorizes it.

Validation errors name the failed property and path but never print raw profile contents, certificate subjects, team identifiers, or credentials. Temporary decoded plists are removed with a trap.

## Routing safety

This fix authorizes an existing OS-owned routing boundary; it does not introduce a new redirect or infer a destination from stored reachability. The AASA components, unauthenticated landing pages, app parser, and `index://c/<code>` tombstone remain unchanged. macOS continues to choose app versus browser from the clicker's installed-app context.

## Testing

Use red-green-refactor against the helper and script contracts.

Add failing tests first for:

- Developer ID build missing `PROVISIONING_PROFILE`;
- valid exact-host authorization;
- valid wildcard authorization;
- expired profile;
- wrong team;
- wrong application identifier;
- missing Associated Domains entitlement;
- Associated Domains entitlement that does not cover the selected host;
- notarization preflight refusing an app without an eligible embedded profile.

Run the existing Mac deep-link, link-host, notarization, shell-syntax, and lint checks after the new tests pass.

## Operator profile creation

The Apple Developer team must have an explicit App ID for `network.index.system6` with Associated Domains enabled. An authorized operator creates a Developer ID distribution provisioning profile for that App ID using the same Developer ID Application certificate used to sign the bundle, downloads it locally, and supplies its path through `PROVISIONING_PROFILE`.

## Manual acceptance

After automated checks pass:

1. Rebuild with the matching Developer ID certificate and provisioning profile.
2. Submit to notarization, wait for acceptance, staple, and validate.
3. Confirm strict `codesign` verification and Gatekeeper acceptance.
4. Launch the exact notarized bundle and confirm AMFI permits execution.
5. Exercise the documented seven-row dev handoff matrix:
   - installed-app HTTPS opportunity route;
   - installed-app HTTPS profile route;
   - deeper profile chat route stays in browser;
   - `index://` opportunity route;
   - retired `index://c` notice;
   - cold-launch `index://` profile delivery;
   - no-app browser fallback.

PR evidence records commands and pass/fail status only. It excludes real object identifiers, API keys, certificate subjects, team identifiers, and notary profile names.
