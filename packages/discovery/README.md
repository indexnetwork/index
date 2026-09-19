# @indexnetwork/discovery

Independent, host-run intent pairing using plain async TypeScript. No protocol,
agent, LangChain, or infrastructure dependencies.

## Direct intent pairing

```ts
import { CandidateDiscovery, TypeSafeIntentEvaluator } from '@indexnetwork/discovery';

const discovery = new CandidateDiscovery({
  database,
  evaluator: new TypeSafeIntentEvaluator(apiKey),
});

const { networkIds, sourcePayload, candidates } = await discovery.discover(
  { userId, triggerIntentId, networkIds: requestedNetworkIds },
  { signal },
);
```

The host supplies `CandidateDiscoveryData` and an `IntentPairEvaluator`.
`discover()` accepts only `userId`, `triggerIntentId`, and `networkIds`; optional
`RunOptions` provide cancellation, a trace emitter, and a logger. It returns the
validated network IDs, the exact source payload evaluated, and all still-eligible
scored `CounterpartyCandidate` records sorted by descending `matchProbability`:

```ts
interface CounterpartyCandidate {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  matchProbability: number;
  reasoning: string;
  candidatePayload: string;
  candidateSummary?: string;
  profile: Profile | null;
  networkContext?: string;
}
```

The database port retains scope, active intent, profile, intent registration,
network membership, and network context reads. It has no rejection-history read.
Its exhaustive enumeration method is:

```ts
listIntentCandidates(
  input: { excludeUserId: string; networkIds: string[] },
  options?: { signal?: AbortSignal },
): Promise<IntentCandidate[]>;

interface IntentCandidate {
  id: string;
  userId: string;
  networkId: string;
  payload: string;
  summary?: string | null;
}
```

This read must list every other user's active, match-ready intent registered in
the requested networks where that user is an active member. It must not shortlist
or cap candidates before scoring. Discovery deduplicates by `(intentId, networkId)`
and directly scores every eligible public intent/network pair, with at most
**four evaluations in flight**. There are no queries, embeddings, vector searches,
or model-selected candidates. Discovery returns **all still-eligible scored pairs
sorted by descending `matchProbability`**, with no pass/fail threshold or `0.8`
cutoff. The discovery result is not truncated to ten candidates.

Discovery performs no opportunity or negotiation writes. Automatic opening is a
separate host step: walk the ranking until **up to 10 new negotiations per intent
per matching run** are created or the candidates are exhausted. Existing/reused,
terminal, and unavailable sessions do not consume that new-opening budget, so
lower-ranked candidates can still be reached. Terminal sessions require deliberate
reopening; automatic matching never reopens them.

Requested networks must be a distinct nonempty subset of the source intent's
registrations intersected with the source user's authorized memberships.
Discovery verifies source ownership and active state before enumeration, then
checks candidate active state, exact-network registration, active membership,
and payload freshness before evaluation. It rechecks returned matches after all
evaluations and profile hydration, including live memberships for both users.
Changed or inactive candidate payloads and revoked registrations or memberships
are excluded. A changed source payload, inactive source intent, or changed source
network scope rejects the run, including when there are no matches. These are
live read guards, not an atomic database snapshot; the host must still validate
eligibility when acting on a match.

Profiles are loaded for scored candidates and reused per user within the run.
A candidate can still be excluded by the final freshness guards. Provider
and host errors reject discovery rather than becoming non-matches or partial
success; in-flight provider calls are cancelled when the run fails. Caller
cancellation reaches enumeration and evaluation, and is checked around the other
host reads.

## TypeSafe evaluator

```ts
const matchProbability = await new TypeSafeIntentEvaluator(apiKey).evaluate(
  { intentA, intentB, networkContext },
  { signal },
);
```

The host must supply a TypeSafe API key; this package does not read environment
variables. The evaluator uses native `fetch`, bearer authentication, and
`POST https://api.typesafe.ai/v1/systemone`, with the fixed model
`INTENT_MATCH_MODEL = 'jev-1.13.0'`. No SDK or additional dependency is required.
Each request has a **30-second timeout** covering the response body and supports
caller cancellation. Non-OK responses throw with their HTTP status, without raw
response content or credentials. Invalid JSON, non-`noul` answers, and nonnumeric,
nonfinite, or out-of-range probabilities also throw. There is no retry or fallback.

Each request sends the two intent payloads and optional network context as state
and asks one `noul` question: is there a concrete, plausible exchange or shared
activity that advances both goals? Topical similarity alone is insufficient;
missing negotiable details are not an automatic failure; explicit incompatible
hard constraints count against a match. The prompt treats all state as untrusted
evidence, not instructions, and does not require guaranteed agreement.

`matchProbability` is the provider's Noul value, not an empirically calibrated
probability of a future agreement. Every returned candidate's `reasoning` is the
public `INTENT_MATCH_REASONING` constant: generic model/scoring provenance,
not an invented pair-specific explanation.

Exhaustive pairing sends one paid provider request per eligible intent/network
pair, including separate requests when an intent shares multiple networks. The
intent payloads and permitted network context are sent to TypeSafe; profiles are
not. Cost, latency, and rate-limit exposure grow with the eligible set. Rate-limit
and provider failures propagate to the host, which owns any retry policy.

## Intent lifecycle embeddings

Pairing does not depend on embeddings. The lifecycle exports are unchanged:
`generateEmbeddings`, `EmbeddingClient`, `EmbeddingGenerator`,
`OPENROUTER_EMBEDDING_MODEL`, `OPENROUTER_EMBEDDING_DIMENSIONS`, and
`OPENROUTER_EMBEDDING_BASE_URL`. Hosts supply an OpenAI-compatible client for
intent lifecycle artifacts using `openai/text-embedding-3-large` and 2,000
dimensions.

## Breaking contract in 0.3.0

The constructor's `embedder` and `search` dependencies are replaced by
`evaluator`. Discovery input no longer accepts `queries` or `minSimilarity`.
Results include `sourcePayload`, and candidates replace `similarity` with
`matchProbability` and `reasoning`, removing `recentlyRejected`. Hosts must
implement `listIntentCandidates` and no longer provide a rejection-history read.
`CandidateSearch`, `SearchOptions`, `DISCOVERY_MIN_SIMILARITY`,
`validateDiscoveryMinSimilarity`, and `REJECTION_COOLDOWN_MS` are removed.

## Source layout and verification

- `src/core/types.ts`: shared host ports, data shapes, and run options.
- `src/core/embedding.generator.ts`: preserved lifecycle embedding requests/configuration.
- `src/matching/candidate.discovery.ts`: exhaustive scoring, descending ranking, and eligibility/freshness guards.
- `src/matching/intent.evaluator.ts`: native-fetch TypeSafe pair evaluation.
- `src/matching/discovery.constants.ts`: fixed model and public scoring provenance.
- `src/index.ts`: explicit public exports.

Run `bun run typecheck` and `bun run build` from this package.
