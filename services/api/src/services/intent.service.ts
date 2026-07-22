import { log } from '../lib/log';
import { IntentGraphFactory } from '@indexnetwork/protocol';
import type { IntentGraphDatabase } from '@indexnetwork/protocol';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentQueue } from '../queues/intent.queue';
import { IntentEvents } from '../events/intent.event';

const logger = log.service.from("IntentService");

/** Stable typed failure for proposal assignment to a network the owner no longer belongs to. */
export class IntentNetworkMembershipError extends Error {
  readonly code = 'network_membership_required' as const;

  constructor(readonly networkId: string) {
    super('You are not a current member of this network');
    this.name = 'IntentNetworkMembershipError';
  }
}

/**
 * IntentService
 *
 * Manages intent processing through the Intent Graph and CRUD operations.
 * Uses IntentDatabaseAdapter for database operations.
 * Uses IntentGraphFactory for graph-based intent processing.
 *
 * RESPONSIBILITIES:
 * - Process intents through Intent Graph
 * - Extract, verify, reconcile, and execute intent actions
 * - Intent CRUD operations (list, get, archive)
 */
export class IntentService {
  private db: IntentGraphDatabase;
  private factory: IntentGraphFactory;
  private adapter: IntentDatabaseAdapter;
  private embedder: EmbedderAdapter;
  private proposalQueue: Pick<typeof intentQueue, 'addGenerateHydeJob'>;
  private emitProposalCreated: (intentId: string, userId: string) => void;

  /**
   * @param deps - Optional dependency overrides for focused service tests.
   */
  constructor(deps?: {
    adapter?: IntentDatabaseAdapter;
    embedder?: EmbedderAdapter;
    proposalQueue?: Pick<typeof intentQueue, 'addGenerateHydeJob'>;
    emitProposalCreated?: (intentId: string, userId: string) => void;
  }) {
    this.adapter = deps?.adapter ?? intentDatabaseAdapter;
    this.db = this.adapter;
    this.embedder = deps?.embedder ?? new EmbedderAdapter();
    this.proposalQueue = deps?.proposalQueue ?? intentQueue;
    this.emitProposalCreated = deps?.emitProposalCreated ?? ((intentId, userId) => IntentEvents.onCreated(intentId, userId));
    this.factory = new IntentGraphFactory(this.db, this.embedder, intentQueue);
  }

  /**
   * Generate an embedding for the given text, falling back to a zero vector if
   * embedding generation fails. The failure is logged with the supplied message
   * and context so the intent can still be created.
   */
  private async generateEmbeddingOrZero(
    text: string,
    failureMessage: string,
    logContext: Record<string, unknown>,
  ): Promise<number[]> {
    const EMBEDDING_DIMS = 2000;
    try {
      return (await this.embedder.generate(text)) as number[];
    } catch (err) {
      logger.warn(failureMessage, { ...logContext, error: err });
      return new Array(EMBEDDING_DIMS).fill(0);
    }
  }

  /**
   * Process user input through the Intent Graph.
   * Extracts, verifies, reconciles, and executes intent actions.
   *
   * @param userId - The user ID
   * @param userProfile - The user profile as JSON string
   * @param content - Optional input content to process
   * @returns Graph execution result
   */
  async processIntent(
    userId: string,
    userProfile: string,
    content?: string
  ): Promise<Record<string, unknown>> {
    logger.verbose('Processing intent', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke(
      {
        userId,
        userProfile,
        inputContent: content,
      },
      { recursionLimit: 100 }
    );

    return result;
  }

  /**
   * List intents for a user with pagination and filters.
   *
   * @param userId - The user ID
   * @param options - Pagination and filter options
   * @returns Intents and pagination metadata
   */
  async listIntents(userId: string, options: {
    page?: number;
    limit?: number;
    archived?: boolean;
    sourceType?: string;
  } = {}) {
    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, Math.max(1, options.limit || 20));
    const archived = options.archived ?? false;

    logger.verbose('Listing intents', { userId, page, limit, archived });

    const { rows, total, totalWaitingOpportunities } = await this.adapter.listIntents(userId, {
      page,
      limit,
      archived,
      sourceType: options.sourceType,
    });

    return {
      intents: rows.map((intent) => ({
        ...intent,
        status: intent.status ?? 'ACTIVE' as const,
      })),
      totalWaitingOpportunities,
      pagination: {
        current: page,
        total: Math.ceil(total / limit),
        count: rows.length,
        totalCount: total,
      },
    };
  }

