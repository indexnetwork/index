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
status: in-progress
parent: null
phase_count: 2
phases:
  - { n: 1, title: Desktop app README }
  - { n: 2, title: Subtree README }
unresolved_phase_count: 2
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

```markdown
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

## Phase 2: Subtree README

### Overview

Add the top-level `apps/mac` README that connects the desktop README from Phase 1 with the existing iOS README and subtree sync guidance. Depends on Phase 1.

### Changes Required:

#### 1. apps/mac/README.md

**File**: apps/mac/README.md
**Changes**: NEW — subtree-level orientation README summarizing layout, commands, editing workflow, generated artifacts, and sync policy.

```markdown
```

### Success Criteria:

#### Automated Verification:

#### Manual Verification:

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

## Plan History

- Phase 1: Desktop app README — pending
- Phase 2: Subtree README — pending

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
