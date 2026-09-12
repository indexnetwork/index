# @indexnetwork/discovery

Independent, host-run discovery using plain async TypeScript. No protocol,
agent, LangChain, or infrastructure dependencies; `zod` validates model output.

`Discovery.discover()` embeds the caller's query, retrieves real intent
candidates, rechecks memberships, applies the existing cooldown and ranking
limits, and explains potential pairs. It returns network/intent/user identities,
scores, reasoning, and evidence.

The host supplies `Model`, `EmbeddingGenerator`, `CandidateSearch`, and
`DiscoveryData`. Each invocation accepts an abort signal, trace emitter, and
logger. `ModelClient` is the provided fetch-based OpenRouter implementation
with structured-response validation. Retries use cancellation-aware exponential
backoff and honor `Retry-After` seconds or HTTP dates across model fallbacks.

The API resolves protocol network/broadcast rules through the data/search ports,
then gives returned pairs protocol identity and calls atomic `openCounterparties`
with `decideNegotiationOpening`. Negotiation behavior belongs to agent; intent,
negotiation, and opportunity lifecycle rules stay in protocol.

Source layout:

- `src/core/`: model client, per-invocation runtime context, and shared host ports.
- `src/prompts/discovery.prompt.ts`: prompt text for match explanations.
- `src/matching/`: the fixed `Discovery.discover()` pipeline, preparation and
  scope resolution, candidate retrieval, evaluation, ranking, evidence, and explanations.
- `src/index.ts`: explicit public exports. Hosts continue to import from
  `@indexnetwork/discovery`.

Domain state and shared types stay outside the orchestrators. Prompt builders
import only types; runtime modules have no circular imports.

Run `bun run typecheck` and `bun run build`. Existing integration coverage stays
in protocol's `src/internal/opportunities/tests/opportunity.graph.spec.ts`.
