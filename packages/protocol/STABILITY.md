# Stability & Versioning Policy

`@indexnetwork/protocol` is a published, versioned package consumed by the Index
Network backend and by external integrators. This document defines what the
public contract **is** and what counts as a breaking change.

## The public contract

- The only supported entry point is the package root:
  `import { ... } from "@indexnetwork/protocol"`. There are no subpath exports.
- Deep imports (`@indexnetwork/protocol/dist/...` or `/src/...`) are **not** part
  of the contract and may change or disappear in any release — do not rely on them.
- The contract is exactly the set of symbols re-exported from `src/index.ts`.
  Exports are listed explicitly (no `export *` wildcards), so the surface is
  reviewable and additions are always intentional. Nothing checks this
  mechanically — a removed or renamed export is caught in review of the
  `src/index.ts` diff, and that is what triggers the major bump below.
- `Intents`, `Networks`, and `Negotiations` expose a whole capability as one
  class from `src/capabilities/`, so each capability's internal layout can change
  without a contract change. Opportunity behavior is exported as individual
  functions from the root.
- `protocol/`, `platform/`, `capabilities/`, and `internal/` are source-level
  boundaries, not consumer subpaths.

## What the barrel contains

Every root export is covered by SemVer below; there is no experimental tier.

| Barrel section | What it is |
|---|---|
| **Host runtime hooks** | `setRequestContextStore`, `setLoggerFactory`, `setTimingWrapper` — the host supplies request-context storage, logging, and timing. |
| **Host ports** | The database, cache, and follow-up contracts a host implements. |
| **Intents** | `Intents` — the whole signal capability as one class (lifecycle graph, verification, clarification) plus the `Clarify*` and prepared-intent types. |
| **Networks** | `Networks` and the discovery scope rules. |
| **Negotiations** | `Negotiations`, the opening and turn decision functions, `observeNegotiation`, `negotiationTurnSchema`, and the shared guidance text. Hosts must evaluate supplied decision callbacks against locked current state and commit their effects atomically. |
| **Opportunities** | Lifecycle predicates, presentation, radar graph factory, discriminator mining, and outcome shadow evaluation. |

The barrel is pruned to what in-repo hosts consume. Removing an export is a
breaking change and follows the deprecation path below.

## SemVer policy

This package follows [Semantic Versioning 2.0.0](https://semver.org/).

**MAJOR** — incompatible changes to the public contract:
- Removing or renaming an export.
- Adding a required method/field to an implemented interface, or tightening a
  return type (e.g. `T | null` → `T` is fine; `T` → `T | null` is breaking).
- Changing the runtime behavior a documented port contract guarantees
  (ownership scoping, null-vs-throw semantics, lifecycle idempotency).

**MINOR** — backward-compatible additions:
- New exports; new **optional** interface members; new graph factories/agents.

**PATCH** — backward-compatible fixes:
- Bug fixes, performance, prompt/model tuning, doc and type-comment changes that
  do not alter the contract.

### Port-contract semantics count

Interface ports document invariants in their TSDoc/banner comments — ownership
scoping (return `null` for missing **or** non-owned rows), null-vs-empty-array
conventions, and lifecycle idempotency (`mark*` transitions are no-ops once
terminal). These guarantees are part of the contract: breaking them is a
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
