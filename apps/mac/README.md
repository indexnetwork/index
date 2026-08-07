# Index macOS Client

The native macOS application for Index, a React-based UI wrapped in a Swift WKWebView app with an Amiga Workbench 1.3 aesthetic.

## Architecture

- **Frontend:** React 18 + JSX compiled with Babel, bundled into a single offline-capable HTML file
- **Native wrapper:** Swift + WKWebView (WebKit) for native window chrome and file handling
- **Design:** Amiga Workbench 1.3 theme with IBM Plex Sans and JetBrains Mono fonts
- **Build:** Python script to inline all dependencies (React, Babel, fonts, JSX modules) for fully offline operation

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
IndexApp/                    # macOS app (Swift + WKWebView)
├── build.sh              # Build script
├── Sources/              # Swift source (app delegate, window management)
├── Resources/            # Built assets (outputs here)
├── src/
│   ├── index-amiga.html  # Root HTML template
│   ├── index-amiga/      # React components (.jsx files)
│   ├── fonts/           # Woff2 font files
│   └── vendor/          # Vendored React/Babel/ReactDOM
├── assemble.py          # Bundles everything into single HTML
└── Info.plist          # macOS app metadata

IndexApp-iOS/             # iOS app (same architecture)
api/                     # API client library
design_bundle/           # Design system reference files
```

## Building

### Standard Build

From the `IndexApp` directory:

```bash
cd IndexApp
./build.sh
```

This will:
1. Assemble `src/index-amiga.html` and all JSX modules into a single `Resources/index.html`
2. Inline all React/Babel libraries and fonts (fully offline)
3. Compile Swift to a native binary
4. Package into `dist/index.app`

The app will be in `dist/index.app`, double-click to launch.

### Development: Hot-Reload Mode

For rapid iteration without rebuilding the Swift binary each time:

```bash
cd IndexApp
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
- Check `src/index-amiga.html` for correct paths.

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
`codesign`; `IndexApp/IndexApp.entitlements` is not the signed build input.
macOS verifies the resulting signed-app entitlement (for the default profile,
`applinks:index.network`) against the host's `apple-app-site-association`,
which lists `<APPLE_TEAM_ID>.network.index.system6` — so the web host also needs
`APPLE_TEAM_ID` set. Inspect the built artifact with
`codesign -d --entitlements :- dist/index.app`. An ad-hoc dev build has no team,
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
   cd apps/mac/IndexApp
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
   test -f dist/index.app/Contents/embedded.provisionprofile
   codesign --verify --deep --strict --verbose=2 dist/index.app
   codesign -d --entitlements :- dist/index.app
   NOTARYTOOL_PROFILE='<local-keychain-profile>' ./notarize.sh
   open dist/index.app
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

## Running

### From Build Output
```bash
open dist/index.app
```

### Or directly from Finder
Navigate to `IndexApp/dist/index.app` and double-click.

## Development Workflow

1. **Edit React components** in `IndexApp/src/index-amiga/` (.jsx files)
2. **Edit styles** in `IndexApp/src/index-amiga.html` (the `<style>` block)
3. **Run hot-reload** with `./dev.sh`
4. **See changes** as you save files

For structural changes (new components, imports), the hot-reload will automatically pick them up.

## Modifying the App

### Adding a New React Component

1. Create `IndexApp/src/index-amiga/mycomponent.jsx`
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

Edit the CSS variables in `IndexApp/src/index-amiga.html`:

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

- Edit `api/client.mjs` to point to your API
- Rebuild with `./build.sh`

## Environment

- **Offline-first:** All assets are bundled; the app works without network
- **macOS native window chrome:** Custom WKWebView wrapper for native window management and file dialogs
- **Dark mode:** Not explicitly supported; uses Amiga palette throughout
- **Code signing:** Ad-hoc (local only), not suitable for distribution

## Credential storage, known dev-only compromise

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
`CredentialStore` block in `IndexApp/Sources/main.swift`:

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

- See `design_bundle/` for design system and component reference
- Check `api/` for the API client boundary
- Refer to `IndexApp/src/index-amiga/` component files for example patterns
