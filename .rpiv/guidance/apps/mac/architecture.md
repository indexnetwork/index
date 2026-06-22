# Architecture Guidance: apps/mac

Native Apple client prototype subtree synced to `indexnetwork/mac-client`. It contains thin Swift WKWebView shells around self-contained React/HTML bundles for desktop and mobile experiments.

# Layout

```
apps/mac/
├── HaloApp/          # macOS WKWebView app bundle source
├── HaloApp-iOS/      # iOS wrapper plus macOS preview shell
└── design_bundle/    # design artifacts, screenshots, standalone prototypes
```

# Commands

| Area | Command | Purpose |
|---|---|---|
| macOS shell | `cd apps/mac/HaloApp && ./build.sh` | assemble HTML and build the macOS `.app` |
| iOS shell | `cd apps/mac/HaloApp-iOS && ./build.sh assemble` | regenerate mobile `Resources/index.html` without Xcode |
| iOS simulator | `cd apps/mac/HaloApp-iOS && ./build.sh` | build/install on booted simulator; requires full Xcode |
| mobile preview | `cd apps/mac/HaloApp-iOS && ./preview/build-preview.sh` | build macOS preview app for the mobile UI |

# Patterns

- Edit JSX/HTML under each app's `src/` tree, then run the local `assemble.py` / `build.sh` to inline vendor scripts into `Resources/index.html`.
- The native Swift layer should stay thin: app/window lifecycle plus WKWebView loading. Product logic belongs in the bundled web layer or shared protocol/API surfaces.
- Treat this subtree as a mirrored app boundary: monorepo changes under `apps/mac/` sync to `indexnetwork/mac-client` via `.github/workflows/sync-subtrees.yml`.

<important if="you are changing generated app bundles">
- The current upstream repo tracks built `.app` bundles under `dist/`. Avoid deleting or regenerating those artifacts casually; doing so will sync the change back to `indexnetwork/mac-client`.
</important>
