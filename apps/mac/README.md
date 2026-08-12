# Index macOS Client

The native macOS application for Index, a React-based UI wrapped in a Swift WKWebView app with an Amiga Workbench 1.3 aesthetic.

## Architecture

- **Frontend:** React 18 + JSX compiled with Babel, bundled into a single offline-capable HTML file
- **Native wrapper:** Swift + WKWebView (WebKit) for native window chrome and file handling
- **Design:** Amiga Workbench 1.3 theme with IBM Plex Sans and JetBrains Mono fonts
- **Build:** Python script to inline all dependencies (React, Babel, fonts, JSX modules) for fully offline operation

### Credential-bearing WebView boundary

The native shell admits navigation and bridge messages only for the exact standardized bundled `index.html` main document and current document generation. User-activated `http`/`https` links open through `NSWorkspace`; replacement, subframe, popup, redirect, `javascript:`, and `data:` navigations are cancelled. Model markdown is escaped and reduced to a strict inert tag allowlist before rendering.

Hermes saga recovery is stored atomically under the app's Application Support directory through the request-correlated native bridge, not `file://` localStorage. Logout persists owner-pinned disconnect/revoke evidence, attempts the owner runtime revoke path, and independently proves immutable-ID schedule quarantine plus removal of all app-owned Hermes env wiring before native owner-credential revocation. Server uncertainty remains as strict same-owner recovery evidence while the dedicated local Hermes key is still scrubbed.

## Prerequisites

- **macOS 11.0+**
- **Swift 5.5+** (included with Xcode Command Line Tools)
- **Python 3.6+**
- **Node.js 18+** (optional, for design system utilities)

Install Xcode Command Line Tools if needed:
```bash
xcode-select --install
```

## Directory Structure

```
apps/mac/                    # macOS app (Swift + WKWebView)
├── build.sh, dev.sh, assemble.py   # thin wrappers → scripts/
├── scripts/               # build, assemble, notarize, dmg, specs
├── Sources/               # Swift (AppDelegate, AppConfig, auth, Hermes, …)
├── Resources/             # AppIcon.icns, Assets.car; index.html is generated
├── src/
│   ├── index.html         # Root HTML template
│   ├── styles/amiga.css   # Workbench theme (inlined at build)
│   ├── ui/                # React screens + shared primitives
│   ├── fonts/             # Woff2 font files
│   └── vendor/            # Vendored React/Babel/ReactDOM
├── api/                   # API client library (Node-testable boundary)
└── Info.plist             # macOS app metadata
```

## Building

### Standard Build

From the `apps/mac` directory:

```bash
cd apps/mac
./build.sh
```

This will:
1. Assemble `src/index.html` and all JSX modules into a single `Resources/index.html`
2. Inline all React/Babel libraries and fonts (fully offline)
3. Compile Swift to a native binary
4. Package into `dist/Index.app`

The app will be in `dist/Index.app`, double-click to launch.

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

## Deep links

The app opens two URL families, and **all** routing lives in one pure function,
`parseDeepLink` in `api/deeplink.mjs` (unit tested in `api/deeplink.spec.mjs`,
inlined into the bundle as `window.IndexApi.parseDeepLink`). The Swift shell
only delivers URLs — it raises the window and forwards the raw string to the
page as an `index-deeplink` `CustomEvent`, queuing anything that arrives before
the web view has finished loading (cold launch).

| URL | Opens |
| --- | --- |
| `https://index.network/o/<id>` · `index://o/<id>` | that opportunity's card |
| `https://index.network/u/<id>` · `index://u/<id>` | that person's profile |
| `https://index.network/c/<code>` · `index://c/<code>` | nothing — retired connect links get a one-line notice |

Query strings, fragments and trailing slashes are ignored; foreign hosts,
unknown paths and malformed URLs are ignored silently. Extra hosts (staging)
are a `hosts` argument, not a code change.

### Known limitation: universal links need a real signature

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

