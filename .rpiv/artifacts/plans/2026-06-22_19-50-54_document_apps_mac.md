---
date: 2026-06-22T19:50:54+0300
author: Yanek Yuk
commit: 2f13f40814
branch: dev
repository: index
topic: document apps/mac
tags:
  - documentation
  - apps-mac
  - apple-client
status: ready
parent: null
phase_count: 2
phases:
  - { n: 1, title: Desktop app README }
  - { n: 2, title: Subtree README }
unresolved_phase_count: 0
last_updated: 2026-06-22T19:50:54+0300
last_updated_by: Yanek Yuk
---

# apps/mac Documentation Implementation Plan

## Overview

Document the native Apple client prototype under `apps/mac/` with concise Markdown READMEs rather than changing runtime code. The plan adds a missing desktop `HaloApp` README first, then a top-level `apps/mac` README that orients contributors across the desktop app, iOS app, preview shell, design bundle, generated artifacts, and subtree sync boundary.

## Requirements

- Add contributor-facing documentation for `apps/mac/`.
- Follow the concise app README style used elsewhere in the monorepo.
- Preserve the existing iOS README as the detailed mobile documentation source.
- Document editable source-of-truth files versus generated/assembled outputs.
- Document local build/preview commands and Xcode requirements without adding new scripts.
- Document that `apps/mac/` syncs to `indexnetwork/mac-client` as a subtree.

## Current State Analysis

`apps/mac/` is a native Apple client prototype subtree, but it has no top-level README and the desktop app has no local README. The iOS app already has a detailed README, and root/guidance docs mention the subtree at a high level.

### Key Discoveries

- `apps/web/README.md:1-39` provides the concise app README pattern: purpose, upward links, setup/structure/scripts.
- `apps/mac/HaloApp-iOS/README.md:1-80` provides the nearest Apple/WKWebView documentation pattern: architecture, layout, build modes, preview, and editing source-of-truth.
- `apps/mac/HaloApp/build.sh:11-29` assembles `Resources/index.html`, compiles Swift with Cocoa/WebKit, copies resources, and ad-hoc signs the generated `.app`.
- `apps/mac/HaloApp/assemble.py:1-8` states the desktop editable source-of-truth is `src/halo-amiga.html` plus `src/halo-amiga/*.jsx`, inlined into an offline bundle.
- `apps/mac/HaloApp/Sources/main.swift:73-80` loads bundled `index.html` from the app bundle via WKWebView.
- `apps/mac/HaloApp-iOS/preview/build-preview.sh:1-18` provides a macOS preview shell for the mobile UI without the iOS SDK.
- `.github/workflows/sync-subtrees.yml:50-51` maps `apps/mac` to `indexnetwork/mac-client`; `.github/workflows/sync-subtrees.yml:138-170` splits and pushes that subtree.
- `.rpiv/guidance/apps/mac/architecture.md:29-30` warns that built `.app` bundles under `dist/` are currently tracked upstream and should not be deleted or regenerated casually.

## Desired End State

Contributor entry points become straightforward:

```bash
# Desktop prototype
cd apps/mac/HaloApp
./build.sh
open dist/halo.app

# Mobile bundle and preview
cd apps/mac/HaloApp-iOS
./build.sh assemble
./preview/build-preview.sh && open preview/dist/index-preview.app
```

Documentation discovery also becomes clear:

```text
apps/mac/README.md              # subtree overview, commands, sync policy, editing cautions
apps/mac/HaloApp/README.md      # desktop-specific build/editing details
apps/mac/HaloApp-iOS/README.md  # existing mobile-specific build/editing details
```

## What We're NOT Doing

- No Swift, JSX, HTML, Python, shell, or plist source changes.
- No rewrite of `apps/mac/HaloApp-iOS/README.md`; it remains the detailed mobile reference.
- No root README, CLAUDE.md, workflow, or `.rpiv/guidance` updates.
- No generated bundle or `.app` regeneration.
- No new test framework or build script for `apps/mac`.

