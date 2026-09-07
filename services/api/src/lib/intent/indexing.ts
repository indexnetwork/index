import { log } from '../log';
import { background } from '../background';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { buildProfileFromUser } from '../../adapters/database.shared';
import { HydeGraphFactory, HydeGenerator, LensInferrer, deriveDiscoveryNetworkIds } from '@indexnetwork/protocol';
import type { AssignmentNetworkMembership, HydeGraphDatabase, IntentFollowUp, ToolScopeType } from '@indexnetwork/protocol';
import { intentDiscovery } from '../opportunity/discovery';

/** Payload for jobs that generate HyDE documents for an intent. */
export interface IntentJobData {
  intentId: string;
  userId: string;
  /** Focused request scope type. Currently only `network` is supported. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. When `scopeType === 'network'`, this is the focused network id. */
  scopeId?: string;
  /** @deprecated Use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

/** Payload for jobs that delete HyDE documents for an intent. */
export interface IntentDeleteData {
  intentId: string;
}

type IntentJobScope = { scopeType?: ToolScopeType; scopeId?: string };

function resolveIntentJobScope(data: { scopeType?: ToolScopeType; scopeId?: string; networkScopeId?: string } | undefined): IntentJobScope {
  if (data?.scopeType === 'network' && data.scopeId?.trim()) {
    return { scopeType: 'network', scopeId: data.scopeId.trim() };
  }
  const legacyScopeId = data?.networkScopeId?.trim();
  return legacyScopeId ? { scopeType: 'network', scopeId: legacyScopeId } : {};
}

function deriveIntentDiscoveryNetworkIds(memberships: AssignmentNetworkMembership[], scope: IntentJobScope): { networkIds?: string[] } {
  const networkIds = deriveDiscoveryNetworkIds({ memberships, ...scope });
  return scope.scopeType && scope.scopeId ? { networkIds } : {};
}

/** Minimal database interface for intent follow-up (used when deps provided in tests). */
export type IntentIndexingDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getAssignmentNetworkMembershipsForUser' | 'getAssignmentNetworkIdsForUser' | 'deleteHydeDocumentsForSource' | 'getHydeDocumentsForSource' | 'getProfile' | 'getActiveIntents'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database, HyDE invocation, or opportunity job enqueue.
 */
export interface IntentIndexingDeps {
  database?: IntentIndexingDatabase;
  /** Resolve the user's global user_context paragraph for HyDE enrichment (generate-if-empty). */
  invokeHyde?: (opts: {
    sourceText: string;
    sourceType: string;
    sourceId: string;
    forceRegenerate: boolean;
    profileContext?: string;
  }) => Promise<void>;
  startDiscovery?: (data: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown>;
}

/**
 * The host side of {@link IntentFollowUp}: the work the intent graph starts
 * once an intent is written.
 *
 * Generation runs the HyDE graph and starts opportunity discovery; deletion
 * removes the intent's HyDE documents. Network membership is written by the
 * intent graph from the ids the owner chose, so nothing is assigned here.
 *
 * @remarks
 * `generateHyde`/`deleteHyde`/`resumeDiscovery` are all fire-and-forget: each
 * triggers its handler via {@link background} (directly, or through
 * {@link intentDiscovery}'s own background trigger), unbounded, with no retry
 * and no dedup.
 */
export class IntentIndexing implements IntentFollowUp {
  /**
   * Run HyDE generation for an intent (implements {@link IntentFollowUp}). Fire-and-forget.
   * @param data - intentId, userId, and optional scope envelope. When scopeType/scopeId
   *   is set, indexing is restricted to the focused network plus the user's personal networks.
   */
  generateHyde(data: IntentJobData): Promise<unknown> {
    background('intent', () => this.runHydeGeneration(data));
    return Promise.resolve();
  }

  /**
   * Delete HyDE documents for an intent (implements {@link IntentFollowUp}). Fire-and-forget.
   * @param data - intentId
   */
  deleteHyde(data: { intentId: string }): Promise<unknown> {
    background('intent', () => this.runHydeDeletion(data));
    return Promise.resolve();
  }

