/**
 * Maintenance Graph: evaluate radar health and trigger rediscovery when unhealthy.
 * Also runs introducer discovery when connector-flow slots are underfilled.
 *
 * Write path — separate from the read-only RadarGraph.
 * Flow: loadCurrentRadar → scoreRadarHealth → [shouldRediscover] → rediscover → introducerDiscovery → logMaintenance → END
 *                                          └─ [skip rediscovery] ─────────────→ introducerDiscovery → logMaintenance → END
 */
import { StateGraph, START, END } from '@langchain/langgraph';

import { MaintenanceGraphState } from './maintenance.state.js';
import { computeRadarHealth } from '../opportunities/radar/radar.health.js';
import { canUserSeeOpportunity, classifyOpportunity, isActionableForViewer, RADAR_SOFT_TARGETS } from '../opportunities/domain/opportunity.utils.js';
import { shouldRunIntroducerDiscovery, runIntroducerDiscovery, type IntroducerDiscoveryDatabase, type IntroducerDiscoveryQueue } from '../opportunities/application/opportunity.introducer.js';
import { isIntroducerDiscoveryEnabled } from '../opportunities/application/opportunity.introducer-feature.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('MaintenanceGraph');

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Database methods needed by the maintenance graph (includes introducer discovery). */
export interface MaintenanceGraphDatabase {
  getOpportunitiesForUser(userId: string, options?: { limit?: number }): Promise<Array<{ id: string; actors: Array<{ userId: string; role: string }>; status: string; [key: string]: unknown }>>;
  getActiveIntents(userId: string): Promise<Array<{ id: string; payload: string }>>;
  /** Get the user's personal network ID (for introducer discovery). */
  getPersonalIndexId(userId: string): Promise<string | null>;
  /** Get contacts with intent freshness data from a personal network (for introducer discovery). */
  getContactsWithIntentFreshness(
    personalIndexId: string,
    ownerId: string,
    limit: number,
  ): Promise<Array<{ userId: string; latestIntentAt: string | null; intentCount: number }>>;
}

/** Cache methods needed by the maintenance graph. */
export interface MaintenanceGraphCache {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ttl?: number }): Promise<void>;
}

/** Queue methods needed by the maintenance graph. */
export interface MaintenanceGraphQueue {
  addJob(data: { intentId: string; userId: string; indexIds?: string[]; contactUserId?: string }, options?: { priority?: number; jobId?: string }): Promise<unknown>;
}

/**
 * Factory for the Maintenance Graph.
 * Accepts database, cache, and queue dependencies via constructor injection.
 */

/** The graph's channel state, as every node sees it. */
export type MaintenanceState = typeof MaintenanceGraphState.State;

/** Everything the maintenance nodes reach for. */
export interface MaintenanceGraphDeps {
  database: MaintenanceGraphDatabase;
  cache: MaintenanceGraphCache;
  queue: MaintenanceGraphQueue;
}

/**
 * Factory for the Maintenance Graph.
 * Accepts database, cache, and queue dependencies via constructor injection.
 */
export class MaintenanceGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: MaintenanceGraphDeps;

  constructor(
    database: MaintenanceGraphDatabase,
    cache: MaintenanceGraphCache,
    queue: MaintenanceGraphQueue,
  ) {
    this.deps = { database, cache, queue };
  }

  /** Compile and return the maintenance graph. */
  createGraph() {
    const deps = this.deps;

    const graph = new StateGraph(MaintenanceGraphState)
      .addNode('loadCurrentRadar', (state: MaintenanceState) => loadCurrentRadarNode(state, deps))
      .addNode('scoreRadarHealth', scoreRadarHealthNode)
      .addNode('rediscover', (state: MaintenanceState) => rediscoverNode(state, deps))
      .addNode('introducerDiscovery', (state: MaintenanceState) => introducerDiscoveryNode(state, deps))
      .addNode('logMaintenance', logMaintenanceNode)
      .addEdge(START, 'loadCurrentRadar')
      .addConditionalEdges('loadCurrentRadar', (state) => (state.error ? 'end' : 'scoreRadarHealth'), {
        scoreRadarHealth: 'scoreRadarHealth',
        end: END,
      })
      .addConditionalEdges('scoreRadarHealth', shouldRediscover, {
        rediscover: 'rediscover',
        introducerDiscovery: 'introducerDiscovery',
      })
      .addEdge('rediscover', 'introducerDiscovery')
      .addEdge('introducerDiscovery', 'logMaintenance')
      .addEdge('logMaintenance', END);

    return graph.compile();
  }
}

export async function loadCurrentRadarNode(state: MaintenanceState, deps: MaintenanceGraphDeps) {
  if (!state.userId) {
    return { error: 'userId is required' };
  }
  try {
    const raw = await deps.database.getOpportunitiesForUser(state.userId, { limit: 150 });
    const actionable = raw.filter((opp) =>
      isActionableForViewer(opp.actors, opp.status, state.userId)
    );
    const expired = raw.filter((opp) =>
      opp.status === 'expired' && canUserSeeOpportunity(opp.actors, opp.status, state.userId)
    );
    const activeIntents = await deps.database.getActiveIntents(state.userId);

    // Read last rediscovery timestamp from cache
    let lastRediscoveryAt: number | null = null;
    try {
      const cached = await deps.cache.get<{ triggeredAt: string }>(`rediscovery:lastRun:${state.userId}`);
      if (typeof cached?.triggeredAt === 'string') {
        const parsed = Date.parse(cached.triggeredAt);
        if (Number.isFinite(parsed)) {
          lastRediscoveryAt = parsed;
        }
      }
    } catch {
      // Cache unavailable — treat as no data
    }

    return {
      currentOpportunities: actionable,
      expiredCount: expired.length,
      activeIntents: activeIntents ?? [],
      lastRediscoveryAt,
    };
  } catch (e) {
    logger.error('MaintenanceGraph loadCurrentRadar failed', { error: e });
    return { error: 'Failed to load current radar' };
  }
}

