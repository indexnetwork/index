# Stability & Versioning Policy

`@indexnetwork/protocol` is a published, versioned package consumed by the Index
Network backend and by external integrators. This document defines what the
public contract **is**, which parts are stable, and what counts as a breaking
change. It is the reference behind the tier annotations in `src/index.ts`.

## The public contract

- The supported entry points are the package root:
  `import { ... } from "@indexnetwork/protocol"` — and the **browser-safe
  subpaths** listed in `package.json` `exports` (as of 21.1.0:
  package root. There are no supported browser subpaths.
  exposes one shared-schema module whose only runtime dependency is `zod`, for
  consumers (the web client) that cannot load the node-only package root. The
  schema module's symbols are also re-exported from the root (the fixture is
  subpath-only, to keep test data out of the runtime barrel), and the subpaths
  carry the Stable tier.
- Deep imports (`@indexnetwork/protocol/dist/...` or `/src/...`) are **not** part
  of the contract and may change or disappear in any release — do not rely on them.
- The contract is exactly the set of symbols re-exported from `src/index.ts`.
  Exports are listed explicitly (no `export *` wildcards), so the surface is
  reviewable and additions are always intentional. Nothing checks this
  mechanically — a removed or renamed stable export is caught in review of the
  `src/index.ts` diff, and that is what triggers the major bump below.
- Root exports are assembled through named capability facades. Those facades are
  implementation seams, not package subpath entry points: consumers must still
  import only from `@indexnetwork/protocol`. A capability may state that facade
  as a class rather than a re-export list — `intents` does, via `Intents` in
  `intents/intent.module.ts` — which makes the whole capability one exported
  symbol and its internal layout free to change without a contract change.
- `protocol/`, `platform/`, `capabilities/`, and `internal/` are source-level
  boundaries, not consumer subpaths. The sole supported Node import remains the
  package root.

## Stability tiers

Each section of the barrel carries one of two tiers.

### Stable

Covered by SemVer below. Breaking changes require a **major** bump.

| Barrel section | What it is |
|---|---|
| **Public API** | `createToolRegistry`, model config helpers, tool/runtime helpers (`ResolvedToolContext`, `ToolDeps`, `invokeToolRuntime`, …), `requestContext`. |
| **Interfaces** | Every `*.interface.ts` port you implement to inject infrastructure (databases, embedder, cache, scraper, queues, integration, agent dispatcher, …). |
| **Shared schemas** | Zod schemas + inferred types that cross the boundary (questions, identity, network-assignment, chat-context, …). |
| **Graph factories** | `*GraphFactory` classes (`ChatGraphFactory`, `OpportunityGraphFactory`, `NegotiationGraphFactory`, …). |
| **Intents** | `Intents` — the whole signal capability as one class (lifecycle graph, verification, network indexing, guided intake, tools) plus `IntentsDeps` and the intake/indexer types. Replaced the six separate intent exports in 18.0.0. |
| **Agents** | Structured LLM agents (`IndexNegotiator`, `OpportunityEvaluator`, …). |
| **MCP** | `createMcpServer` plus the types needed to call it: `ScopedDepsFactory`, `McpCapabilityPolicyOptions`, `CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS`, `McpAuthorizationObserver`, `McpAuthorizationDenialEvent`. The rest of `mcp.authorization-policy.ts` is package-internal as of 15.0.0. |
| **Capability tools** | `createEnrichmentTools` only. The other per-capability tool factories became package-internal in 15.0.0 — compose them through `createMcpServer` or `createToolRegistry`. |

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
