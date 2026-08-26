// services/api/src/lib/opportunity/discovery.ts
import { log } from '../log';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import type { MatchesReadyFn, AgentDispatcher } from '@indexnetwork/protocol';

import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';
import { buildIntentDiscoveryTrigger, type FromIntentGraphInvokeOptions } from './discovery-trigger.builders';
export type { FromIntentGraphInvokeOptions } from './discovery-trigger.builders';
import { createIntentDiscoveryLock, type IntentDiscoveryLock } from './discovery.intent-lock';
import { maybeRunNegotiationEvidenceShadow } from '../negotiation/negotiation-evidence.shadow';

/**
 * Same-intent overlap guard (see discovery.intent-lock.ts). The lock outlives
 * any plausible scan so it never lapses mid-run, yet a worker that dies
 * without releasing only blocks that intent's next run for this long.
 */
export const SAME_INTENT_LOCK_TTL_MS = 10 * 60 * 1000;
/** How long a job that found its intent already running waits before re-checking. */
export const SAME_INTENT_DEFER_DELAY_MS = 30 * 1000;

export interface FromIntentJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
  /** What started this run. `intent_resume` identifies lifecycle resume runs. */
  trigger?: 'intent_resume';
}

export type FromIntentDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getNetworkIdsForIntent' | 'getAssignmentNetworkMembershipsForUser' | 'markIntentFirstDiscoverySucceeded' | 'recordIntentDiscoveryProgress'
>;

export interface FromIntentDeps {
  database?: FromIntentDatabase;
  invokeOpportunityGraph?: (opts: FromIntentGraphInvokeOptions) => Promise<void>;
  matchesReady?: MatchesReadyFn;
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
  /** Same-intent overlap guard; defaults to Redis (in-process map under the hermetic test baseline). */
  intentLock?: IntentDiscoveryLock;
  /** Test hook: shortens the re-check delay of a deferred same-intent job. */
  sameIntentDeferDelayMs?: number;
}

export class IntentDiscovery {
  private readonly logger = log.job.from('FromIntentJob');
  private readonly database: FromIntentDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDb;
  private readonly intentLock: IntentDiscoveryLock;
  private readonly sameIntentDeferDelayMs: number;
  private deps: FromIntentDeps | undefined;

  constructor(deps?: FromIntentDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = createOpportunityGraphDb(this.database);
    this.intentLock = deps?.intentLock ?? createIntentDiscoveryLock();
    this.sameIntentDeferDelayMs = deps?.sameIntentDeferDelayMs ?? SAME_INTENT_DEFER_DELAY_MS;
  }

  setRuntimeDeps(runtimeDeps: Pick<FromIntentDeps, 'matchesReady' | 'agentDispatcher'>): void {
    this.deps = { ...(this.deps ?? {}), ...runtimeDeps };
  }

  async discover(data: FromIntentJobData): Promise<void> {
    await this.runDiscover(data);
  }

  async addJob(
    data: FromIntentJobData,
    options?: { delay?: number },
  ): Promise<void> {
    await this.recordProgress(data, 'queued', 0);
    const delay = options?.delay ?? 0;
    void (async () => {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      await this.runDiscover(data);
    })().catch((error) => {
      this.logger.error('Discovery failed', {
        intentId: data.intentId,
        userId: data.userId,
        error,
      });
    });
  }

  private async recordProgress(
    data: FromIntentJobData,
    status: 'queued' | 'running' | 'succeeded' | 'failed' | 'blocked',
    attempt: number,
    assignedCommunityCount?: number,
    /** Run tallies, known only at a successful boundary; omitted leaves the stored counts alone. */
    counts?: { processedCommunityCount: number; possibleOverlapCount: number; conversationsStartedCount: number },
  ): Promise<void> {
    const record = (this.database as Partial<FromIntentDatabase>).recordIntentDiscoveryProgress;
    // Isolated tests and a rolling deploy may run before the adapter
    // has been updated. Production adapters always provide this.
    if (!record) return;
    await record.call(this.database, {
      intentId: data.intentId, userId: data.userId, status, attempt, assignedCommunityCount, ...counts,
    });
  }

  async processJob(name: string, data: FromIntentJobData, attempt = 1): Promise<void> {
    switch (name) {
      case 'discover_opportunities':
        await this.handleDiscover(data, attempt);
        break;
      default:
        this.logger.warn('Unknown job name', { name });
    }
  }

  private async handleDiscover(data: FromIntentJobData, attempt: number): Promise<void> {
    const { intentId, userId, networkIds } = data;
    // `this.database` is already `deps?.database ?? new ChatDatabaseAdapter()` and
    // setRuntimeDeps never replaces `database`, so this is the injected db when provided.
    const intent = await this.database.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('Intent not found, skipping admission', { intentId, userId });
      return;
    }
    if (intent.userId !== userId) {
      this.logger.warn('Intent owner mismatch, skipping admission', {
        intentId,
        expectedUserId: userId,
        actualUserId: intent.userId,
      });
      return;
    }
    if (intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      this.logger.info('Intent is not discoverable, skipping admission', {
        intentId,
        userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }

    const validNetworkIds = await this.getValidDiscoveryNetworkIds(intentId, userId, networkIds);

    // A trigger intent is authoritative for admission: omitted scope means all
    // of its still-valid assignments, never all owner memberships. Explicit
    // scope is narrowing-only. Any empty intersection must stop before the graph
    // or the evidence shadow can observe an unscoped run.
    if (validNetworkIds.length === 0) {
      await this.recordProgress(data, 'blocked', 0, 0);
      this.logger.warn('Intent has no valid discovery networks, skipping fail-closed', {
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
      });
      return;
    }

    await this.recordProgress(data, 'running', attempt, validNetworkIds.length);

    this.logger.info('Starting discovery', { intentId, userId, networkIds: validNetworkIds });

    const searchQuery = intent.payload;

    const invokeOpts = buildIntentDiscoveryTrigger({
      userId,
      searchQuery,
      networkIds: validNetworkIds,
      triggerIntentId: intentId,
    });

    // The graph's own summary is the only honest source for the owner-visible
    // tallies; it is null when the caller injected a graph (test path), in
    // which case the success write carries no counts at all.
    const summary = await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'FromIntent',
      errorLabel: 'from-intent',
      logContext: { intentId, userId },
    });

