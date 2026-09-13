# @indexnetwork/discovery

Independent, host-run discovery using plain async TypeScript. No protocol,
agent, LangChain, or infrastructure dependencies.

`CandidateDiscovery.discover()` embeds the explicit search query once, searches
real intent embeddings across authorized networks, rechecks memberships and
rejections, and returns ranked candidates. The caller owns candidate evaluation,
query refinement, and negotiation opening.

The host supplies `EmbeddingGenerator`, `CandidateSearch`, and `CandidateDiscoveryData`.
Each invocation accepts an abort signal, trace emitter, and logger.

`generateEmbeddings()` shares query/intent normalization and the OpenRouter model
configuration (`openai/text-embedding-3-large`, 2,000 dimensions) across the API and
scenario TUI. Hosts supply an OpenAI-compatible client; the library has no SDK or
credential dependency. The TUI substitutes fixture reads and in-memory cosine
search for Postgres while retaining `CandidateDiscovery` itself.

Source layout:

- `src/core/types.ts`: shared host ports, data shapes, and run options.
- `src/core/embedding.generator.ts`: shared embedding requests/configuration with host-owned transport.
- `src/matching/candidate.discovery.ts`: candidate retrieval, scope resolution, and candidate hydration.
- `src/matching/discovery.constants.ts`: discovery constants and validators.
- `src/index.ts`: explicit public exports.

Run `bun run typecheck` and `bun run build`. Integration coverage lives in
protocol's `src/internal/opportunities/tests/opportunity.graph.spec.ts`.
