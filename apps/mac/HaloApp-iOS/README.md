# index — pocket (iOS)

The mobile version of the `halo` / **index** prototype. It mirrors the macOS
`HaloApp` architecture exactly: a thin native **WKWebView** shell wrapping a
self-contained React/HTML bundle. Only the chrome and layout were reworked for a
phone — the data model and simulation logic are shared, so behavior matches the
desktop build.

## What changed for mobile

The desktop build is a Workbench desktop of draggable, side-by-side windows. On a
phone that becomes **stacked full-screen views + a bottom tab bar**, while keeping
the retro Amiga skin (pixel borders, bevels, IBM Plex, orange/blue palette):

| Desktop (`HaloApp`)                     | Mobile (`HaloApp-iOS`)                                  |
|-----------------------------------------|--------------------------------------------------------|
| Top menubar + clock                     | Thin status strip (`MobileTopBar`), under the notch    |
| Landing: two windows side by side       | One scrolling column                                   |
| Intents: shelf + hover preview pane     | List of signals → tap opens a full-screen detail sheet |
| Onboarding: chat + "field" window       | Single column; field folds to a compact counts strip   |
| Main: 3 windows (signals / radar / chat)| 3 bottom tabs: **signals · radar · messages**          |
| Chat / profile / summary = 3rd window   | Full-screen **sheets** that slide up over the tabs     |

Safe areas are handled in CSS via `env(safe-area-inset-*)`, so the blue desktop
runs under the notch and home indicator while the app chrome stays clear of them.

## Layout

```
HaloApp-iOS/
  Sources/main.swift        UIKit AppDelegate + full-screen WKWebView (the iOS app)
  Info.plist                iOS bundle metadata (portrait, storyboard-free launch)
  assemble.py               inlines libs + JSX into one offline Resources/index.html
  build.sh                  assemble + build for the iOS Simulator (needs Xcode)
  Resources/index.html      the assembled, self-contained bundle (generated)
  src/
    halo-mobile.html        the shell: viewport, safe-area CSS, Amiga palette
    halo-mobile/
      data.jsx              shared data model (copied verbatim from desktop)
      logic.jsx             shared simulation logic (clarifier effects, chats, …)
      primitives.jsx        Amiga widgets + phone chrome (top bar, nav, sheets)
      landing.jsx  intents.jsx  onboarding.jsx  mainview.jsx  app.jsx
    vendor/                 pinned React / ReactDOM / Babel (offline)
  preview/                  macOS-only preview shell (see below)
```

## Build & run

The iOS wrapper needs a **full Xcode** install (the Command Line Tools alone ship
only the macOS SDK). With Xcode present:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer   # once
open -a Simulator                                                  # boot a phone
./build.sh                                                         # assemble + build + install + launch
```

- `./build.sh` builds for the **iOS Simulator** (arm64), installs onto the booted
  simulator, and launches it.
- `./build.sh device` builds an unsigned **device** binary — sign it with your own
  identity / provisioning profile to run on hardware.
- `./build.sh assemble` just regenerates `Resources/index.html`.

## Preview without Xcode

To see the mobile UI on a machine with only the Command Line Tools, build the
macOS **preview shell** — a WKWebView fixed at iPhone dimensions (393×852) loading
the same bundle:

```sh
./preview/build-preview.sh && open preview/dist/index-preview.app
```

This is for visual checks only; the shipping app is `Sources/main.swift`.

## Editing

Edit the files under `src/halo-mobile/` (they're plain JSX, transpiled in-page by
Babel — no build step for the web layer). Run `./build.sh assemble` (or any build)
to re-inline them into `Resources/index.html`.
