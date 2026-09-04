// services/api/src/lib/opportunity/discovery.ts
import { log } from '../log';
import { background } from '../background';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { createOpportunityGraphDb, runOpportunityDiscovery, type OpportunityGraphDb } from './discovery.shared';
import { buildIntentDiscoveryTrigger, type DiscoveryGraphInvokeOptions } from './discovery-trigger.builders';
export type { DiscoveryGraphInvokeOptions } from './discovery-trigger.builders';
import { createIntentDiscoveryLock, type IntentDiscoveryLock } from './discovery.intent-lock';
/**
 * Same-intent overlap guard (see discovery.intent-lock.ts). The lock outlives
 * any plausible scan so it never lapses mid-run, yet a worker that dies
 * without releasing only blocks that intent's next run for this long.
 */
export const SAME_INTENT_LOCK_TTL_MS = 10 * 60 * 1000;
/** How long a run that found its intent already scanning waits before re-checking. */
export const SAME_INTENT_DEFER_DELAY_MS = 30 * 1000;
/**
 * Ceiling on total time a run spends waiting for the same-intent lock before
 * giving up. A contended intent with unbounded, repeated triggers could
 * otherwise keep a waiter re-checking forever with no cap and no visibility
 * beyond a log line. Two lock TTLs is enough for at least one full
 * acquire→(die without releasing)→TTL-expiry cycle to resolve the contention
 * before this gives up.
 */
export const MAX_SAME_INTENT_WAIT_MS = SAME_INTENT_LOCK_TTL_MS * 2;

export interface DiscoveryJobData {
  intentId: string;
  userId: string;
  networkIds?: string[];
  /** What triggered this run. `intent_resume` identifies lifecycle resume runs. */
  trigger?: 'intent_resume';
}

export type DiscoveryDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getNetworkIdsForIntent' | 'getAssignmentNetworkMembershipsForUser' | 'markIntentFirstDiscoverySucceeded'
>;

export interface DiscoveryDeps {
  database?: DiscoveryDatabase;
  invokeOpportunityGraph?: (opts: DiscoveryGraphInvokeOptions) => Promise<void>;
  /** Same-intent overlap guard; defaults to an in-process map. */
  intentLock?: IntentDiscoveryLock;
  /** Test hook: shortens the re-check delay of a deferred same-intent run. */
  sameIntentDeferDelayMs?: number;
  /** Test hook: shortens the total same-intent wait ceiling before giving up. */
  maxSameIntentWaitMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class IntentDiscovery {
  private readonly logger = log.job.from('IntentDiscovery');
  private readonly database: DiscoveryDatabase | ChatDatabaseAdapter;
  private readonly graphDb: OpportunityGraphDb;
  private readonly intentLock: IntentDiscoveryLock;
  private readonly sameIntentDeferDelayMs: number;
  private readonly maxSameIntentWaitMs: number;
  private deps: DiscoveryDeps | undefined;

  constructor(deps?: DiscoveryDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = createOpportunityGraphDb(this.database);
    this.intentLock = deps?.intentLock ?? createIntentDiscoveryLock();
    this.sameIntentDeferDelayMs = deps?.sameIntentDeferDelayMs ?? SAME_INTENT_DEFER_DELAY_MS;
    this.maxSameIntentWaitMs = deps?.maxSameIntentWaitMs ?? MAX_SAME_INTENT_WAIT_MS;
  }

  /**
   * Trigger the scan in the background, unbounded — one call per trigger, no
   * cap, no retry, no dedup.
   */
  async start(data: DiscoveryJobData): Promise<void> {
    background('discovery', () => this.runDiscover(data));
  }

  /**
   * Run one discovery scan to completion: the same-intent overlap guard, the
   * admission checks, and the graph itself. Exported at module level for
   * callers (CLI scripts) that need the scan to finish before they exit,
   * rather than firing it into the background.
   *
   * The wait for the same-intent lock is bounded by `maxSameIntentWaitMs`: a
   * contended intent with unbounded, repeated triggers must not keep a
   * waiter re-checking forever.
   */
  async runDiscover(data: DiscoveryJobData): Promise<void> {
    const waitDeadline = Date.now() + this.maxSameIntentWaitMs;
    for (;;) {
      const release = await this.acquireIntentLock(data);
      if (release) {
        try {
          await this.handleDiscover(data);
        } finally {
          await release();
        }
        return;
      }
      if (Date.now() >= waitDeadline) {
        this.logger.warn('Gave up waiting for the same-intent lock; scan skipped', {
          event: 'intent_discovery_overlap_wait_exhausted',
          intentId: data.intentId,
          userId: data.userId,
          waitedMs: this.maxSameIntentWaitMs,
        });
        throw new Error(`Gave up waiting for the same-intent discovery lock for ${data.intentId} after ${this.maxSameIntentWaitMs}ms`);
      }
      this.logger.info('Discovery already running for intent; waiting to retry', {
        event: 'intent_discovery_overlap_deferred',
        intentId: data.intentId,
        userId: data.userId,
        retryInMs: this.sameIntentDeferDelayMs,
      });
      await delay(this.sameIntentDeferDelayMs);
    }
  }

  private async handleDiscover(data: DiscoveryJobData): Promise<void> {
    const { intentId, userId, networkIds } = data;
    // `this.database` is already `deps?.database ?? new ChatDatabaseAdapter()`,
    // so this is the injected db when provided.
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
      this.logger.warn('Intent has no valid discovery networks, skipping fail-closed', {
        intentId,
        userId,
        requestedNetworkCount: networkIds?.length,
      });
      return;
    }

    this.logger.info('Starting discovery', { intentId, userId, networkIds: validNetworkIds });

    const searchQuery = intent.payload;

    const invokeOpts = buildIntentDiscoveryTrigger({
      userId,
      searchQuery,
      networkIds: validNetworkIds,
      triggerIntentId: intentId,
    });

    await runOpportunityDiscovery({
      graphDb: this.graphDb,
      deps: this.deps,
      invokeOpts,
      logger: this.logger,
      label: 'Discovery',
      errorLabel: 'discovery',
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
    // failures must not fail the (already successful) discovery run.
    try {
      await this.database.markIntentFirstDiscoverySucceeded(intentId);
    } catch (error) {
      this.logger.warn('Failed to stamp first-discovery success', {
        intentId,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
   * Same-intent overlap guard around a scan. Discovery is unbounded and runs
   * concurrently for different signals; a second run for one already-scanning
   * intent would otherwise start alongside it. Returns a release function when
   * this run owns the intent, or null when another run already holds it.
   * Fails open: the lock only saves provider budget (persistence tolerates
   * overlap), so a lock error must not fail a scan.
   */
  private async acquireIntentLock(data: DiscoveryJobData): Promise<(() => Promise<void>) | null> {
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
}

export const intentDiscovery = new IntentDiscovery();

/**
 * Run one discovery scan to completion. For callers (CLI scripts) that need
 * the scan to finish before they exit, rather than firing it via `start`.
 */
export function runDiscovery(data: DiscoveryJobData): Promise<void> {
  return intentDiscovery.runDiscover(data);
}
