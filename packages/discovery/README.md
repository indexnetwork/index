# @indexnetwork/discovery

Independent, host-run discovery using plain async TypeScript. No protocol,
agent, LangChain, or infrastructure dependencies.

`CandidateDiscovery.discover()` requires `queries: string[]` containing exactly
**five complementary queries**, not up to five. It trims each query and collapses
whitespace, rejecting non-string, empty, or duplicate queries (case-insensitive
after normalization). There is no single-`query` compatibility path. The caller
owns query complementarity, candidate evaluation, refinement, and negotiation
opening; discovery only retrieves candidates.

All five queries are embedded in one `EmbeddingGenerator.generate(string[])`
call, which must return five nonempty numeric vectors. Five parallel vector
searches use the same requested, authorized network subset and `minSimilarity`.
Hits are merged by `(candidateIntentId, networkId)` before hydration, retaining
the highest similarity across queries. After eligibility checks, the merged
results are sorted by similarity descending and capped at **80 candidates total**,
not 80 per query. Recent rejections remain a `recentlyRejected` flag rather than
being filtered out.

Discovery is restricted to networks **where both intents are registered**.
Requested `networkIds` must be a nonempty, distinct subset of the source intent's
registrations intersected with the source user's authorized memberships, never
all of that user's networks. Source registrations and membership scope are
checked before embedding or vector search; each hydrated candidate must be
registered in the exact network returned by its hit. Source and candidate
match-readiness checks and final live membership guards for both users remain
in place. Foreign-scope hits and unregistered candidates are excluded.

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
