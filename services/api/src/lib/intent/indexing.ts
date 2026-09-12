import { Intents, deriveDiscoveryNetworkIds } from '@indexnetwork/protocol';
import type { AssignmentNetworkMembership, IntentFollowUp, ScopeType } from '@indexnetwork/protocol';

import { log } from '../log';
import { background } from '../background';
import { ChatDatabaseAdapter, intentDatabaseAdapter } from '../../adapters/database.adapter';
import { intentDiscovery } from '../opportunity/discovery';

/** Payload for jobs that start discovery for an intent. */
export interface IntentJobData {
  intentId: string;
  userId: string;
  /** Focused request scope type. Currently only `network` is supported. */
  scopeType?: ScopeType;
  /** Focused request scope id. When `scopeType === 'network'`, this is the focused network id. */
  scopeId?: string;
  /** @deprecated Use `scopeType: 'network'` + `scopeId`. */
  networkScopeId?: string;
}

type IntentJobScope = { scopeType?: ScopeType; scopeId?: string };

function resolveIntentJobScope(data: { scopeType?: ScopeType; scopeId?: string; networkScopeId?: string } | undefined): IntentJobScope {
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
  'getIntentForIndexing' | 'getAssignmentNetworkMembershipsForUser' | 'getAssignmentNetworkIdsForUser'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database or opportunity job enqueue.
 */
export interface IntentIndexingDeps {
  database?: IntentIndexingDatabase;
  startDiscovery?: (data: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown>;
}

/**
 * The host side of {@link IntentFollowUp}: the work the intent graph starts
 * once an intent is written.
 *
 * Saved/resumed intents start discovery. Network membership is written by the
 * intent graph from the ids the owner chose, so nothing is assigned here.
 *
 * @remarks
 * `onIntentSaved`/`onIntentArchived`/`onIntentResumed` are all fire-and-forget: each
 * triggers its handler via {@link background} (directly, or through
 * {@link intentDiscovery}'s own background trigger), unbounded, with no retry
 * and no dedup.
 */
export class IntentIndexing implements IntentFollowUp {
  /**
   * Rescore final revisions after saving without applying admission or lifecycle changes.
   * @param data - Saved intent, owner, and the exact final text.
   * @returns Immediately after scheduling best-effort metadata work.
   */
  scoreIntent(data: { intentId: string; userId: string; payload: string }): Promise<unknown> {
    background('intent-score', async () => {
      const metadata = await new Intents().scoreIntent(data.payload);
      await intentDatabaseAdapter.updateSemanticMetadata(data.intentId, data.userId, data.payload, metadata);
    });
    return Promise.resolve();
  }

  /**
   * Start discovery for a saved intent (implements {@link IntentFollowUp}). Fire-and-forget.
   * @param data - intentId, userId, and optional scope envelope. When scopeType/scopeId
   *   is set, indexing is restricted to the focused network plus the user's personal networks.
   */
  onIntentSaved(data: IntentJobData): Promise<unknown> {
    background('intent', () => this.startDiscovery(data));
    return Promise.resolve();
  }

  /**
   * No matching artifacts remain to clean up after archival.
   * @param _data - intentId
   */
  onIntentArchived(_data: { intentId: string }): Promise<unknown> {
    return Promise.resolve();
  }

  /**
   * Start discovery for an intent resumed from PAUSED back to ACTIVE
   * (implements {@link IntentFollowUp}). `start` awaits only the 'queued'
   * progress write before triggering the scan in the background — a failure
   * there (not the scan itself) is the only thing this can still reject with.
   */
  onIntentResumed(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return intentDiscovery.start({ intentId: data.intentId, userId: data.userId, trigger: 'intent_resume' });
  }

  private readonly logger = log.job.from('IntentJob');
  private readonly database: IntentIndexingDatabase;
  private readonly deps: IntentIndexingDeps | undefined;

  /**
   * @param deps - Optional overrides for database and opportunity calls (for tests).
   */
  constructor(deps?: IntentIndexingDeps) {
    this.deps = deps;
    this.database = deps?.database ?? new ChatDatabaseAdapter();
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
   * Admit a saved intent and start opportunity discovery.
   * @param data - intentId, userId, and optional focused network scope
   */
  async startDiscovery(
    data: IntentJobData,
    overrides?: { startDiscovery?: (d: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown> }
  ): Promise<void> {
    const { intentId, userId } = data;
    const scope = resolveIntentJobScope(data);
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.logger.warn('Intent not found, skipping admission', { intentId, userId });
      return;
    }
    if (
      intent.userId !== userId ||
      intent.archivedAt ||
      (intent.status != null && intent.status !== 'ACTIVE')
    ) {
      this.logger.info('Intent is not eligible for discovery, skipping admission', {
        intentId,
        userId,
        actualUserId: intent.userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }

    const startDiscovery =
      overrides?.startDiscovery ??
      this.deps?.startDiscovery ??
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => intentDiscovery.start(d));
    const discoveryScope: { networkIds?: string[] } = await (async () => {
      try {
        const assignmentMemberships = await this.getAssignmentMemberships(userId);
        return deriveIntentDiscoveryNetworkIds(assignmentMemberships, scope);
      } catch (err) {
        this.logger.warn('Failed to resolve assignment memberships for discovery scope, falling back to focused scope', { intentId, userId, error: err });
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
      this.logger.error('Discovery start failed', {
        event: 'intent_discovery_enqueue_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
  }
}

/** Singleton intent follow-up. Use for triggering handlers and background work. */
export const intentIndexing = new IntentIndexing();