This is an operator-only handoff for the `dev.index.network` universal-link
profile. It must run on **macOS** with an operator-owned Developer ID Application
identity and local notarytool keychain profile. Any existing API or app URL
overrides must name the dev environment; do not put endpoint credentials in the
bundle or substitute production URLs.

Before building, confirm the dev host serves
`/.well-known/apple-app-site-association` directly (HTTP 200, JSON, no redirect)
for the Developer ID team's `network.index.system6` app ID. Its components must
exclude `/u/*/?*` before the broader `/u/*` entry so only a non-empty deeper
profile segment (such as `chat`) remains browser-only while `/u/<id>` opens the app.
The signed artifact must contain exactly `applinks:dev.index.network` in its
associated-domains entitlement.

Prepare and run the handoff in this order:

1. In Apple Developer Certificates, Identifiers & Profiles, register or select
   the explicit App ID `network.index.system6`.
2. Edit that App ID, enable Associated Domains, confirm **Associated Domains enabled**
   is shown, and save it.
3. Create a **Distribution → Developer ID** provisioning profile for that App
   ID, selecting the matching Developer ID Application certificate.
4. Download the Developer ID provisioning profile to the operator machine. Do
   not commit it or record its local name or path in PR evidence.
5. From the repository root, build with all three required inputs:

   ```bash
   cd apps/mac
   INDEX_LINK_HOST=dev.index.network \
   CODESIGN_IDENTITY='Developer ID Application: <name> (<team-id>)' \
   PROVISIONING_PROFILE='<path-to-downloaded-profile>' \
   ./build.sh
   ```

6. Verify the embedded profile and signed entitlements, then notarize. The
   notarization script revalidates the signed bundle and profile before
   submission, waits for notary acceptance, staples and validates the ticket,
   rechecks the signature, and runs the Gatekeeper assessment. Launch only
   after every command succeeds:

   ```bash
   test -f dist/Index.app/Contents/embedded.provisionprofile
   codesign --verify --deep --strict --verbose=2 dist/Index.app
   codesign -d --entitlements :- dist/Index.app
   NOTARYTOOL_PROFILE='<local-keychain-profile>' ./notarize.sh
   open dist/Index.app
   ```

7. Treat runtime launch as a separate required check. `codesign`, notary
   acceptance, stapling, and `spctl` can all pass while AMFI still rejects the
   restricted Associated Domains entitlement with `No matching profile found`.
   That failure means the embedded profile does not authorize the launched app;
   do not treat the earlier checks as a successful handoff.

Supply real dev IDs and local values only at execution time. After the runtime
launch, exercise this seven-row matrix; stop and report a failed row rather than
falling back to a production host.

| URL / condition | Expected outcome |
| --- | --- |
| `https://dev.index.network/o/<id>` with the notarized app installed | opens that opportunity card in the app |
| `https://dev.index.network/u/<id>` with the notarized app installed | opens that user's profile in the app |
| `https://dev.index.network/u/<id>/chat` | stays in the browser; it must not open the app |
| `index://o/<id>` | opens that opportunity card in the app |
| `index://c/<code>` | opens the retired-connect one-line notice |
| Quit the app, then open `index://u/<id>` | cold-launches the app to that user's profile |
| `https://dev.index.network/u/<id>` in a separate browser profile with no app installed | remains on the dev landing page in the browser |

PR evidence must be **redacted**: record only commands and pass/fail statuses,
never real IDs, API keys, a certificate subject, or a notary profile name.
Production HTTPS rows are deferred until the web release; this dev handoff does
not validate or replace them.

8. Package the distributable disk image from the same verified app:

   ```bash
   NOTARYTOOL_PROFILE='<local-keychain-profile>' ./dmg.sh
   xcrun stapler validate dist/Index.dmg
   ```

   `dmg.sh` revalidates the signed, stapled bundle, lays out a branded window
   (Workbench-window background generated by `dmg-background.swift`),
   compresses to UDZO, then notarizes and staples `dist/Index.dmg` itself. The
   DMG is the handoff artifact; the same redaction rules apply to its evidence.

## Running

