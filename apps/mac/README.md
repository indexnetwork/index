# Index macOS Client

The native macOS application for Index — a React-based UI wrapped in a Swift WKWebView app with an Amiga Workbench 1.3 aesthetic.

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
HaloApp/                    # macOS app (Swift + WKWebView)
├── build.sh              # Build script
├── Sources/              # Swift source (app delegate, window management)
├── Resources/            # Built assets (outputs here)
├── src/
│   ├── halo-amiga.html  # Root HTML template
│   ├── halo-amiga/      # React components (.jsx files)
│   ├── fonts/           # Woff2 font files
│   └── vendor/          # Vendored React/Babel/ReactDOM
├── assemble.py          # Bundles everything into single HTML
└── Info.plist          # macOS app metadata

HaloApp-iOS/             # iOS app (same architecture)
api/                     # API client library
design_bundle/           # Design system reference files
```

## Building

### Standard Build

From the `HaloApp` directory:

```bash
cd HaloApp
./build.sh
```

This will:
1. Assemble `src/halo-amiga.html` and all JSX modules into a single `Resources/index.html`
2. Inline all React/Babel libraries and fonts (fully offline)
3. Compile Swift to a native binary
4. Package into `dist/halo.app`

The app will be in `dist/halo.app` — double-click to launch.

### Development: Hot-Reload Mode

For rapid iteration without rebuilding the Swift binary each time:

```bash
cd HaloApp
./dev.sh
```

This will:
- Watch `src/` for changes (JSX, HTML, CSS)
- Re-run `assemble.py` on each change to update `Resources/index.html`
- Automatically open the app (if not running) or trigger a reload

The app will hot-reload as you edit files — great for UI tweaking.

**To manually reload** during development, press **Cmd+R** (standard browser reload) in the app, or close and relaunch.

### Troubleshooting Build

**"AssertionError: no @font-face url() references found"**
- The CSS must reference fonts at `fonts/jetbrains-mono-latin-var.woff2` etc.
- Check `src/halo-amiga.html` for correct paths.

**Swift compilation fails**
- Ensure you have Xcode Command Line Tools: `xcode-select --install`
- Try `swiftc -version` to verify.

**"codesign failed"**
- Ad-hoc signing is skipped for local builds. The app will still run locally.

## Running

### From Build Output
```bash
open dist/halo.app
```

### Or directly from Finder
Navigate to `HaloApp/dist/halo.app` and double-click.

## Development Workflow

1. **Edit React components** in `HaloApp/src/halo-amiga/` (.jsx files)
2. **Edit styles** in `HaloApp/src/halo-amiga.html` (the `<style>` block)
3. **Run hot-reload** with `./dev.sh`
4. **See changes** as you save files

For structural changes (new components, imports), the hot-reload will automatically pick them up.

## Modifying the App

### Adding a New React Component

1. Create `HaloApp/src/halo-amiga/mycomponent.jsx`
2. Import in your parent component or app.jsx:
   ```jsx
   // Imported automatically by Babel at runtime
   const MyComponent = () => { /* ... */ }
   export default MyComponent
   ```
3. Save — `assemble.py` will inline it on next change (or on next build)

### Changing Fonts

Fonts must be WOFF2 format. Update the list in `assemble.py` and add the file to `src/fonts/`:

```python
VENDOR = {
    "url-to-font": "filename.woff2",
}
```

Then re-run the build to inline the new fonts.

### Customizing the Amiga Theme

Edit the CSS variables in `HaloApp/src/halo-amiga.html`:

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
- **Code signing:** Ad-hoc (local only) — not suitable for distribution

## Next Steps

- See `design_bundle/` for design system and component reference
- Check `api/` for the API client boundary
- Refer to `HaloApp/src/halo-amiga/` component files for example patterns
