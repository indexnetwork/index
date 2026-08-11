# Configurable Discovery Thresholds Design

## Summary

Make the two global semantic-discovery thresholds configurable through environment variables while preserving current production behavior:

- retrieval similarity remains `0.30` by default;
- evaluator score admission remains `50` by default.

The deployment environment controls production thresholds. Explicit overrides remain available only at graph construction for deterministic evals and tests; they are removed from per-run graph input so queue jobs, MCP requests, and tool calls cannot override deployment policy.

## Background

Opportunity discovery currently has two distinct numeric gates:

1. The discovery graph passes a hardcoded `0.30` minimum cosine similarity to semantic retrieval strategies.
2. The evaluation node uses `state.options.minScore ?? 50` before an evaluated opportunity can proceed to persistence and negotiation.

These values solve different problems. Retrieval similarity controls recall and evaluator spend. Evaluator score controls admission after the model has considered the retrieved evidence.

The evaluator also has categorical and deterministic safety gates. In particular, a verdict with `accepted: false` is omitted before score filtering. Making the numeric score configurable must not override categorical rejection, claim-safety filtering, actor validation, or other admission rules.

Observability is currently misleading: the `threshold_filter` trace reports a hardcoded retrieval threshold of `0.40`, although the discovery graph supplies `0.30` to its semantic searches.

## Goals

- Configure the global retrieval cutoff with `DISCOVERY_MIN_SIMILARITY`.
- Configure the global evaluator admission score with `DISCOVERY_EVALUATOR_MIN_SCORE`.
- Preserve defaults of `0.30` and `50` when variables are absent or blank.
- Apply the retrieval threshold to every semantic opportunity-discovery strategy.
- Apply the evaluator threshold to semantic opportunity evaluation.
- Keep direct introductions and non-semantic graph modes unchanged.
- Reject malformed and out-of-range configuration before API workers start.
- Report the effective values in discovery traces.
- Keep deterministic explicit overrides for evals and tests without exposing them in production run inputs.

## Non-goals

- Changing the current default values or activating non-default values in any environment.
- Mutating Railway variables or `.env.development`.
- Making thresholds network-specific, user-specific, or request-specific.
- Relaxing evaluator prompts, categorical role judgments, claim safety, actor validation, persistence admission, or negotiation guards.
- Changing generic similarity defaults used by unrelated embedder or database operations.
- Guaranteeing that lowering the evaluator score admits a candidate with `accepted: false`.

## Environment contract

### `DISCOVERY_MIN_SIMILARITY`

- Meaning: minimum cosine similarity required for semantic opportunity retrieval.
- Domain: finite decimal from `0` through `1`, inclusive.
- Default: `0.30`.

### `DISCOVERY_EVALUATOR_MIN_SCORE`

- Meaning: minimum evaluator score required after the evaluator has categorically accepted a candidate.
- Domain: finite decimal from `0` through `100`, inclusive.
- Default: `50`.

For both variables:

- unset or whitespace-only values use the default;
- valid finite decimal strings within the inclusive range are accepted;
- non-numeric, `NaN`, infinite, and out-of-range values are configuration errors;
- API startup fails with an error naming the variable and allowed range;
- non-API protocol consumers fail when constructing discovery with invalid configuration rather than silently clamping or falling back.

Both variables are registered in `services/api/src/startup.env.ts` and documented as commented examples in `.env.example`.

## Architecture

### Centralized accessors

Extend `packages/protocol/src/opportunity/discovery.env.ts` with centralized threshold accessors and exported defaults:

- `DISCOVERY_MIN_SIMILARITY_DEFAULT = 0.30`
- `DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT = 50`
- `discoveryMinSimilarity(): number`
- `discoveryEvaluatorMinScore(): number`

The accessors read on each graph construction and strictly validate their inputs. No discovery implementation reads these variables directly through `process.env`.

API startup validation duplicates the same externally visible range contract so invalid deployments fail before queue workers or HTTP handlers begin serving. Tests keep the two validators aligned at boundary and representative values.

### Graph configuration

Add an optional constructor-time configuration to `OpportunityGraphFactory`:

```ts
interface OpportunityGraphThresholdOverrides {
  retrievalMinSimilarity?: number;
  evaluatorMinScore?: number;
}
```

The graph factory resolves effective thresholds once when `createGraph()` is called:

```text
constructor override (eval/test composition only)
  -> environment accessor
  -> documented default when env is absent/blank
```

Constructor overrides receive the same finite-number and range validation as environment values.

Production graph composition in queues, MCP, tool services, foreground runtime, and negotiation workers omits this optional configuration. Eval and test composition may inject explicit values for reproducibility and boundary testing.

Remove `minScore` from `OpportunityGraphOptions`. This prevents queue payloads, MCP/tool requests, and other runtime graph invocations from overriding deployment-wide evaluator policy. Direct `OpportunityEvaluator` component tests may continue to pass `minScore` to that isolated component API.

### Retrieval flow

The resolved retrieval value replaces the local hardcoded `const minScore = 0.3` and is passed to all semantic discovery operations:

- query HyDE searches;
- premise-to-premise searches;
- context-HyDE-to-intent searches;
- raw context-to-intent fallback searches;
- context-to-context searches;
- equivalent semantic paths used by intent, context, enrichment, MCP, and foreground discovery.

Direct-target introductions do not perform semantic retrieval and therefore remain unaffected.

Lower-level generic embedder defaults remain unchanged. The opportunity graph always supplies its resolved value explicitly, so unrelated search consumers retain their own contracts.

