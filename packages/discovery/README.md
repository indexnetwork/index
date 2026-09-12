# @indexnetwork/discovery

Independent candidate retrieval in plain async TypeScript, with no protocol,
agent, model, or infrastructure dependencies.

`Discovery.discover()` requires an explicit query and an owned active intent.
It embeds that query once and searches real intent vectors once across the
requested, authorized assignments. It returns hydrated candidate statements,
profiles, permission-enabled network context, cosine similarity, and recent
rejection information. It rechecks source lifecycle, assignments, and both
memberships before returning results. Candidates are sorted by similarity.

The caller evaluates candidates and chooses whether to search again or open a
negotiation. There is no automatic broadening, explanation model, pair selection,
or pair opening. An explicit `minSimilarity` can change the next search's floor;
`options.limit` bounds retrieval and output to at most 80 candidates.

The host supplies `EmbeddingGenerator`, `CandidateSearch`, and `DiscoveryData`.
Each invocation accepts an abort signal, trace emitter, and logger. The API
implements protocol scope/context rules in these ports. The personal agent uses
its injected `discover_counterparties` and `open_negotiation` tools; the latter
runs protocol opening rules atomically under its session lease.

Run `bun run typecheck` and `bun run build`. Existing integration coverage stays
in protocol's `src/internal/opportunities/tests/opportunity.graph.spec.ts`.