  /**
   * Start discovery for an intent resumed from PAUSED back to ACTIVE
   * (implements {@link IntentFollowUp}). `start` awaits only the 'queued'
   * progress write before triggering the scan in the background — a failure
   * there (not the scan itself) is the only thing this can still reject with.
   */
  resumeDiscovery(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return intentDiscovery.start({ intentId: data.intentId, userId: data.userId, trigger: 'intent_resume' });
  }

  private readonly logger = log.job.from('IntentJob');
  private readonly hydeLogger = log.job.from('IntentJob:Hyde');
  private readonly reconcileLogger = log.job.from('IntentJob:Reconcile');
  private readonly database: IntentIndexingDatabase | ChatDatabaseAdapter;
  private readonly graphDb: HydeGraphDatabase;
  private readonly deps: IntentIndexingDeps | undefined;

  /**
   * @param deps - Optional overrides for database and HyDE/opportunity calls (for tests).
   */
  constructor(deps?: IntentIndexingDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.graphDb = (this.database as ChatDatabaseAdapter) as unknown as HydeGraphDatabase;
    // When deps is omitted, default adapter implements the same interface.
  }

  private async getAssignmentMemberships(userId: string): Promise<AssignmentNetworkMembership[]> {
    const db = this.deps?.database ?? this.database;
    if (typeof db.getAssignmentNetworkMembershipsForUser === 'function') {
      return db.getAssignmentNetworkMembershipsForUser(userId);
    }
    const networkIds = await db.getAssignmentNetworkIdsForUser(userId);
    return networkIds.map((networkId) => ({ networkId }));
  }

  /**
   * Run HyDE generation for an intent synchronously (e.g. during db-seed).
   * When skipOpportunity is true, does not start opportunity discovery — use for seed to avoid matching test users.
   * @param data - intentId and userId
   * @param options - skipOpportunity: if true, do not start opportunity discovery
   */
  async runGenerateHydeSync(
    data: IntentJobData,
    options?: { skipOpportunity?: boolean }
  ): Promise<void> {
    const startDiscovery = options?.skipOpportunity
      ? async () => {}
      : (this.deps?.startDiscovery ?? ((d: { intentId: string; userId: string; networkIds?: string[] }) => intentDiscovery.start(d)));
    await this.runHydeGeneration(data, { startDiscovery });
  }