### Evaluation flow

For semantic runs, the resolved evaluator score replaces `state.options.minScore ?? 50` in the evaluation node. It is supplied to `OpportunityEvaluator.invokeEntityBundle` and used by the graph's deterministic post-evaluation score filtering.

Non-semantic direct-target runs keep their existing score behavior: the direct-target discovery path retains a `50` floor, while the separate human-curated `create_introduction` path retains its existing `minScore: 0` and fallback behavior. Neither path reads the new semantic-discovery threshold variables.

Admission order for semantic runs remains:

1. evaluator categorical verdict (`accepted`);
2. claim-safety and actor-shape guards;
3. configured evaluator score;
4. existing graph validation, persistence admission, and negotiation routing.

Consequently, lowering `DISCOVERY_EVALUATOR_MIN_SCORE` cannot admit `accepted: false` verdicts or bypass non-score safety gates.

## Observability

Replace the hardcoded `0.40` threshold trace with the effective retrieval threshold. Trace data for each semantic run includes:

- `retrievalMinSimilarity`;
- `evaluatorMinScore`;
- above/below counts where applicable;
- the effective evaluator threshold already used in evaluation summaries.

Trace details and structured data must agree. This removes the current discrepancy where retrieval uses `0.30` but the trace claims `0.40`.

Threshold values are non-secret configuration and may be logged. Invalid raw environment strings should not be repeated beyond the configuration error needed to identify the bad variable.

## Production override boundary

Threshold overrides are a composition-time testing/evaluation seam, not a product feature.

The following production paths must construct `OpportunityGraphFactory` without threshold overrides:

- opportunity discovery queues;
- MCP discovery;
- tool service discovery;
- foreground protocol composition;
- negotiation workers.

Dedicated tests or static assertions cover these composition points. Eval and smoke CLIs may inject explicit values so historical and A/B comparisons remain independent of deployment defaults.

No per-run graph state, queue job payload, public tool schema, controller input, or MCP input exposes either override.

## Compatibility and versioning

`OpportunityGraphOptions.minScore` is currently part of the published protocol contract. Removing it is an intentional breaking API change: callers that need deterministic evaluator thresholds must move to the constructor-time eval/test seam, while production callers use deployment configuration.

Under repository SemVer policy, implementation bumps `@indexnetwork/protocol` from `10.1.0` to `11.0.0`. Because the API package is also changed to validate and document the new environment variables, it receives the feature-level bump from `0.78.0` to `0.79.0`. The root `bun.lock` is regenerated and committed with both package version changes.

## Testing

### Environment accessor tests

Extend `packages/protocol/src/opportunity/tests/discovery.env.spec.ts` to cover:

- absent and blank values returning `0.30` and `50`;
- representative valid decimal values;
- inclusive boundaries `0`, `1`, and `100`;
- non-numeric, non-finite, negative, and above-range values throwing named configuration errors;
- values being read at graph construction rather than cached across process lifetime.

### API startup validation tests

Cover both variables in the startup environment validation suite:

- absent and blank accepted;
- valid in-range values accepted;
- malformed and out-of-range values rejected before startup completes.

### Graph tests

Add focused graph tests proving:

- default retrieval value reaches every semantic search seam;
- configured environment retrieval value reaches every semantic search seam;
- configured evaluator value is supplied to evaluation and deterministic filtering;
- constructor overrides take precedence in eval/test graph composition;
- invalid constructor overrides fail graph construction;
- direct-target runs retain their existing `50` floor and human-curated introductions retain their existing `minScore: 0` behavior;
- trace detail and structured trace data report the effective values;
- an evaluator verdict with `accepted: false` remains rejected regardless of the numeric threshold.

### Production composition tests

Verify production graph builders do not pass threshold overrides and that threshold fields are absent from runtime input types and schemas. Existing eval/test fixtures using `options.minScore` are migrated to constructor overrides or isolated evaluator calls as appropriate.

### Targeted verification

Run affected protocol and API tests plus applicable typecheck, lint, static-inventory, and generated-artifact checks according to the repository Development Reference. Database-backed tests are not required unless implementation changes reveal a database-specific behavior requiring them.

## Rollout

This change ships with no live value changes:

- do not add either variable to Railway dev;
- do not add either variable to root `.env.development`;
- do not change `.env.test` unless a specific test intentionally needs a non-default value;
- document both variables in `.env.example` as optional commented settings.

After deployment, absence of both variables preserves existing behavior. Any later threshold adjustment is a separate operational action with explicit approval and should be evaluated using candidate volume, evaluator spend, acceptance rate, and false-positive quality.

## Acceptance criteria

- Production semantic retrieval uses `DISCOVERY_MIN_SIMILARITY`, defaulting to `0.30`.
- Production semantic evaluator admission uses `DISCOVERY_EVALUATOR_MIN_SCORE`, defaulting to `50`; non-semantic direct-target and human-curated introduction paths remain unchanged.
- Invalid values fail startup instead of falling back or clamping.
- All semantic opportunity-discovery strategies receive the same resolved retrieval threshold.
- Categorical evaluator rejection and safety guards remain authoritative.
- Production requests cannot supply threshold overrides, and the published removal of `OpportunityGraphOptions.minScore` is released as `@indexnetwork/protocol` 11.0.0.
- Eval/test composition can inject deterministic overrides.
- Traces report the actual effective thresholds with no hardcoded `0.40` discrepancy.
- No Railway or local active environment values are changed.
