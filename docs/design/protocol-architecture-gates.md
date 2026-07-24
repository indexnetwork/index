# Protocol architecture gates

IND-514 turns the protocol-package audit's compatibility and dependency findings into source-level gates before structural work begins. These checks intentionally characterize the current public contract and dependency topology; they do not approve a refactor automatically.

## Public contract

`packages/protocol/src/index.ts` remains the only supported entry point. `packages/protocol/architecture/exports.snapshot.json` records every root name, whether it is a type or value export, its source module, and the stability tier carried by the barrel section. `bun run architecture:exports` compares that snapshot and its generated consumer fixture with the barrel. A deliberate public-contract change must use `bun run architecture:exports:update` and receive review.

## Capability facades

IND-528 keeps the current physical directories in place while making ownership
enforceable. `src/capabilities/*.facade.ts` modules provide named, explicit
outward contracts for Signals, Participant context, Communities, Opportunities,
Negotiation, Questions, Participant agents, Contacts, and Integrations. They
are not generic barrels and are not published package subpaths. The root barrel
assembles its capability exports through them, preserving established symbol
names.

`bun run architecture:capabilities` resolves source imports and fails when a
capability reaches another implementation directory directly or uses an unnamed
dependency direction. The allowlist is explicit in
`scripts/architecture/capability-boundaries.ts`. Interaction-wide tool assembly
is classified as `interaction-composition` (despite its temporary physical
location under `shared/agent`) and is the only all-capability dependency point.
This makes the remaining Phase 3/4 extraction and cycle work incremental rather
than treating barrel trimming as ownership migration (IND-457 remains separate).

The consumer fixture imports every root value and type name, and `bun run architecture:consumer` type-checks it against source. It protects consumers even when local repository imports do not reveal external usage.

## Dependency and execution characterization

`bun run architecture:host-isolation` rejects static or literal dynamic protocol source imports that escape `packages/protocol/src`, direct API/web implementation imports, or concrete Drizzle, queue, and database-driver packages. Protocol continues to receive host behavior through interfaces.

`packages/protocol/architecture/cycles.baseline.json` records the audited topology: **18 reported circular paths and 2 cyclic SCCs**. `bun run architecture:cycles` permits those audited components only to shrink; it rejects a third component or a component outside the audited members. Phase 3 replaces this gate with a zero-cycle requirement.

`bun run test:architecture` encodes the representative foreground/ambient matrix for signal admission, opportunity discovery, and negotiation. The transport differs, while the corresponding injected graph factory and application invariants remain shared.

## Credential-free baseline

The audit recorded these commands at the audited commit:

| Check | Command | Audited result |
| --- | --- | --- |
| Package build | `cd packages/protocol && bun run build` | PASS |
| Package lint | `bunx eslint packages/protocol/src --format stylish` | PASS with 0 errors, 251 warnings |
| Provider-free eval gate | `cd packages/protocol && env -u OPENROUTER_API_KEY -u OPENAI_API_KEY bun run eval:verify` | PASS: 9 suite inventories, type-checks, and provider-free tests |
| Isolated source tests | `cd packages/protocol && env -u OPENROUTER_API_KEY -u OPENAI_API_KEY TEST_CONCURRENCY=4 bun run test:isolated` | Recorded baseline: 2,150 pass, 30 fail, 0 errors across 198 files in 303.5s |

### IND-514 branch result

At this branch's gate introduction, `bun run architecture:check` passed: 306 exports (161 values and 145 types; 298 stable and 8 experimental), consumer compilation, zero host-isolation violations, the 18-path/2-SCC cycle baseline, and 2 matrix characterization tests. `bun run build` passed; lint remained 0 errors and 251 warnings; and the provider-free eval gate passed all 9 suites.

IND-528 subsequently expanded the reviewed root surface to 316 exports (308
stable and 8 experimental) with nine capability-owned tool entry-point groups and
added the capability-direction gate. Its SemVer classification is minor because
the additive stable exports are supported public API; no lockfile update was
needed because dependency resolution did not change.

For IND-528, the exact isolated command completed with **2,063 pass, 0 fail,
0 errors across 196 provider-free files in 7.4s** at concurrency two. Five
explicit live-model specs were excluded by the harness. These commands unset
provider credentials; no provider-backed test is part of this verification.