  async runHydeGeneration(
    data: IntentJobData,
    overrides?: { startDiscovery?: (d: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown> }
  ): Promise<void> {
    const { intentId, userId } = data;
    const scope = resolveIntentJobScope(data);
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.hydeLogger.warn('Intent not found, skipping admission', { intentId, userId });
      return;
    }
    if (
      intent.userId !== userId ||
      intent.archivedAt ||
      (intent.status != null && intent.status !== 'ACTIVE')
    ) {
      this.hydeLogger.info('Intent is not eligible for HyDE generation, skipping admission', {
        intentId,
        userId,
        actualUserId: intent.userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }
    this.hydeLogger.info('Starting HyDE generation', { intentId, userId });
    this.hydeLogger.debug('Intent payload preview', { intentId, payload: intent.payload?.slice(0, 80) });
    // Fetch discoverer profile (users row) + active intents for HyDE context (best-effort).
    let profileContext: string | undefined;
    try {
      const [profile, activeIntents] = await Promise.all([
        buildProfileFromUser(userId),
        db.getActiveIntents(userId),
      ]);
      const lines: string[] = [];
      if (profile) {
        const id = profile.identity;
        if (id.name?.trim()) lines.push(id.name.trim());
        if (id.bio?.trim()) lines.push(id.bio.trim());
        if (id.location?.trim()) lines.push(id.location.trim());
      }
      if (activeIntents?.length) {
        const capped = activeIntents.slice(0, 5);
        lines.push('');
        lines.push('Active intents:');
        for (const ai of capped) {
          lines.push(`- ${ai.payload}`);
        }
      }
      if (lines.length > 0) {
        profileContext = lines.join('\n');
      }
    } catch (ctxErr) {
      this.hydeLogger.warn('Failed to fetch discoverer context for HyDE, proceeding without', { intentId, userId, error: ctxErr });
    }

    try {
      if (this.deps?.invokeHyde) {
        await this.deps.invokeHyde({
          sourceText: intent.payload,
          sourceType: 'intent',
          sourceId: intentId,
          forceRegenerate: true,
          profileContext,
        });
      } else {
        const embedder = new EmbedderAdapter();
        const cache = new RedisCacheAdapter();
        const inferrer = new LensInferrer();
        const generator = new HydeGenerator();
        const hydeGraph = new HydeGraphFactory(this.graphDb, embedder, cache, inferrer, generator).createGraph();
        await hydeGraph.invoke({
          sourceText: intent.payload,
          sourceType: 'intent',
          sourceId: intentId,
          forceRegenerate: true,
          profileContext,
        });
      }
    } catch (error) {
      this.hydeLogger.error('HyDE generation failed', {
        event: 'intent_hyde_generation_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
    this.hydeLogger.info('HyDE generation complete, starting opportunity discovery', { intentId, userId });
    const startDiscovery =
      overrides?.startDiscovery ??
      this.deps?.startDiscovery ??
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => intentDiscovery.start(d));
    // Carry only the focused network scope into discovery. Assignment writes may
    const discoveryScope: { networkIds?: string[] } = await (async () => {
      try {
        const assignmentMemberships = await this.getAssignmentMemberships(userId);
        return deriveIntentDiscoveryNetworkIds(assignmentMemberships, scope);
      } catch (err) {
        this.hydeLogger.warn('Failed to resolve assignment memberships for discovery scope, falling back to focused scope', { intentId, userId, error: err });
        return scope.scopeType && scope.scopeId ? { networkIds: [scope.scopeId] } : {};
      }
    })();
    try {
      await startDiscovery({
        intentId,
        userId,
        ...discoveryScope,
      });
    } catch (error) {
      this.hydeLogger.error('Discovery start failed', {
        event: 'intent_discovery_enqueue_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Re-run HyDE generation for an active intent whose HyDE artifact is missing.
   */
  async reconcileOrphanedIntent(data: IntentJobData): Promise<void> {
    const { intentId, userId } = data;
    const db = this.deps?.database ?? this.database;
    const scope = resolveIntentJobScope(data);
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent || intent.userId !== userId || intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      this.reconcileLogger.info('Orphan reconciliation skipped by lifecycle admission', {
        event: 'intent_orphan_reconciliation_skipped',
        intentId,
        userId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        reason: !intent ? 'missing' : intent.userId !== userId ? 'owner_mismatch' : intent.archivedAt ? 'archived' : 'not_active',
      });
      return;
    }

    const hydeDocuments = await db.getHydeDocumentsForSource('intent', intentId);
    if (hydeDocuments.length > 0) {
      this.reconcileLogger.info('Orphan reconciliation already satisfied', {
        event: 'intent_orphan_reconciliation_noop',
        intentId,
        userId,
        hydeDocumentCount: hydeDocuments.length,
      });
      return;
    }

    this.reconcileLogger.warn('Orphan reconciliation re-admitting intent', {
      event: 'intent_orphan_reconciliation_started',
      intentId,
      userId,
      scopeType: scope.scopeType,
      scopeId: scope.scopeId,
      hydeDocumentCount: hydeDocuments.length,
    });
    await this.runHydeGeneration({ intentId, userId, ...scope });
  }

  async runHydeDeletion(data: IntentDeleteData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    await db.deleteHydeDocumentsForSource('intent', intentId);
    this.hydeLogger.verbose('Deleted HyDE documents for intent', { intentId });
  }
}

/** Singleton intent follow-up. Use for triggering handlers and background work. */
export const intentIndexing = new IntentIndexing();

/** Re-admit an active intent whose HyDE artifact is missing. */
export function reconcileOrphanedIntent(data: IntentJobData): Promise<void> {
  return intentIndexing.reconcileOrphanedIntent(data);
}
