# Protocol architecture gates

The protocol package keeps a small set of source-level dependency gates. They protect current internal modularity without treating the package as a supported external API.


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


## Dependency and execution characterization

`bun run architecture:host-isolation` rejects static or literal dynamic protocol source imports that escape `packages/protocol/src`, direct API/web implementation imports, or concrete Drizzle, queue, and database-driver packages. Protocol continues to receive host behavior through interfaces.

`bun run test:architecture` covers the capability model that both scripts above resolve paths through — the canonical and compatibility directory mappings, barrel recognition, and the legacy paths that must not come back.

The two scripts are the enforcement; the tests cover the model they share. There is deliberately no third layer of fixtures asserting that source files contain particular strings.

## Credential-free baseline

The audit recorded these commands at the audited commit:

| Check | Command | Audited result |
| --- | --- | --- |
| Package build | `cd packages/protocol && bun run build` | PASS |
| Package lint | `bunx eslint packages/protocol/src --format stylish` | PASS with 0 errors, 251 warnings |
| Isolated source tests | `cd packages/protocol && env -u OPENROUTER_API_KEY -u OPENAI_API_KEY TEST_CONCURRENCY=4 bun run test:isolated` | Recorded baseline: 2,150 pass, 30 fail, 0 errors across 198 files in 303.5s |

The audit also recorded a provider-free eval gate (`bun run eval:verify`). That
gate no longer exists: #1419 removed the eval system, archived at
`archive/eval-2026-08-16`, and the follow-up review (`d51b6097d`) deliberately
restored only `services/api`'s `typecheck:specs` and the CLI test job — not
`eval:verify`. Nothing currently checks that protocol source-path references
from outside `src/` still resolve.

### IND-514 branch result

The current `bun run architecture:check` command verifies host isolation, named capability directions, and the representative architecture tests. It does not snapshot the root export surface, enforce a publication artifact contract, or maintain a cycle baseline; those are intentionally deferred until the package has supported external consumers.
