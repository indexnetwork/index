# Stability & Versioning Policy

`@indexnetwork/protocol` is a published, versioned package consumed by the Index
Network backend and by external integrators. This document defines what the
public contract **is**, which parts are stable, and what counts as a breaking
change. It is the reference behind the tier annotations in `src/index.ts`.

## The public contract

- The **only** supported entry point is the package root:
  `import { ... } from "@indexnetwork/protocol"`.
- Deep imports (`@indexnetwork/protocol/dist/...` or `/src/...`) are **not** part
  of the contract and may change or disappear in any release — do not rely on them.
- The contract is exactly the set of symbols re-exported from `src/index.ts`.
  Exports are listed explicitly (no `export *` wildcards), so the surface is
  reviewable and additions are always intentional.

## Stability tiers

Each section of the barrel carries one of two tiers.

### Stable

Covered by SemVer below. Breaking changes require a **major** bump.

| Barrel section | What it is |
|---|---|
| **Public API** | `createChatTools`, model config helpers, tool/runtime helpers (`ToolContext`, `ToolDeps`, `invokeToolRuntime`, …), `requestContext`. |
| **Interfaces** | Every `*.interface.ts` port you implement to inject infrastructure (databases, embedder, cache, scraper, queues, integration, agent dispatcher, …). |
| **Shared schemas** | Zod schemas + inferred types that cross the boundary (questions, identity, network-assignment, chat-context, …). |
| **Graph factories** | `*GraphFactory` classes (`ChatGraphFactory`, `OpportunityGraphFactory`, `NegotiationGraphFactory`, …). |
| **Agents** | Structured LLM agents (`UserContextGenerator`, `IndexNegotiator`, `OpportunityEvaluator`, …). |
| **MCP** | `createMcpServer` and its supporting types. |

### Experimental

Marked `@experimental` in `src/index.ts`. May change in a **minor** release without
a major bump. Use at your own risk and pin a version if you depend on them.

| Area | What it is |
|---|---|
| **States** | Advanced graph-state shapes (`UserNegotiationContext`, `NegotiationTurn`, `NegotiationGraphLike`, …) exposed for advanced graph consumers. |
| **Internal helpers** | Low-level support utilities re-exported for the backend's own use (selection/eval/evidence helpers) that are not part of the recommended integration surface. |

> Most symbols in the barrel are consumed by the Index Network backend itself; a
> symbol being absent from the backend's imports does **not** make it dead — it may
> serve external integrators. Removal therefore follows the deprecation path below,
> never an ad-hoc delete.

## SemVer policy

This package follows [Semantic Versioning 2.0.0](https://semver.org/).

**MAJOR** — incompatible changes to the Stable surface:
- Removing or renaming a stable export.
- Adding a required method/field to an implemented interface, or tightening a
  return type (e.g. `T | null` → `T` is fine; `T` → `T | null` is breaking).
- Changing the runtime behavior a documented port contract guarantees
  (ownership scoping, null-vs-throw semantics, lifecycle idempotency).

**MINOR** — backward-compatible additions:
- New exports; new **optional** interface members; new graph factories/agents.
- Any change to an `@experimental` symbol.

**PATCH** — backward-compatible fixes:
- Bug fixes, performance, prompt/model tuning, doc and type-comment changes that
  do not alter the contract.

### Port-contract semantics count

Interface ports document invariants in their TSDoc/banner comments — ownership
scoping (return `null` for missing **or** non-owned rows), null-vs-empty-array
conventions, and lifecycle idempotency (`mark*` transitions are no-ops once
terminal). These guarantees are part of the Stable contract: breaking them is a
**major** change even if the TypeScript signature is unchanged.

## Deprecation path

1. Mark the symbol `@deprecated` in TSDoc with the replacement and target removal version.
2. Note it under `### Deprecated` in `CHANGELOG.md`.
3. Keep it working for at least one minor release.
4. Remove only in a subsequent **major** release.

## Release & publish

- Pushes to `dev` publish an `-rc.<n>` prerelease under the npm `rc` tag.
- Pushes to `main` publish the stable version under `latest` when the
  `package.json` version is new (already-published versions are skipped).
- Bump `package.json` and update `CHANGELOG.md` **before** promoting to `main`.

See `.github/workflows/publish.yml` for the automation and `CHANGELOG.md` for the
release history.