  /**
   * Resolve an intent identifier (full UUID or short prefix) to a full UUID.
   * @param idOrPrefix - Full UUID or short hex prefix
   * @param userId - The user ID (for ownership scoping)
   * @param networkScopeId - Optional bound-agent network constraint for prefix lookup.
   * @returns Resolved ID, or error object with status
   */
  async resolveId(
    idOrPrefix: string,
    userId: string,
    networkScopeId?: string | null,
  ): Promise<{ id: string } | { error: string; status: number }> {
    const result = await this.adapter.resolveIntentId(idOrPrefix, userId, networkScopeId);
    if (!result) {
      return { error: 'Intent not found', status: 404 };
    }
    if ('ambiguous' in result) {
      return { error: 'Ambiguous ID prefix, please provide more characters', status: 409 };
    }
    return { id: result.id };
  }

  /**
   * Get a single intent by ID.
   *
   * @param intentId - The intent ID
   * @param userId - The user ID (for ownership verification)
   * @returns Intent record or null if not found or unauthorized
   */
  async getById(intentId: string, userId: string) {
    logger.verbose('Getting intent by ID', { intentId, userId });

    const intent = await this.adapter.getIntentById(intentId, userId);
    return intent ? { ...intent, status: intent.status ?? 'ACTIVE' as const } : null;
  }

  /**
   * Record an explicit human visit to an owned intent page.
   *
   * @param intentId - Full intent ID.
   * @param userId - Authenticated owner.
   * @returns Monotonic visit time, or null when missing/foreign.
   */
  async visit(intentId: string, userId: string): Promise<Date | null> {
    return this.adapter.visitIntent(intentId, userId);
  }

