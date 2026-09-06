# Index macOS Client

Index is a macOS 13+ WKWebView client with a native, credential-free request bridge. It is an optional owner-control surface: standalone Hermes connection does **not** require the Index app to be installed or running.

## Security model

The signed app stores one ordinary Better Auth API key in the Keychain. Raw credentials and authorization headers never enter browser JavaScript, WebKit storage, Application Support records, logs, callback URLs, or generated HTML.

The native `indexAPI` bridge accepts only the exact bundled main document and document generation. JavaScript supplies structured, allowlisted requests; Swift constructs the fixed API/MCP URLs, reads the owner credential natively, validates body/schema/resource bounds, and returns sanitized data only. It permits bounded REST, upload, and SSE operations (32 pending requests, 1 MiB ordinary request/response, 8 MiB decoded images, 64 KiB events, 256 events; 30-second ordinary and five-minute stream deadlines). It never accepts a browser-supplied URL, header, credential, or transport override.

## Owner sign-in

Login opens the web `/cli-auth` page (the same state-bound handshake the CLI uses) with a loopback callback on `http://127.0.0.1:<port>/callback`. The callback returns an ordinary 90-day API key plus its key ID; the app verifies the Keychain write/read-back before treating login as complete.

Logout quarantines bridge work, pauses/scrubs Hermes local activity, then deletes the Keychain item. It is local only: deleting a key server-side needs the owner's own browser session, so the key stays live until it is removed in Index web settings. A failed Keychain deletion retains the credential and never claims logout completed.

## Hermes runtime

The native app may show the same owner controls as the web, but it is not required for direct Hermes use. The Hermes plugin authenticates with an ordinary agent-bound API key supplied via the `INDEX_API_KEY` environment variable. The local runtime uses generation-fenced fallback and cron ownership markers: it pauses only the exact owned schedule and preserves unrelated Hermes state.

## Build and source checks

```bash
cd apps/mac
python3 assemble.py       # regenerates Resources/index.html
./scripts/build.sh                # macOS Swift build
```

Generated HTML must be regenerated through `assemble.py`, never hand-edited. The production source boundary disables Web Inspector; development inspection requires the explicit development build flag.

## Direct Developer ID distribution

Production distribution is direct Developer ID distribution, not the Mac App Store. It requires macOS 13+, Universal 2 artifacts, Hardened Runtime, Developer ID signing, notarization, stapling, checksums, immutable production HTTPS endpoint inputs, and a clean-account acceptance run. **App Sandbox is not a production requirement** for this direct-distribution model; release validation rejects unexpected sandbox/debug entitlements rather than requiring them.

### Development: Hot-Reload Mode

For rapid iteration without rebuilding the Swift binary each time:

```bash
cd apps/mac
./dev.sh
```

This will:
- Watch `src/` for changes (JSX, HTML, CSS)
- Re-run `assemble.py` on each change to update `Resources/index.html`
- Automatically open the app (if not running) or trigger a reload

The app will hot-reload as you edit files, great for UI tweaking.

`dev.sh` defaults `INDEX_DEVELOPMENT_BUILD=1`: the build enables the web
inspector and, because an ad-hoc build carries no provisioning-profile-authorized
Keychain access group, stores the owner credential in the login keychain so
sign-in works locally. Production (signed) builds are unaffected and still fail
closed without the authorized owner group. Override with
`INDEX_DEVELOPMENT_BUILD=0 ./dev.sh`.

**To manually reload** during development, press **Cmd+R** (standard browser reload) in the app, or close and relaunch.

### Troubleshooting Build

**"AssertionError: no @font-face url() references found"**
- The CSS must reference fonts at `fonts/jetbrains-mono-latin-var.woff2` etc.
- Check `src/index.html` for correct paths.

**Swift compilation fails**
- Ensure you have Xcode Command Line Tools: `xcode-select --install`
- Try `swiftc -version` to verify.

**"codesign failed"**
- Ad-hoc signing is skipped for local builds. The app will still run locally.

### Deep links

The app opens two URL families, and **all** routing lives in one pure function,
`parseDeepLink` in `api/deeplink.mjs`, inlined into the bundle as
`window.IndexApi.parseDeepLink`. The Swift shell
only delivers URLs — it raises the window and forwards the raw string to the
page as an `index-deeplink` `CustomEvent`, queuing anything that arrives before
the web view has finished loading (cold launch).

| URL | Opens |
| --- | --- |
| `https://index.network/o/<id>` · `index://o/<id>` | that opportunity's card |
| `https://index.network/u/<id>` · `index://u/<id>` | that person's profile |
| `https://index.network/c/<code>` · `index://c/<code>` | nothing — retired connect links get a one-line notice |
| `index://q/<question-id>` | the signal that owns that pending question |
| `index://chat/<conversation-id>` | that conversation's chat inside its signal |

The `q`/`chat` routes are minted only by the app's own desktop notifications
(no web page serves them), so they matter mostly as the toast tap target.

Query strings, fragments and trailing slashes are ignored; foreign hosts,
unknown paths and malformed URLs are ignored silently. Extra hosts (staging)
are a `hosts` argument, not a code change.

#### Known limitation: universal links need a real signature

The `https://` half only works in a **Developer ID-signed, notarized** build.
`build.sh` generates the `com.apple.developer.associated-domains` entitlement
for the selected `INDEX_LINK_HOST` and passes that generated plist to
`codesign`; `Index.entitlements` is not the signed build input.
macOS verifies the resulting signed-app entitlement (for the default profile,
`applinks:index.network`) against the host's `apple-app-site-association`,
which lists `<APPLE_TEAM_ID>.network.index.system6` — so the web host also needs
`APPLE_TEAM_ID` set. Inspect the built artifact with
`codesign -d --entitlements :- dist/Index.app`. An ad-hoc dev build has no team,
so macOS never hands it a universal link and `build.sh` says so.

The `index://` scheme (registered via `CFBundleURLTypes` in `Info.plist`) has no
such requirement and is the way to exercise deep links locally:

```bash
open "index://o/<opportunity-id>"
open "index://u/<user-id>"
open "index://c/<code>"            # expect the "no longer supported" notice
# only on a signed, notarized build:
open "https://index.network/o/<opportunity-id>"
```

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

4. Package the distributable disk image from the same verified app:

```bash
NOTARYTOOL_PROFILE='<local-keychain-profile>' ./scripts/dmg.sh
xcrun stapler validate dist/Index.dmg
```

`./scripts/dmg.sh` revalidates the signed, stapled bundle, lays out the branded disk image, notarizes it, and staples `dist/Index.dmg`. The DMG is the handoff artifact.

Record only redacted commands and pass/fail status in PR evidence; never IDs, credentials, certificate subjects, or profile names.