    // A successful graph is not enough to clear WARMING: assignment and
    // membership can change while it runs. Re-check the same authoritative
    // admission predicate immediately before the irreversible success stamp.
    const stampNetworkIds = await this.getValidDiscoveryNetworkIds(intentId, userId, networkIds);
    if (stampNetworkIds.length === 0) {
      const error = new Error('Intent discovery stamp precondition failed: no active assigned networks remain');
      this.logger.error('Discovery success stamp precondition violated', {
        event: 'intent_discovery_stamp_precondition_violation',
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
        error,
      });
      throw error;
    }

    // Discovery completed without throwing: stamp first-discovery success so
    // the read-side WARMING derivation clears immediately instead of waiting
    // out the 24-hour freshness window (IND-482). Failed runs throw above and
    // skipped runs return earlier, so neither reaches this stamp. Stamp
    // failures must not fail the (already successful) discovery job.
    try {
      await this.database.markIntentFirstDiscoverySucceeded(intentId);
    } catch (error) {
      this.logger.warn('Failed to stamp first-discovery success', {
        intentId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await this.recordProgress(data, 'succeeded', attempt, stampNetworkIds.length, summary ? {
      // The graph runs once across every valid network, so "processed" is the
      // set that was still valid at the success stamp — there is no per-community
      // boundary observable from here.
      processedCommunityCount: stampNetworkIds.length,
      possibleOverlapCount: summary.candidatesFound,
      // Each created opportunity enqueues a negotiation run, so this is a count
      // of conversations the run actually started.
      conversationsStartedCount: summary.opportunitiesCreated,
    } : undefined);

    // Lens C negotiation-evidence shadow (IND-433): fire-and-forget on its
    // own flag. Formerly triggered through the pool-discriminator mining hook;
    // the mining pass and its question enqueue are retired
    // (conversational-questions plan, "Retirements").
    void maybeRunNegotiationEvidenceShadow({
      source: 'from_intent',
      userId,
      intentId,
    }).catch(() => {});
  }

  /** Resolve the assignment + current-membership intersection used for both admission and stamping. */
  private async getValidDiscoveryNetworkIds(intentId: string, userId: string, networkIds?: string[]): Promise<string[]> {
    const [assignedNetworkIds, ownerMemberships] = await Promise.all([
      this.database.getNetworkIdsForIntent(intentId),
      this.database.getAssignmentNetworkMembershipsForUser(userId),
    ]);
    const activeOwnerNetworkIds = new Set(ownerMemberships.map((membership) => membership.networkId));
    const explicitNetworkIds = networkIds == null ? null : new Set(networkIds);
    return [...new Set(assignedNetworkIds)]
      .filter((networkId) => activeOwnerNetworkIds.has(networkId))
      .filter((networkId) => explicitNetworkIds == null || explicitNetworkIds.has(networkId))
      .sort();
  }

  /**
   * Same-intent overlap guard around discovery. Returns a release function
   * when this run owns the intent, or null when another run already holds it.
   */
  private async acquireIntentLock(data: FromIntentJobData): Promise<(() => Promise<void>) | null> {
    const token = crypto.randomUUID();
    try {
      if (!(await this.intentLock.tryAcquire(data.intentId, token, SAME_INTENT_LOCK_TTL_MS))) return null;
    } catch (error) {
      this.logger.warn('Same-intent lock unavailable; running unguarded', {
        intentId: data.intentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return async () => {};
    }
    return async () => {
      try {
        await this.intentLock.release(data.intentId, token);
      } catch (error) {
        this.logger.warn('Same-intent lock release failed; TTL will clear it', {
          intentId: data.intentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  }

  /**
   * Run discovery with the same-intent lock. If another run holds the lock,
   * wait and try once more.
   */
  private async runDiscover(data: FromIntentJobData): Promise<void> {
    for (;;) {
      const release = await this.acquireIntentLock(data);
      if (!release) {
      this.logger.info('Discovery already running for intent; deferring', {
        event: 'intent_discovery_overlap_deferred',
        intentId: data.intentId,
        userId: data.userId,
        retryInMs: this.sameIntentDeferDelayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, this.sameIntentDeferDelayMs));
      continue;
    }
    try {
      await this.processJob('discover_opportunities', data, 1);
    } catch (error) {
      await this.recordProgress(data, 'failed', 1);
      throw error;
    } finally {
      await release();
    }
    return;
    }
  }
}

export const intentDiscovery = new IntentDiscovery();