  /**
   * Pause or resume an owned intent without using the generic content update
   * path. Resume emission is awaited on every idempotent success so a caller
   * can retry a failed enqueue; the lifecycle-version job id deduplicates
   * successful retries.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @param status - Requested lifecycle status.
   * @param networkScopeId - Optional bound-agent network constraint.
   * @returns Atomic adapter outcome.
   */
  async transitionStatus(
    intentId: string,
    userId: string,
    status: 'ACTIVE' | 'PAUSED',
    networkScopeId?: string | null,
    expectedUpdatedAtMs?: number,
  ) {
    logger.verbose('Transitioning intent lifecycle', { intentId, userId, status, networkScopeId });
    const result = await this.adapter.transitionIntentLifecycle({
      intentId,
      userId,
      status,
      networkScopeId,
      expectedUpdatedAtMs,
    });
    if (result.kind !== 'success') return result;

    if (status === 'PAUSED') {
      if (result.changed) IntentEvents.onPaused(intentId, userId, result.lifecycleVersionMs);
      return result;
    }

    try {
      await IntentEvents.onResumed(intentId, userId, result.lifecycleVersionMs);
      return result;
    } catch (error) {
      logger.warn('Failed to enqueue resumed intent discovery', {
        intentId,
        userId,
        lifecycleVersionMs: result.lifecycleVersionMs,
        changed: result.changed,
        error,
      });

      if (!result.changed) {
        return {
          kind: 'enqueue_failed' as const,
          id: result.id,
          status: result.status,
          lifecycleVersionMs: result.lifecycleVersionMs,
          retryable: true as const,
        };
      }

      let authoritative: { status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED'; lifecycleVersionMs: number } | null = null;
      try {
        authoritative = await this.adapter.compensateFailedResume({
          intentId,
          userId,
          lifecycleVersionMs: result.lifecycleVersionMs,
          networkScopeId,
        });
      } catch (compensationError) {
        logger.error('Failed to compensate resumed intent after enqueue failure', {
          intentId,
          userId,
          lifecycleVersionMs: result.lifecycleVersionMs,
          compensationError,
        });
      }

      return {
        kind: 'enqueue_failed' as const,
        id: result.id,
        status: authoritative?.status ?? result.status,
        lifecycleVersionMs: authoritative?.lifecycleVersionMs ?? result.lifecycleVersionMs,
        retryable: true as const,
      };
    }
  }

  /**
   * Create an intent directly from a confirmed chat proposal.
   * Bypasses the full intent graph (no LLM re-inference/verification).
   * Idempotent under concurrent confirmation: the adapter serializes one exact
   * user + proposal pair and returns the transaction winner to every caller.
   * Generates embedding, inserts into DB, optionally associates with index, and enqueues HyDE job.
   * Embedder and queue failures are logged but do not abort creation.
   *
   * @param userId - The user ID
   * @param description - The pre-verified intent description
   * @param proposalId - The proposal ID (stored as sourceId for status tracking)
   * @param networkId - Optional index to associate the intent with
   * @returns The created or existing intent record (at least { id }).
   */
  async createFromProposal(userId: string, description: string, proposalId: string, networkId?: string) {
    logger.verbose('Creating intent from proposal', { userId, proposalId });

    const existing = await this.adapter.getIntentBySourceId(proposalId, userId);
    if (existing) return existing;

    // Cheap advisory preflight avoids embedding/transaction/queue/event work
    // for clear denials. confirmProposalIntent still re-checks membership under
    // its advisory lock and remains the final race-safe authority.
    if (networkId && !await this.adapter.isNetworkMember(networkId, userId)) {
      throw new IntentNetworkMembershipError(networkId);
    }

    const embedding = await this.generateEmbeddingOrZero(
      description,
      'Embedding generation failed (intent will be created with zero vector)',
      { userId, proposalId },
    );

    const intentData = {
      userId,
      payload: description,
      embedding,
      sourceType: 'discovery_form' as const,
      sourceId: proposalId,
    };
    const confirmation = await this.adapter.confirmProposalIntent(intentData, networkId);
    if (confirmation.kind === 'membership_required') {
      if (!networkId) throw new Error('Unexpected membership requirement without a network');
      throw new IntentNetworkMembershipError(networkId);
    }
    if (confirmation.kind === 'existing') return confirmation.intent;

    const created = confirmation.intent;
    try {
      await this.proposalQueue.addGenerateHydeJob({
        intentId: created.id,
        userId,
        ...(networkId ? { scopeType: 'network' as const, scopeId: networkId } : {}),
      });
    } catch (err) {
      logger.warn('Failed to enqueue HyDE job', { intentId: created.id, userId, error: err });
    }

    this.emitProposalCreated(created.id, userId);

    return created;
  }

  /**
   * Create an intent for seed data with embedding and HyDE, without running the full intent graph
   * or enqueueing opportunity discovery. Used by db-seed to create test intents quickly without
   * LLM inference/verification or matching test users.
   *
   * @param userId - The user ID
   * @param description - The intent text (payload)
   * @returns The created intent record
   */
  async createIntentForSeed(userId: string, description: string): Promise<{ id: string }> {
    logger.verbose('Creating intent for seed', { userId });

    const embedding = await this.generateEmbeddingOrZero(
      description,
      'Embedding failed (intent created with zero vector)',
      { userId },
    );

    const sourceId = crypto.randomUUID();
    const created = await this.adapter.createIntent({
      userId,
      payload: description,
      embedding,
      sourceType: 'discovery_form',
      sourceId,
    });

    try {
      await intentQueue.runGenerateHydeSync(
        { intentId: created.id, userId },
        { skipOpportunity: true }
      );
    } catch (err) {
      logger.warn('HyDE sync failed for seed intent', {
        intentId: created.id,
        userId,
        error: err,
      });
    }

    return { id: created.id };
  }

  /**
   * Look up intents by proposal IDs. Returns the intent id and archivedAt for each
   * proposalId that has a matching intent record.
   *
   * @param userId - The user ID
   * @param proposalIds - Array of proposal IDs to check
   * @returns Map of proposalId -> { intentId, archivedAt }
   */
  async getProposalStatuses(userId: string, proposalIds: string[]): Promise<Record<string, { intentId: string; archivedAt: string | null }>> {
    if (proposalIds.length === 0) return {};

    const result: Record<string, { intentId: string; archivedAt: string | null }> = {};
    const intents = await Promise.all(
      proposalIds.map((pid) => this.adapter.getIntentBySourceId(pid, userId)),
    );
    proposalIds.forEach((pid, i) => {
      const intent = intents[i];
      if (intent) {
        result[pid] = {
          intentId: intent.id,
          archivedAt: intent.archivedAt?.toISOString() ?? null,
        };
      }
    });
    return result;
  }

  /**
   * Archive an intent.
   *
   * @param intentId - The intent ID
   * @param userId - The user ID (for ownership verification)
   * @returns Result with success flag and optional error
   */
  async archive(intentId: string, userId: string) {
    logger.verbose('Archiving intent', { intentId, userId });

    // Verify ownership
    const owned = await this.adapter.isOwnedByUser(intentId, userId);
    if (!owned) {
      return { success: false, error: 'Intent not found or unauthorized' };
    }

    const result = await this.adapter.archiveIntent(intentId);
    if (!result.success) return result;

    try {
      await this.adapter.deleteIntentIndexAssociations(intentId);
    } catch (err) {
      logger.error('Failed to delete intent-network associations', { intentId, error: err });
    }

    try {
      const expiredCount = await this.adapter.expireOpportunitiesByIntentActor(intentId);
      if (expiredCount > 0) {
        logger.verbose('Expired opportunities referencing intent', { intentId, expiredCount });
      }
    } catch (err) {
      logger.error('Failed to expire opportunities', { intentId, error: err });
    }

    try {
      await intentQueue.addDeleteHydeJob({ intentId });
    } catch (err) {
      logger.error('Failed to enqueue HyDE deletion', { intentId, error: err });
    }

    IntentEvents.onArchived(intentId, userId);

    return result;
  }
}

export const intentService = new IntentService();