export async function scoreRadarHealthNode(state: MaintenanceState) {
  if (state.error) return {};
  try {
    const opps = state.currentOpportunities ?? [];
    let connectionCount = 0;
    let connectorFlowCount = 0;

    for (const opp of opps) {
      const category = classifyOpportunity(opp, state.userId);
      if (category === 'connection') connectionCount++;
      else if (category === 'connector-flow') connectorFlowCount++;
    }

    const healthResult = computeRadarHealth({
      connectionCount,
      connectorFlowCount,
      expiredCount: state.expiredCount,
      totalActionable: opps.length,
      lastRediscoveryAt: state.lastRediscoveryAt,
      freshnessWindowMs: FRESHNESS_WINDOW_MS,
    });

    logger.verbose('Radar health scored', {
      userId: state.userId,
      score: healthResult.score,
      shouldMaintain: healthResult.shouldMaintain,
      connectorFlowCount,
    });

    return { healthResult, connectorFlowCount };
  } catch (e) {
    logger.error('MaintenanceGraph scoreRadarHealth failed', { error: e });
    return { error: 'Failed to score radar health' };
  }
}

export function shouldRediscover(state: MaintenanceState): string {
  if (state.error) return 'introducerDiscovery';
  if (state.healthResult?.shouldMaintain && state.activeIntents.length > 0) {
    return 'rediscover';
  }
  return 'introducerDiscovery';
}

export async function rediscoverNode(state: MaintenanceState, deps: MaintenanceGraphDeps) {
  try {
    const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));

    const results = await Promise.allSettled(
      state.activeIntents.map((intent) =>
        deps.queue.addJob(
          { intentId: intent.id, userId: state.userId },
          { priority: 10, jobId: `rediscovery-${state.userId}-${intent.id}-${bucket}` },
        )
      )
    );

    for (const r of results) {
      if (r.status === 'rejected') {
        const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        logger.error('Rediscovery job enqueue failed', { error: errMsg });
      }
    }
    const enqueued = results.filter((r) => r.status === 'fulfilled').length;

    // Record last run timestamp
    if (enqueued > 0) {
      try {
        await deps.cache.set(
          `rediscovery:lastRun:${state.userId}`,
          { triggeredAt: new Date().toISOString() },
          { ttl: 24 * 60 * 60 },
        );
      } catch {
        // Cache write failure is non-fatal
      }
    }

    return { rediscoveryJobsEnqueued: enqueued };
  } catch (e) {
    logger.error('MaintenanceGraph rediscover failed', { error: e });
    return { error: 'Failed to enqueue rediscovery jobs' };
  }
}

export async function introducerDiscoveryNode(state: MaintenanceState, deps: MaintenanceGraphDeps) {
  if (!isIntroducerDiscoveryEnabled()) {
    logger.info('Introducer discovery skipped — disabled by configuration', {
      userId: state.userId,
    });
    return {};
  }

  try {
    const connectorFlowTarget = RADAR_SOFT_TARGETS.connectorFlow;
    if (!shouldRunIntroducerDiscovery(state.connectorFlowCount, connectorFlowTarget)) {
      logger.verbose('Introducer discovery skipped — connector-flow target met', {
        userId: state.userId,
        connectorFlowCount: state.connectorFlowCount,
        connectorFlowTarget,
      });
      return {};
    }

    // Cast database/queue to introducer discovery interfaces (they are compatible)
    const result = await runIntroducerDiscovery(
      deps.database as IntroducerDiscoveryDatabase,
      deps.queue as IntroducerDiscoveryQueue,
      state.userId,
    );

    logger.info('Introducer discovery complete', {
      userId: state.userId,
      contactsEvaluated: result.contactsEvaluated,
      jobsEnqueued: result.jobsEnqueued,
      skippedReason: result.skippedReason,
    });

    return { introducerDiscoveryJobsEnqueued: result.jobsEnqueued };
  } catch (e) {
    logger.error('MaintenanceGraph introducerDiscovery failed', { error: e });
    // Non-fatal: do not set error, just log and continue
    return {};
  }
}

export async function logMaintenanceNode(state: MaintenanceState) {
  logger.info('Maintenance complete', {
    userId: state.userId,
    score: state.healthResult?.score,
    shouldMaintain: state.healthResult?.shouldMaintain,
    rediscoveryJobs: state.rediscoveryJobsEnqueued,
    introducerDiscoveryJobs: state.introducerDiscoveryJobsEnqueued,
    activeIntents: state.activeIntents.length,
    connectorFlowCount: state.connectorFlowCount,
  });
  return {};
}