## Decisions

### README style follows existing app documentation

Ambiguity: whether to write a long architecture/design document or concise contributor READMEs.

Explored:
- Concise README style: `apps/web/README.md:1-39` and `apps/mac/HaloApp-iOS/README.md:27-80` show purpose, structure, commands, and editing guidance with minimal duplication.
- Broader architecture docs: `README.md:216-223` and `.rpiv/guidance/apps/mac/architecture.md:1-31` already summarize the repo/subtree, so duplicating system-wide architecture in new files would add drift risk.

Decision: use concise Markdown READMEs focused on local orientation, commands, source-of-truth, generated artifacts, and links to root docs.

### Scope is top-level plus desktop README

Ambiguity: whether to add only `apps/mac/README.md`, add top-level plus desktop docs, or do a full docs pass including the existing iOS README.

Explored:
- Top-level only would leave desktop-specific details buried in shell/Python comments (`apps/mac/HaloApp/build.sh:1-30`, `apps/mac/HaloApp/assemble.py:1-8`).
- Full docs pass would touch `apps/mac/HaloApp-iOS/README.md:1-80`, but that file already documents mobile architecture/build/editing well.

Decision: create `apps/mac/HaloApp/README.md` and `apps/mac/README.md`; leave `apps/mac/HaloApp-iOS/README.md` unchanged.

### Generated artifact guidance is explicit

Ambiguity: whether docs should mention generated/tracked artifacts or only local commands.

Explored:
- Assemblers write generated offline HTML bundles (`apps/mac/HaloApp/assemble.py:58-60`, `apps/mac/HaloApp-iOS/assemble.py:58-60`).
- The mac guidance warns tracked `.app` bundles under `dist/` should not be deleted/regenerated casually (`.rpiv/guidance/apps/mac/architecture.md:29-30`).

Decision: both READMEs call out editable source files, generated `Resources/index.html`, and the `dist/` caution.

## Phase 1: Desktop app README

### Overview

Add the missing desktop-specific README; foundation phase for the top-level README because the subtree overview can link to it. Depends on no prior phases.

### Changes Required:

#### 1. apps/mac/HaloApp/README.md

**File**: apps/mac/HaloApp/README.md
**Changes**: NEW — desktop macOS WKWebView app README documenting layout, build, editing source-of-truth, generated artifacts, and native shell responsibilities.

````markdown
# halo — Workbench (macOS)

Desktop prototype for Index Network's `halo` / **index** client. It is a thin native **macOS WKWebView** shell around an assembled React/HTML bundle with vendored scripts and JSX inlined: Swift owns the window, app menu, and bundled-file loading; the product UI and prototype data live in the editable web sources under `src/`.

