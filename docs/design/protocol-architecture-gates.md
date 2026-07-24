# Protocol architecture gates

IND-514 turns the protocol-package audit's compatibility and dependency findings into source-level gates before structural work begins. These checks intentionally characterize the current public contract and dependency topology; they do not approve a refactor automatically.

## Public contract

`packages/protocol/src/index.ts` remains the only supported entry point. `packages/protocol/architecture/exports.snapshot.json` records every root name, whether it is a type or value export, its source module, and the stability tier carried by the barrel section. `bun run architecture:exports` compares that snapshot and its generated consumer fixture with the barrel. A deliberate public-contract change must use `bun run architecture:exports:update` and receive review.

The consumer fixture imports every root value and type name, and `bun run architecture:consumer` type-checks it against source. It protects consumers even when local repository imports do not reveal external usage.

## Dependency and execution characterization

`bun run architecture:host-isolation` rejects protocol source imports that escape `packages/protocol/src`, direct API/web implementation imports, or concrete Drizzle, queue, and database-driver packages. Protocol continues to receive host behavior through interfaces.

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

The exact isolated command above completed with **2,155 pass, 27 fail, 0 errors across 199 files in 279.8s**. The remaining failures predate these gates and are retained as a credential-free source-test characterization baseline, not accepted automatically. These commands intentionally unset provider credentials; no provider-backed test is part of this baseline.
