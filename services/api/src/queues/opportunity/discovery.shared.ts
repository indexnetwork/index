import { log } from '../../lib/log';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase, Embedder, HydeCache, NegotiationGraphLike, AgentDispatcher } from '@indexnetwork/protocol';

import { negotiationRunExistingQueue } from '../negotiations/run-existing.queue';

/** Graph DB shape the opportunity/HyDE graphs require — every `from-*` queue casts its ChatDatabaseAdapter to this. */
export type OpportunityGraphDb = OpportunityGraphDatabase & HydeGraphDatabase;

/** Runtime deps shared by every opportunity-discovery queue worker. */
export interface OpportunityDiscoveryDeps {
  negotiationGraph?: NegotiationGraphLike;
  agentDispatcher?: Pick<AgentDispatcher, 'hasPersonalAgent'>;
}

type DiscoveryLogger = ReturnType<typeof log.job.from>;

/** Build the graph DB façade every `from-*` queue uses (ChatDatabaseAdapter cast to the graph interfaces). */
export function createOpportunityGraphDb(database: object = new ChatDatabaseAdapter()): OpportunityGraphDb {
  return database as unknown as OpportunityGraphDb;
}

/**
 * Assemble the configured opportunity graph (HyDE sub-graph + negotiation re-enqueue wiring).
 * Identical across from-intent / from-introducer / from-enrichment, so it lives here once.
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
    deps?.negotiationGraph,
    deps?.agentDispatcher,
    async (opportunityId: string, userId: string) => {
      await negotiationRunExistingQueue.addJob({ opportunityId, userId });
    },
  ).createGraph();
}

type OpportunityInvokeOptions = Parameters<ReturnType<typeof buildOpportunityGraph>['invoke']>[0];

/**
 * Run an opportunity-discovery graph and log/throw on the result.
 *
 * Encapsulates the block that was copy-pasted across the three `from-*` queues:
 * the `invokeOpportunityGraph` test short-circuit, graph assembly + invocation,
 * `result.error` handling, and the candidates/opportunities (and optional trace)
 * completion logging. Per-queue variation is passed in via `label`/`logContext`/`logTrace`.
 */
export async function runOpportunityDiscovery<TOpts extends OpportunityInvokeOptions>(params: {
  graphDb: OpportunityGraphDb;
  deps?: OpportunityDiscoveryDeps & { invokeOpportunityGraph?: (opts: TOpts) => Promise<void> };
  invokeOpts: TOpts;
  logger: DiscoveryLogger;
  /** Human label for log-line prefixes, e.g. `'FromIntent'`. */
  label: string;
  /**
   * Label for the thrown fallback error message, e.g. `'from-intent'`. Kept
   * distinct from `label` so the thrown message stays lowercase-dashed (matching
   * the pre-split queues) while log prefixes stay PascalCase. Defaults to `label`.
   */
  errorLabel?: string;
  /** Identifier fields merged into every log line (e.g. `{ intentId, userId }`). */
  logContext: Record<string, unknown>;
  /** Whether to emit the verbose graph-trace line (from-enrichment opts out). Defaults to true. */
  logTrace?: boolean;
}): Promise<void> {
  const { graphDb, deps, invokeOpts, logger, label, errorLabel = label, logContext, logTrace = true } = params;

  if (deps?.invokeOpportunityGraph) {
    await deps.invokeOpportunityGraph(invokeOpts);
    return;
  }

  const opportunityGraph = buildOpportunityGraph(graphDb, deps);
  const result = await opportunityGraph.invoke(invokeOpts);
  if (result.error) {
    logger.error(`[${label}] Graph failed`, { ...logContext, error: result.error });
    throw new Error(typeof result.error === 'string' ? result.error : `${errorLabel} graph failed`);
  }

  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const opportunitiesArr = Array.isArray(result.opportunities) ? result.opportunities : [];

  logger.info(`[${label}] Graph complete`, {
    ...logContext,
    candidatesFound: candidates.length,
    opportunitiesCreated: opportunitiesArr.length,
  });

  if (logTrace) {
    const trace = Array.isArray(result.trace) ? result.trace : [];
    logger.verbose(`[${label}] Graph trace`, {
      ...logContext,
      trace: trace.map((t: { node: string; detail?: string; data?: Record<string, unknown> }) => ({
        node: t.node,
        detail: t.detail,
        ...(t.data ? { data: t.data } : {}),
      })),
    });
  }
}