For the mobile counterpart, see [`../HaloApp-iOS/README.md`](../HaloApp-iOS/README.md). For the monorepo overview and subtree policy, see the canonical [root README](https://github.com/indexnetwork/index/blob/dev/README.md) and [CLAUDE.md](https://github.com/indexnetwork/index/blob/dev/CLAUDE.md).

## Layout

```text
HaloApp/
  Sources/main.swift        Cocoa AppDelegate + resizable WKWebView window
  Info.plist                macOS bundle metadata (`network.index.halo.system6`)
  assemble.py               inlines vendor scripts + JSX into Resources/index.html
  build.sh                  assembles, compiles Swift, copies resources, codesigns
  Resources/index.html      assembled bundle with scripts/JSX inlined (generated)
  src/
    halo-amiga.html         desktop shell: Workbench viewport, CSS, script tags
    halo-amiga/             editable JSX modules for data, widgets, screens, app entry
    vendor/                 pinned React / ReactDOM / Babel assets for offline bundling
  dist/halo.app             built macOS app bundle (generated; tracked upstream today)
```

## Build & run

The desktop shell builds with the macOS SDK and `swiftc` (Command Line Tools or Xcode are enough):

```sh
./build.sh
open dist/halo.app
```

`./build.sh` performs the whole local build:

1. Runs `python3 assemble.py` to regenerate `Resources/index.html` from `src/`.
2. Compiles `Sources/main.swift` with Cocoa and WebKit.
3. Copies `Info.plist` and the assembled HTML into `dist/halo.app`.
4. Attempts ad-hoc codesigning so the app opens locally.

## Editing

Edit the source files under `src/`, not the generated bundle:

- `src/halo-amiga.html` defines the desktop HTML shell, Workbench styling, and JSX script order.
- `src/halo-amiga/*.jsx` contains the prototype data, primitives, screens, and React entry point.
- `src/vendor/` contains pinned React, ReactDOM, and Babel files so the WebView can load the JavaScript toolchain without CDN access.

After editing, run either:

```sh
python3 assemble.py      # regenerate Resources/index.html only
./build.sh               # regenerate and rebuild dist/halo.app
```

Do not hand-edit `Resources/index.html`; it is overwritten by `assemble.py`.

## Native shell responsibilities

Keep the Swift layer intentionally small:

- Configure WKWebView file access so the inlined bundle can run from `file://`.
- Create the resizable macOS window and native menu items (`⌘Q`, `⌘W`, copy/paste, etc.).
- Load the bundled `index.html` from the app's `Resources` directory.
- Surface JavaScript alerts as native `NSAlert` dialogs.

Product behavior belongs in the web bundle or shared Index protocol/API surfaces, not in the native wrapper.

## Generated artifacts

`Resources/index.html` and `dist/halo.app` are generated outputs. The mac client subtree currently syncs to `indexnetwork/mac-client`, where built `.app` bundles under `dist/` are tracked, so avoid deleting or regenerating `dist/` casually unless the change intentionally updates the shipped artifact.
````

### Success Criteria:

#### Automated Verification:
- [ ] Desktop README exists: `test -f apps/mac/HaloApp/README.md`
- [ ] Desktop README has no placeholder text: `! grep -R "TODO\|TBD\|PLACEHOLDER" apps/mac/HaloApp/README.md`
- [ ] Desktop README documents generated artifact caution: `grep -q "dist/halo.app" apps/mac/HaloApp/README.md && grep -q "Resources/index.html" apps/mac/HaloApp/README.md`

#### Manual Verification:
- [ ] `apps/mac/HaloApp/README.md` accurately reflects `apps/mac/HaloApp/build.sh:11-29`, `apps/mac/HaloApp/assemble.py:1-8`, and `apps/mac/HaloApp/Sources/main.swift:73-80`.
- [ ] The README keeps Swift responsibilities thin and directs product behavior to the bundled web layer/shared surfaces.
- [ ] The `../HaloApp-iOS/README.md` link is relative and correct from `apps/mac/HaloApp/`, and canonical root-doc links point to `https://github.com/indexnetwork/index/blob/dev/README.md` and `https://github.com/indexnetwork/index/blob/dev/CLAUDE.md`.

## Phase 2: Subtree README

### Overview

Add the top-level `apps/mac` README that connects the desktop README from Phase 1 with the existing iOS README and subtree sync guidance. Depends on Phase 1.

### Changes Required:

#### 1. apps/mac/README.md

**File**: apps/mac/README.md
**Changes**: NEW — subtree-level orientation README summarizing layout, commands, editing workflow, generated artifacts, and sync policy.

````markdown
# Index Network Apple clients

Native Apple client prototypes for Index Network. This subtree contains thin Swift **WKWebView** shells around assembled React/HTML bundles with vendored scripts and JSX inlined for desktop and mobile experiments, plus the design handoff bundle that seeded the UI.

For the full monorepo overview, see the canonical [root README](https://github.com/indexnetwork/index/blob/dev/README.md) and [CLAUDE.md](https://github.com/indexnetwork/index/blob/dev/CLAUDE.md). This directory syncs to the standalone [`indexnetwork/mac-client`](https://github.com/indexnetwork/mac-client) repository from `dev` and `main`.

## What's in here

```text
apps/mac/
  HaloApp/              macOS Workbench prototype (`halo.app`)
  HaloApp-iOS/          iOS wrapper plus macOS preview shell for the mobile UI
  design_bundle/        Claude Design handoff artifacts and standalone prototypes
  index _standalone_.html
                        older standalone prototype artifact
```

## App docs

| Area | Docs | Purpose |
| --- | --- | --- |
| macOS desktop | [`HaloApp/README.md`](HaloApp/README.md) | Build and edit the desktop Workbench WKWebView app. |
| iOS/mobile | [`HaloApp-iOS/README.md`](HaloApp-iOS/README.md) | Build the iOS simulator/device wrapper and macOS preview shell. |
| Design handoff | [`design_bundle/halo/README.md`](design_bundle/halo/README.md) | Understand the Claude Design source material before changing the prototype UI. |

## Common commands

Run commands from the app directory shown unless noted otherwise.

| Task | Command |
| --- | --- |
| Build the macOS app | `cd apps/mac/HaloApp && ./build.sh` |
| Open the macOS app | `open apps/mac/HaloApp/dist/halo.app` |
| Reassemble the mobile bundle without Xcode | `cd apps/mac/HaloApp-iOS && ./build.sh assemble` |
| Build/install/launch the iOS simulator app | `cd apps/mac/HaloApp-iOS && ./build.sh` |
| Build the mobile macOS preview shell | `cd apps/mac/HaloApp-iOS && ./preview/build-preview.sh` |
| Open the mobile preview shell | `open apps/mac/HaloApp-iOS/preview/dist/index-preview.app` |

The iOS simulator/device build requires a full Xcode install with the iOS SDK. The macOS desktop app and mobile preview shell can build with the macOS SDK.

## Editing workflow

- Edit desktop UI sources under `HaloApp/src/halo-amiga.html` and `HaloApp/src/halo-amiga/*.jsx`.
- Edit mobile UI sources under `HaloApp-iOS/src/halo-mobile.html` and `HaloApp-iOS/src/halo-mobile/*.jsx`.
- Keep the Swift shells thin: app/window lifecycle, WKWebView configuration, native alerts/menus, and bundled `index.html` loading. Product behavior belongs in the web bundle or shared Index protocol/API surfaces.
- After web-layer edits, run the local `assemble.py` or `build.sh` so `Resources/index.html` reflects the source tree.
- Read the design bundle's chat transcripts before reviving or reworking prototype UI from `design_bundle/halo/`; the README there explains the handoff expectations.

## Generated artifacts

Both apps inline vendored React, ReactDOM, Babel, and JSX modules into generated HTML bundles:

```text
HaloApp/Resources/index.html       generated from HaloApp/src/
HaloApp-iOS/Resources/index.html   generated from HaloApp-iOS/src/
```

Do not hand-edit those generated HTML files. Regenerate them via each app's `assemble.py` or `build.sh`.

The standalone mac client repository currently tracks built `.app` bundles under `dist/` as generated artifacts. Avoid deleting or regenerating `HaloApp/dist/` or `HaloApp-iOS/preview/dist/` casually; only commit those changes when you intentionally want the synced `indexnetwork/mac-client` artifact to change.

## Subtree sync

`apps/mac/` is a derived subtree that syncs to `indexnetwork/mac-client` when `dev` or `main` moves in the canonical `indexnetwork/index` repository. The sync workflow splits the `apps/mac` prefix and force-pushes it to the matching branch in the standalone repo.

Normal development should happen in this monorepo. Manual subtree push/pull commands are documented in canonical [CLAUDE.md](https://github.com/indexnetwork/index/blob/dev/CLAUDE.md) for recovery cases.
````

### Success Criteria:

#### Automated Verification:
- [x] Top-level mac README exists: `test -f apps/mac/README.md`
- [x] Top-level mac README has no placeholder text: `! grep -R "TODO\|TBD\|PLACEHOLDER" apps/mac/README.md`
- [x] README links to both app docs: `grep -q "HaloApp/README.md" apps/mac/README.md && grep -q "HaloApp-iOS/README.md" apps/mac/README.md`
- [x] README documents subtree sync target: `grep -q "indexnetwork/mac-client" apps/mac/README.md`
- [x] Generated bundles and app artifacts remain untouched: `test -z "$(git diff --name-only -- apps/mac | grep -E 'Resources/index.html|/dist/' || true)"`

#### Manual Verification:
- [ ] Common commands match `apps/mac/HaloApp/build.sh:11-29`, `apps/mac/HaloApp-iOS/build.sh:9-14`, and `apps/mac/HaloApp-iOS/preview/build-preview.sh:1-18`.
- [ ] Links to `HaloApp/README.md`, `HaloApp-iOS/README.md`, and `design_bundle/halo/README.md` are relative and correct from `apps/mac/`, and canonical root-doc links point to `https://github.com/indexnetwork/index/blob/dev/README.md` and `https://github.com/indexnetwork/index/blob/dev/CLAUDE.md`.
- [ ] Generated artifact warning matches `.rpiv/guidance/apps/mac/architecture.md:29-30` and does not tell contributors to delete or rebuild `dist/` casually.

## Ordering Constraints

- Phase 1 must land before Phase 2 because the top-level README links to the desktop README introduced by Phase 1.
- No phases can run in parallel.
- Implementation should not run build scripts unless explicitly needed for verification; this plan is documentation-only.

## Verification Notes

- Verify both README files exist and have no placeholder text.
- Verify top-level README links resolve to `HaloApp/README.md` and `HaloApp-iOS/README.md`.
- Verify documented commands match the actual scripts: `apps/mac/HaloApp/build.sh:11-29`, `apps/mac/HaloApp-iOS/build.sh:9-14`, and `apps/mac/HaloApp-iOS/preview/build-preview.sh:1-18`.
- Verify docs warn contributors not to casually regenerate/delete tracked `dist/` app bundles per `.rpiv/guidance/apps/mac/architecture.md:29-30`.

## Performance Considerations

Documentation-only change. No runtime, build-time, database, network, or hot-path performance impact.

## Migration Notes

Not applicable. No persisted schema, data migration, or runtime compatibility changes.

## Pattern References

- `apps/web/README.md:1-39` — concise app README structure.
- `apps/mac/HaloApp-iOS/README.md:1-80` — Apple/WKWebView app README structure and generated-bundle wording.
- `packages/edge-city/agentvillage-landing/README.md:1-99` — standalone app README with "What's in here" and editing notes.
- `.rpiv/guidance/apps/mac/architecture.md:1-31` — current mac subtree architecture guidance and generated artifact warning.

## Developer Context

- Directional confirm: "About to follow the concise app README pattern from `apps/web/README.md:1-5` and the Apple-specific generated-bundle pattern from `apps/mac/HaloApp-iOS/README.md:27-80` for the new mac docs. Confirm that's the direction, or are we moving off that style?" Answer: "Follow pattern".
- Scope question: "`apps/mac/` has no top-level README, while `HaloApp-iOS` already has one (`apps/mac/HaloApp-iOS/README.md:1-80`) and desktop `HaloApp` only exposes comments/scripts (`apps/mac/HaloApp/build.sh:1-30`, `apps/mac/HaloApp/assemble.py:1-8`). Which documentation scope should this plan cover?" Answer: "Top + desktop".
- Design confirmation: add `apps/mac/README.md` and `apps/mac/HaloApp/README.md`; do not rewrite iOS README, source files, or root docs. Answer: "Proceed (Recommended)".
- Decomposition confirmation: Phase 1 desktop README, Phase 2 subtree README. Answer: "Approve (Recommended)".
- Micro-checkpoint Slice 1: presented desktop README summary/signatures/key blocks grounded in `apps/mac/HaloApp/build.sh:11-29`, `apps/mac/HaloApp/assemble.py:1-8`, and `apps/mac/HaloApp/Sources/main.swift:73-80`. Answer: "Approve (Recommended)".
- Micro-checkpoint Slice 2: presented subtree README summary/signatures/key blocks grounded in `apps/mac/HaloApp-iOS/build.sh:9-14`, `apps/mac/HaloApp-iOS/preview/build-preview.sh:1-18`, `.github/workflows/sync-subtrees.yml:50-51`, and `.rpiv/guidance/apps/mac/architecture.md:29-30`. Answer: "Approve (Recommended)".
- Step 8 triage: root-doc link concerns for both README files were marked `applied`; phase code fences now use canonical GitHub links to `indexnetwork/index` root docs.
- Step 8 triage: offline/self-contained wording concerns for both README files were marked `applied`; phase code fences now qualify claims to generated HTML bundles with vendored scripts/JSX inlined.

## Plan History

- Phase 1: Desktop app README — approved as generated
- Phase 2: Subtree README — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 (apps/mac/HaloApp/README.md) | .github/workflows/sync-subtrees.yml:50-51 | concern | codebase-fit | Because `apps/mac` is split to `indexnetwork/mac-client`, Phase 1's `../../../README.md` and `../../../CLAUDE.md` links will point outside the standalone repo after sync. | Replace those root-doc links with absolute links to the canonical `indexnetwork/index` README and CLAUDE.md. | applied: changed desktop README code fence and link success criterion to canonical GitHub URLs. |
| code | Phase 1 §1 (apps/mac/HaloApp/README.md) | apps/mac/HaloApp/src/halo-amiga.html:7-9 | concern | codebase-fit | Phase 1 calls the desktop bundle `self-contained` and `fully offline`, but the source template still loads Google Fonts from `fonts.googleapis.com` and `fonts.gstatic.com`. | Qualify the offline claim to vendored JS/JSX only, or vendor the fonts before claiming the whole bundle is fully offline. | applied: qualified wording to assembled bundle with vendored scripts/JSX inlined and removed full-offline claim. |
| code | Phase 2 §1 (apps/mac/README.md) | .github/workflows/sync-subtrees.yml:50-51 | concern | codebase-fit | Because `apps/mac/README.md` becomes the standalone repo root README, Phase 2's `../../README.md` and `../../CLAUDE.md` links will point outside `indexnetwork/mac-client` after sync. | Replace those root-doc links with absolute links to the canonical `indexnetwork/index` README and CLAUDE.md. | applied: changed top-level README code fence and link success criterion to canonical GitHub URLs. |
| code | Phase 2 §1 (apps/mac/README.md) | apps/mac/HaloApp-iOS/src/halo-mobile.html:11-13 | concern | codebase-fit | Phase 2 says both apps produce `generated offline bundles`, but the mobile source template still includes Google Fonts network links. | Qualify the generated-bundle wording to say vendored scripts/JSX are inlined, or vendor the fonts before documenting the bundles as offline. | applied: qualified top-level wording to generated HTML bundles with vendored scripts/JSX inlined. |

## References

- User request: `Lets document @apps/mac/`.
- `apps/web/README.md`.
- `apps/mac/HaloApp-iOS/README.md`.
- `apps/mac/HaloApp/build.sh`.
- `apps/mac/HaloApp/assemble.py`.
- `apps/mac/HaloApp/Sources/main.swift`.
- `apps/mac/HaloApp-iOS/build.sh`.
- `apps/mac/HaloApp-iOS/preview/build-preview.sh`.
- `.github/workflows/sync-subtrees.yml`.
- `.rpiv/guidance/apps/mac/architecture.md`.
