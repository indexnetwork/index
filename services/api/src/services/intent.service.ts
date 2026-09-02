import { log } from '../lib/log';
import { Intents } from '@indexnetwork/protocol';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { IntentProposalDatabaseAdapter, intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import { intentIndexing } from '../lib/intent/indexing';
import { IntentEvents } from '../events/intent.event';
import { indexExistingIntentForSeed as indexSeedIntent } from '../lib/intent/seed-indexer';

const logger = log.service.from("IntentService");

/** Stable typed failure for proposal assignment to a network the owner no longer belongs to. */
export class IntentNetworkMembershipError extends Error {
  readonly code = 'network_membership_required' as const;

  constructor(readonly networkId: string) {
    super('You are not a current member of this network');
    this.name = 'IntentNetworkMembershipError';
  }
}

export type IntentProposalConfirmationErrorCode =
  | 'proposal_not_found'
  | 'proposal_expired'
  | 'proposal_consumed'
  | 'proposal_payload_mismatch'
  | 'proposal_edit_rejected'
  | 'proposal_analysis_missing';

/** Stable typed failure for an invalid authoritative proposal confirmation. */
export class IntentProposalConfirmationError extends Error {
  constructor(readonly code: IntentProposalConfirmationErrorCode) {
    super({
      proposal_not_found: 'Intent proposal was not found',
      proposal_expired: 'Intent proposal has expired',
      proposal_consumed: 'Intent proposal has already been consumed',
      proposal_payload_mismatch: 'Intent proposal payload does not match the authoritative record',
      proposal_edit_rejected: 'Edited intent proposal did not pass verification',
      proposal_analysis_missing: 'Intent proposal has no valid verifier analysis',
    }[code]);
    this.name = 'IntentProposalConfirmationError';
  }
}

/**
 * A confirmation committed its intent row but could not obtain acknowledgement
 * from the post-transaction indexing admission queue. Callers must retry the
 * same confirmation; replay re-attempts admission without creating a second
 * intent row.
 */
export class IntentAdmissionEnqueueError extends Error {
  readonly code = 'intent_admission_enqueue_failed' as const;

  constructor(readonly intentId: string, cause: unknown) {
    super('Intent confirmation was persisted, but indexing admission could not be queued');
    this.name = 'IntentAdmissionEnqueueError';
    this.cause = cause;
  }
}

/** Minimal shape of a compiled protocol graph, narrowed to what this service invokes. */
export interface IntentGraphRunner {
  invoke(input: Record<string, unknown>, options?: { recursionLimit?: number }): Promise<Record<string, unknown>>;
}

/** The `transition` action's outcome, as reported on `intentGraph`'s `transitionResult` field. */
export type IntentTransitionOutcome =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | null; archived: boolean }
  | { kind: 'enqueue_failed'; id: string; status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED'; lifecycleVersionMs: number };

/** The `confirm` action's outcome, as reported on `intentGraph`'s `confirmResult` field. */
export type IntentConfirmOutcome =
  | { kind: 'created' | 'replay'; intentId: string }
  | { kind: 'missing' | 'expired' | 'consumed' | 'payload_mismatch' | 'analysis_missing' | 'proposal_edit_rejected' }
  | { kind: 'membership_required'; networkId: string }
  | { kind: 'admission_enqueue_failed'; intentId: string };

/**
 * IntentService
 *
 * Intent CRUD (list, get, archive, pause/resume, confirm-from-proposal) all
 * route through the compiled Intent Graph — the single write path for intent
 * mutations. Reads (list/get/resolve) go straight to the adapter.
 *
 * RESPONSIBILITIES:
 * - Intent reads (list, get, resolve, visit)
 * - Route every intent mutation through the Intent Graph
 * - Seed-only fast paths that intentionally bypass the graph (see createIntentForSeed)
 */
export class IntentService {
  private intentGraph: IntentGraphRunner;
  private adapter: IntentDatabaseAdapter;
  private proposalAdapter: IntentProposalDatabaseAdapter;
  private embedder: EmbedderAdapter;
  private seedIndexer: Pick<typeof intentIndexing, 'runGenerateHydeSync'>;
  private emitProposalCreated: (intentId: string, userId: string) => void;

  /**
   * @param deps - Optional dependency overrides for focused service tests.
   */
  constructor(deps?: {
    adapter?: IntentDatabaseAdapter;
    proposalAdapter?: IntentProposalDatabaseAdapter;
    embedder?: EmbedderAdapter;
    seedIndexer?: Pick<typeof intentIndexing, 'runGenerateHydeSync'>;
    emitProposalCreated?: (intentId: string, userId: string) => void;
    intentGraph?: IntentGraphRunner;
  }) {
    this.adapter = deps?.adapter ?? intentDatabaseAdapter;
    this.proposalAdapter = deps?.proposalAdapter ?? intentProposalDatabaseAdapter;
    this.embedder = deps?.embedder ?? new EmbedderAdapter();
    this.seedIndexer = deps?.seedIndexer ?? intentIndexing;
    this.emitProposalCreated = deps?.emitProposalCreated ?? ((intentId, userId) => IntentEvents.onCreated(intentId, userId));
    this.intentGraph = deps?.intentGraph
      ?? new Intents({ database: this.adapter, embedder: this.embedder, followUp: intentIndexing }).createGraph();
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
   * Pause or resume an owned intent via the Intent Graph's `transition` action.
   * The graph enqueues resume discovery and compensates back to PAUSED if that
   * enqueue fails; ownership and lifecycle rules are enforced by the adapter's
   * atomic transition under the graph.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @param status - Requested lifecycle status.
   * @param networkScopeId - Optional bound-agent network constraint.
   * @returns The graph's transition outcome.
   */
  async transitionStatus(
    intentId: string,
    userId: string,
    status: 'ACTIVE' | 'PAUSED',
    networkScopeId?: string | null,
  ): Promise<IntentTransitionOutcome> {
    logger.verbose('Transitioning intent lifecycle', { intentId, userId, status, networkScopeId });

    const result = await this.intentGraph.invoke(
      {
        userId,
        userProfile: '',
        targetIntentIds: [intentId],
        status,
        ...(networkScopeId ? { scopeType: 'network' as const, scopeId: networkScopeId } : {}),
      },
      { recursionLimit: 100 },
    ) as { transitionResult?: IntentTransitionOutcome };

    const outcome = result.transitionResult;
    if (!outcome) {
      throw new Error('Intent graph transition action produced no result');
    }
    return outcome;
  }

  /**
   * Create an intent directly from a confirmed chat proposal, via the Intent
   * Graph's `confirm` action. An unchanged proposal confirms as-is; an
   * owner-edited description is re-verified and made authoritative by the
   * graph before confirmation continues. Idempotent under concurrent
   * confirmation: the adapter serializes one exact user + proposal pair and
   * returns the transaction winner to every caller. A HyDE-admission failure
   * after commit is retryable through the consumed proposal.
   *
   * @param userId - The user ID
   * @param description - The displayed description, possibly edited by the owner
   * @param proposalId - The proposal ID (stored as sourceId for status tracking)
   * @param networkId - Optional index to associate the intent with
   * @returns The created or existing intent record (at least { id }).
   */
  async createFromProposal(userId: string, description: string, proposalId: string, networkId?: string): Promise<{ id: string }> {
    logger.verbose('Creating intent from proposal', { userId, proposalId });

    const result = await this.intentGraph.invoke(
      {
        userId,
        userProfile: '',
        proposalId,
        description,
        ...(networkId ? { networkId } : {}),
      },
      { recursionLimit: 100 },
    ) as { confirmResult?: IntentConfirmOutcome };

    const outcome = result.confirmResult;
    if (!outcome) {
      throw new Error('Intent graph confirm action produced no result');
    }

    switch (outcome.kind) {
      case 'created':
        this.emitProposalCreated(outcome.intentId, userId);
        return { id: outcome.intentId };
      case 'replay':
        return { id: outcome.intentId };
      case 'membership_required':
        throw new IntentNetworkMembershipError(outcome.networkId);
      case 'admission_enqueue_failed':
        throw new IntentAdmissionEnqueueError(outcome.intentId, new Error('Indexing admission enqueue failed'));
      case 'missing':
        throw new IntentProposalConfirmationError('proposal_not_found');
      case 'expired':
        throw new IntentProposalConfirmationError('proposal_expired');
      case 'consumed':
        throw new IntentProposalConfirmationError('proposal_consumed');
      case 'payload_mismatch':
        throw new IntentProposalConfirmationError('proposal_payload_mismatch');
      case 'analysis_missing':
        throw new IntentProposalConfirmationError('proposal_analysis_missing');
      case 'proposal_edit_rejected':
        throw new IntentProposalConfirmationError('proposal_edit_rejected');
    }
  }

  /** Reject a pending durable proposal owned by the authenticated user. */
  async rejectProposal(userId: string, proposalId: string): Promise<boolean> {
    return this.proposalAdapter.rejectProposal(proposalId, userId);
  }

  /**
   * Index an already-persisted seed intent through the normal embedding and HyDE path.
   * Unlike creation-time seed helpers, this preserves a caller-owned deterministic ID.
   */
  async indexExistingIntentForSeed(intentId: string, userId: string, description: string): Promise<void> {
    logger.verbose('Indexing existing seed intent', { intentId, userId });
    await indexSeedIntent({
      generateEmbedding: (text) => this.embedder.generate(text),
      updateIntent: (id, data) => this.adapter.updateIntent(id, data),
      runHyde: ({ intentId: id, userId: ownerId }) => this.seedIndexer.runGenerateHydeSync(
        { intentId: id, userId: ownerId },
        { skipOpportunity: true },
      ),
    }, { intentId, userId, description });
  }

  /**
   * Create an intent for seed data with embedding and HyDE, without running the full intent graph
   * or enqueueing opportunity discovery. Used by db-seed to create test intents quickly without
   * LLM inference/verification or matching test users.
   *
   * This is a deliberate, narrow exception to "every intent write goes through
   * the graph": db-seed creates dozens of persona intents per run, and routing
   * them through inference/verification would make seeding slow, costly, and
   * liable to reject synthetic descriptions the verifier wasn't tuned for.
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
      await intentIndexing.runGenerateHydeSync(
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
   * Archive an intent via the Intent Graph's `expire` action (archives the
   * row, drops its network associations, expires referencing opportunities,
   * and enqueues the HyDE delete). Ownership is checked here: the graph's
   * expire path, like create/update, does not filter by owner — that's the
   * caller's responsibility.
   *
   * @param intentId - The intent ID
   * @param userId - The user ID (for ownership verification)
   * @returns Result with success flag and optional error
   */
  async archive(intentId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    logger.verbose('Archiving intent', { intentId, userId });

    const owned = await this.adapter.isOwnedByUser(intentId, userId);
    if (!owned) {
      return { success: false, error: 'Intent not found or unauthorized' };
    }

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', archive: true, targetIntentIds: [intentId] },
      { recursionLimit: 100 },
    ) as { executionResults?: Array<{ success: boolean; error?: string }> };

    const execution = result.executionResults?.[0];
    if (!execution?.success) {
      return { success: false, error: execution?.error ?? 'Intent not found' };
    }

    IntentEvents.onArchived(intentId, userId);

    return { success: true };
  }
}

export const intentService = new IntentService();
