import { log } from '../../lib/log';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, HydeCache, MatchesReadyFn, AgentDispatcher } from '@indexnetwork/protocol';


/**
 * Worker concurrency for the from-intent discovery
 * queues. The factory default (1) serialized every user's scan behind every
 * other user's, which is what made a second onboarding look stalled. 4 lets a
 * handful of signals scan side by side; it stays low because one scan already
 * fans its evaluator out in parallel (one LLM call per candidate) on top of
 * HyDE and embedder calls, so worker concurrency multiplies provider load —
 * raise it only after checking LLM/embedder rate limits. The intent-agent
 * queue deliberately keeps 1 (agent turns for one conversation must not
 * interleave) and is not covered by this constant.
 */
export const DISCOVERY_WORKER_CONCURRENCY = 4;

/** Graph DB shape the opportunity/HyDE graphs require — every `from-*` queue casts its ChatDatabaseAdapter to this. */
export type OpportunityGraphDb = OpportunityGraphDatabase & HydeGraphDatabase;

/** Runtime deps shared by every opportunity-discovery queue worker. */
export interface OpportunityDiscoveryDeps {
  /** Wakes a signal's PersonalAgent once the batch is persisted. */
  matchesReady?: MatchesReadyFn;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
}

type DiscoveryLogger = ReturnType<typeof log.job.from>;

/** Build the graph DB façade every `from-*` queue uses (ChatDatabaseAdapter cast to the graph interfaces). */
export function createOpportunityGraphDb(database: object = new ChatDatabaseAdapter()): OpportunityGraphDb {
  return database as unknown as OpportunityGraphDb;
}

/**
 * Assemble the configured opportunity graph (HyDE sub-graph + matches_ready wiring).
 * Shared by every discovery entry point, so it lives here once.
 */
export function buildOpportunityGraph(graphDb: OpportunityGraphDb, deps?: OpportunityDiscoveryDeps) {
  const embedder: Embedder = new EmbedderAdapter();
  const cache: HydeCache = new RedisCacheAdapter();
  const inferrer = new LensInferrer();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();
  return new OpportunityGraphFactory(
    graphDb,
    embedder,
    hydeGraph,
    undefined,
    undefined,
    deps?.matchesReady,
    deps?.agentDispatcher,
  ).createGraph();
}

type OpportunityInvokeOptions = Parameters<ReturnType<typeof buildOpportunityGraph>['invoke']>[0];

/**
 * Run an opportunity-discovery graph and log/throw on the result.
 *
 * Encapsulates the block that was copy-pasted across the three `from-*` queues:
 * the `invokeOpportunityGraph` test short-circuit, graph assembly + invocation,
 * `result.error` handling, and the candidates/opportunities (and optional trace)
 * completion logging. Per-queue variation is passed in via `errorLabel`/`logContext`/`logTrace`.
 */
export type OpportunityDiscoveryCompletionReason =
  | 'created_or_reactivated'
  | 'no_search_candidates'
  | 'evaluator_rejected_all'
  | 'same_intent_pair_duplicate_suppressed'
  | 'final_atomic_conflict'
  | 'persistence_zero_other';

export interface OpportunityDiscoverySummary {
  candidatesFound: number;
  evaluatedCount: number;
  opportunitiesCreated: number;
  completionReason: OpportunityDiscoveryCompletionReason;
  sameIntentPairDuplicateSuppressions: number;
  crossIntentPairAllowedCount: number;
  finalAtomicConflictCount: number;
}

interface OpportunityDiscoveryResultShape {
  candidates?: unknown[];
  evaluatedOpportunities?: unknown[];
  opportunities?: unknown[];
  persistenceOutcome?: {
    evaluatedCount: number;
    sameIntentPairDuplicateSuppressions: number;
    crossIntentPairAllowedCount: number;
    finalAtomicConflictCount: number;
  };
}

/** Derive a stable zero-output reason without exposing candidate details. */
export function summarizeOpportunityDiscoveryResult(
  result: OpportunityDiscoveryResultShape,
): OpportunityDiscoverySummary {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const opportunities = Array.isArray(result.opportunities) ? result.opportunities : [];
  const persistence = result.persistenceOutcome;
  const evaluatedCount = persistence?.evaluatedCount
    ?? (Array.isArray(result.evaluatedOpportunities) ? result.evaluatedOpportunities.length : 0);
  const sameIntentPairDuplicateSuppressions = persistence?.sameIntentPairDuplicateSuppressions ?? 0;
  const crossIntentPairAllowedCount = persistence?.crossIntentPairAllowedCount ?? 0;
  const finalAtomicConflictCount = persistence?.finalAtomicConflictCount ?? 0;
  const completionReason: OpportunityDiscoveryCompletionReason = opportunities.length > 0
    ? 'created_or_reactivated'
    : candidates.length === 0
      ? 'no_search_candidates'
      : evaluatedCount === 0
        ? 'evaluator_rejected_all'
        : finalAtomicConflictCount > 0
          ? 'final_atomic_conflict'
          : sameIntentPairDuplicateSuppressions > 0
            ? 'same_intent_pair_duplicate_suppressed'
            : 'persistence_zero_other';

  return {
    candidatesFound: candidates.length,
    evaluatedCount,
    opportunitiesCreated: opportunities.length,
    completionReason,
    sameIntentPairDuplicateSuppressions,
    crossIntentPairAllowedCount,
    finalAtomicConflictCount,
  };
}

export async function runOpportunityDiscovery<TOpts extends OpportunityInvokeOptions>(params: {
  graphDb: OpportunityGraphDb;
  deps?: OpportunityDiscoveryDeps & { invokeOpportunityGraph?: (opts: TOpts) => Promise<void> };
  invokeOpts: TOpts;
  logger: DiscoveryLogger;
  /** Human label for the queue, e.g. `'FromIntent'`. */
  label: string;
  /**
   * Label for the thrown fallback error message, e.g. `'from-intent'`. Kept
   * distinct from `label` so the thrown message stays lowercase-dashed (matching
   * the pre-split queues). Defaults to `label`.
   */
  errorLabel?: string;
  /** Identifier fields merged into every log line (e.g. `{ intentId, userId }`). */
  logContext: Record<string, unknown>;
  /** Whether to emit the verbose graph-trace line. Defaults to true. */
  logTrace?: boolean;
}): Promise<OpportunityDiscoverySummary | null> {
  const { graphDb, deps, invokeOpts, logger, label, errorLabel = label, logContext, logTrace = true } = params;

  if (deps?.invokeOpportunityGraph) {
    await deps.invokeOpportunityGraph(invokeOpts);
    return null;
  }

  const opportunityGraph = buildOpportunityGraph(graphDb, deps);
  const result = await opportunityGraph.invoke(invokeOpts);
  if (result.error) {
    logger.error('Graph failed', { ...logContext, error: result.error });
    throw new Error(typeof result.error === 'string' ? result.error : `${errorLabel} graph failed`);
  }

  const summary = summarizeOpportunityDiscoveryResult(result);

  logger.info('Graph complete', {
    ...logContext,
    ...summary,
  });

  if (logTrace) {
    const trace = Array.isArray(result.trace) ? result.trace : [];
    logger.verbose('Graph trace', {
      ...logContext,
      trace: trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        node: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      })),
    });
  }

  return summary;
}