### From Build Output
```bash
open dist/Index.app
```

### Or directly from Finder
Navigate to `dist/Index.app` and double-click.

## Development Workflow

1. **Edit React components** in `src/ui/` (.jsx files)
2. **Edit styles** in `src/index.html` (the `<style>` block)
3. **Run hot-reload** with `./dev.sh`
4. **See changes** as you save files

For structural changes (new components, imports), the hot-reload will automatically pick them up.

## Modifying the App

### Adding a New React Component

1. Create `src/ui/mycomponent.jsx`
2. Import in your parent component or app.jsx:
   ```jsx
   // Imported automatically by Babel at runtime
   const MyComponent = () => { /* ... */ }
   export default MyComponent
   ```
3. Save, `assemble.py` will inline it on next change (or on next build)

### Changing Fonts

Fonts must be WOFF2 format. Update the list in `assemble.py` and add the file to `src/fonts/`:

```python
VENDOR = {
    "url-to-font": "filename.woff2",
}
```

Then re-run the build to inline the new fonts.

### Customizing the Amiga Theme

Edit the CSS variables in `src/index.html`:

```css
:root {
    --amiga-bg: #0055AA;        /* desktop blue */
    --amiga-fg: #000000;        /* black ink */
    --amiga-paper: #FFFFFF;     /* window white */
    --amiga-accent: #FF8A00;    /* title bar orange */
}
```

## Testing

The app runs fully offline with no backend dependency. To test networking:

- Edit `api/client.mjs` to point to your API, then rebuild with `./build.sh`

## Environment

- **Offline-first:** All assets are bundled; the app works without network
- **macOS native window chrome:** Custom WKWebView wrapper for native window management and file dialogs
- **Dark mode:** Not explicitly supported; uses Amiga palette throughout
- **Code signing:** Ad-hoc (local only), not suitable for distribution

## Personal Agent runtime selector

The macOS Personal Agent has exactly two runtime choices: **Index · system
default** and **Hermes · on this Mac**. Runtime selection changes the preferred
negotiation executor only. The visible Personal Agent name/avatar, owner-scoped
memory, policy, consultation surface, and history do not move to an executor
record or reset during setup, fallback, selection, or disconnect.

Hermes setup is a durable saga across the owner-control API and the native shell.
The native installation record supplies a stable `installationId`; every prepare
uses a fresh `setupAttemptId`. The sequence is prepare → native
`configureDisabled` → activate the matching server generation → native `enable`
→ bounded wait for server-observed active health → native `confirmHealthy`.
Index covers negotiation work throughout activation and whenever server health is
stale or never seen. The React UI consumes the pure mapper's `index`,
`connecting`, `active`, `unavailable`, and `needs-attention` states and performs
no timestamp freshness math.

The bootstrap key returned by prepare is passed to exactly one
`configureDisabled` bridge request. It is never placed in React state,
`localStorage`, logs, or callback results. JavaScript bridge requests are matched
by `requestId`. A credential-free Swift `started` callback emitted after dequeue
starts a command-specific execution timeout; queue wait has its own generous hard
bound. Swift admits only the exact bundled main-frame document and sends progress
or final callbacks only to the same trusted document generation.

Every post-prepare failure calls exact generation rollback first. Local cleanup
runs after `rolledBack:true`, or after a lost/false rollback response only when an
owner-pinned authoritative binding read proves that exact installation generation
absent. `installation:null` is never treated as global absence across owners; read
uncertainty preserves the journal and local generation. A selection accepts
native configure, enable, and health-confirmation results only
when their stage and complete local state match the requested installation,
executor, and setup generation; successful stale-generation no-ops are rejected.
Native inspection persists and reports setup journal stages and pauses an owned
enabled schedule before JavaScript reconciles them. The authenticated runtime
provider is mounted by the default app root, so this inspection and exact
rollback/cleanup run on every relaunch without opening the Personal Agent screen,
and an old failed attempt cannot undo a newer active generation. Every JS/native
recovery journal carries the non-secret authenticated app-user `ownerId`. A
journal belonging to another signed-in owner causes local inspection and
matching-generation pause only: no server rollback/read runs with the new owner,
the journal remains for the original owner's return, and the UI reports a
sanitized needs-attention state.

**Select Index** removes Hermes pickup authority and pauses its schedule but
keeps the installation, key, env, and plugin connected for quick reselection.
**Disconnect Hermes** selects Index and revokes the installation server-side
first, then removes the exact owned cron job, six Index env values, negotiator
plugin/dashboard wiring, and local generation. Partial cleanup remains journaled
and retryable.

### Cross-boundary acceptance matrix

`api/task-5-acceptance.spec.ts` is the focused provider-free production-composition
check. It composes the real `AgentRuntimeService`, runtime transaction and API-key
authentication harnesses, selected-poller authorization, `AgentDispatcherImpl`,
consultation eligibility policy, and the Mac selection saga. It proves exact
selection/key/poller admission, dispatcher parking, consultation eligibility,
Index deauthorization, and key revocation through those composed boundaries. It
does **not** claim to execute Swift, Hermes CLI/filesystem work, BullMQ workers,
or the PostgreSQL Questioner continuation transaction.

Focused relaunch/owner/journal/bridge behavior runs in
`api/agent-runtime-saga.spec.mjs` and `api/agent-runtime.spec.mjs`; native queue,
filesystem, cron, and journal contracts run separately in
`hermes-runtime.spec.mjs` (with real Swift/macOS integration remaining a
macOS CI obligation). The guarded PostgreSQL authority for exact consultation
races and successor creation is
`services/api/tests/negotiation-polling-consultation.e2e.isolated.ts`; run it only
with a proven disposable `DATABASE_URL` and `TEST_DATABASE_SAFE=1`.

## Credential storage, known dev-only compromise

> **Release scope:** This branch targets dev/private testing only. Production
> distribution remains blocked until the owner credential is migrated to
> Keychain and the plaintext credential file **and directory** are removed,
> hardened runtime and App Sandbox are restored, the bundle is signed and
> notarized, and the credential TTL/revocation checklist below is verified.

The API key minted by `index login` is written as **plain JSON** to
`~/Library/Application Support/network.index.system6/credential.json`
(`0600`, in a `0700` directory). It is **not** in the Keychain.

This is deliberate and it is a downgrade. The dev build is signed ad-hoc, so its
code identity is its exact binary hash; every rebuild looked like a different
application to the login Keychain's per-binary ACL, which re-prompted for the
login password on every launch. A file has no ACL, so no prompt. The cost is a
cleartext key on disk, readable by anything running as that user, and swept up
by Time Machine or any backup pointed at Application Support.

**Do not ship a build that touches real user credentials until every box is
ticked.** The authoritative copy of this list lives beside the code, in the
`CredentialStore` block in `Sources/CredentialStore.swift`:

- [ ] Sign with a Developer ID Application certificate. A real identity gives a
      stable code requirement, which is the actual fix for the prompt. Ad-hoc
      signing was the root cause, not the Keychain.
- [ ] Restore Keychain storage (revert `CredentialStore` to the `SecItem`
      generic password in git history, keeping `kSecAttrAccessibleAfterFirstUnlock`)
- [ ] Prefer the data-protection keychain (`kSecUseDataProtectionKeychain` plus a
      keychain-access-group entitlement) so access is governed by entitlement
      rather than per-binary ACL
- [ ] Enable the hardened runtime and App Sandbox; notarize the bundle
- [ ] Add an upgrade migration: read the file once, write it to the Keychain,
      then delete the file **and** its directory, otherwise a cleartext key is
      stranded on every machine that ran a dev build
- [ ] Confirm the key never reaches `localStorage`, a WKWebView data store, or a
      log line (today it is injected into the page in memory only)
- [ ] Give the minted credential a server-side TTL and re-verify that logout
      still revokes it

## Next Steps

- Check `api/` for the API client boundary
- Refer to `src/ui/` component files for example patterns
