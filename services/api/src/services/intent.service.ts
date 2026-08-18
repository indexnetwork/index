import { log } from '../lib/log';
import { Intents } from '@indexnetwork/protocol';
import type { IntentGraphDatabase } from '@indexnetwork/protocol';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { IntentProposalDatabaseAdapter, intentProposalDatabaseAdapter } from '../adapters/intent-proposal.database.adapter';
import { intentQueue } from '../queues/intent.queue';
import { IntentEvents } from '../events/intent.event';
import { intentProposalAnalysisSchema, intentProposalVerifierOutputSchema } from '../lib/intent/intent-proposal';
import { indexExistingIntentForSeed as indexSeedIntent } from '../lib/intent/seed-indexer';
import type { IntentProposalRow } from '../schemas/database.schema';

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

/**
 * IntentService
 *
 * Manages intent processing through the Intent Graph and CRUD operations.
 * Uses IntentDatabaseAdapter for database operations.
 * Uses the Intents module for graph-based intent processing.
 *
 * RESPONSIBILITIES:
 * - Process intents through Intent Graph
 * - Extract, verify, reconcile, and execute intent actions
 * - Intent CRUD operations (list, get, archive)
 */
export class IntentService {
  private db: IntentGraphDatabase;
  private intents: Intents;
  private adapter: IntentDatabaseAdapter;
  private proposalAdapter: IntentProposalDatabaseAdapter;
  private embedder: EmbedderAdapter;
  private proposalQueue: Pick<typeof intentQueue, 'addGenerateHydeJob'>;
  private seedIndexQueue: Pick<typeof intentQueue, 'runGenerateHydeSync'>;
  private emitProposalCreated: (intentId: string, userId: string) => void;
  private verifyProposalEdit: (description: string, profileContext: string) => Promise<unknown>;

  /**
   * @param deps - Optional dependency overrides for focused service tests.
   */
  constructor(deps?: {
    adapter?: IntentDatabaseAdapter;
    proposalAdapter?: IntentProposalDatabaseAdapter;
    embedder?: EmbedderAdapter;
    proposalQueue?: Pick<typeof intentQueue, 'addGenerateHydeJob'>;
    seedIndexQueue?: Pick<typeof intentQueue, 'runGenerateHydeSync'>;
    emitProposalCreated?: (intentId: string, userId: string) => void;
    verifyProposalEdit?: (description: string, profileContext: string) => Promise<unknown>;
  }) {
    this.adapter = deps?.adapter ?? intentDatabaseAdapter;
    this.proposalAdapter = deps?.proposalAdapter ?? intentProposalDatabaseAdapter;
    this.db = this.adapter;
    this.embedder = deps?.embedder ?? new EmbedderAdapter();
    this.proposalQueue = deps?.proposalQueue ?? intentQueue;
    this.seedIndexQueue = deps?.seedIndexQueue ?? intentQueue;
    this.emitProposalCreated = deps?.emitProposalCreated ?? ((intentId, userId) => IntentEvents.onCreated(intentId, userId));
    this.intents = new Intents({ database: this.db, embedder: this.embedder, queue: intentQueue });
    this.verifyProposalEdit = deps?.verifyProposalEdit
      ?? ((description, profileContext) => this.intents.verifyIntent(description, profileContext));
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

    const graph = this.intents.createGraph();
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
   * An unchanged proposal bypasses the full intent graph. An owner-edited
   * description is re-verified and atomically made authoritative first.
   * Idempotent under concurrent confirmation: the adapter serializes one exact
   * user + proposal pair and returns the transaction winner to every caller.
   * Generates embedding, inserts into DB, optionally associates with index, and
   * obtains observable queue admission before emitting downstream side effects.
   * A queue failure after commit is retryable through the consumed proposal.
   *
   * @param userId - The user ID
   * @param description - The displayed description, possibly edited by the owner
   * @param proposalId - The proposal ID (stored as sourceId for status tracking)
   * @param networkId - Optional index to associate the intent with
   * @returns The created or existing intent record (at least { id }).
   */
  async createFromProposal(userId: string, description: string, proposalId: string, networkId?: string) {
    logger.verbose('Creating intent from proposal', { userId, proposalId });

    let proposal = await this.proposalAdapter.getProposalForOwner(proposalId, userId);
    if (!proposal) throw new IntentProposalConfirmationError('proposal_not_found');
    if (proposal.networkId !== (networkId ?? null)) {
      throw new IntentProposalConfirmationError('proposal_payload_mismatch');
    }
    if (proposal.description !== description) {
      if (proposal.status !== 'pending') {
        throw new IntentProposalConfirmationError('proposal_consumed');
      }
      if (proposal.expiresAt.getTime() <= Date.now()) {
        throw new IntentProposalConfirmationError('proposal_expired');
      }
      proposal = await this.reviseProposalDescription(userId, proposal, description);
    }
    if (proposal.status === 'consumed' && proposal.consumedIntentId) {
      const existing = await this.adapter.getIntentBySourceId(proposalId, userId);
      if (!existing || existing.id !== proposal.consumedIntentId) {
        throw new IntentProposalConfirmationError('proposal_consumed');
      }
      await this.enqueueProposalAdmission({
        intentId: existing.id,
        userId,
        proposalId,
        networkId: proposal.networkId,
        replay: true,
      });
      return existing;
    }
    if (proposal.status !== 'pending') {
      throw new IntentProposalConfirmationError('proposal_consumed');
    }
    if (proposal.expiresAt.getTime() <= Date.now()) {
      throw new IntentProposalConfirmationError('proposal_expired');
    }
    if (!intentProposalAnalysisSchema.safeParse(proposal.analysis).success) {
      throw new IntentProposalConfirmationError('proposal_analysis_missing');
    }

    // Cheap advisory preflight avoids embedding/transaction/queue/event work
    // for clear denials. confirmProposalIntent still re-checks membership under
    // its row locks and remains the final race-safe authority.
    if (proposal.networkId && !await this.adapter.isNetworkMember(proposal.networkId, userId)) {
      throw new IntentNetworkMembershipError(proposal.networkId);
    }

    const embedding = await this.generateEmbeddingOrZero(
      proposal.description,
      'Embedding generation failed (intent will be created with zero vector)',
      { userId, proposalId },
    );

    const confirmation = await this.adapter.confirmProposalIntent({
      proposalId,
      userId,
      description,
      ...(networkId ? { networkId } : {}),
      embedding,
    });
    if (confirmation.kind === 'membership_required') {
      if (!proposal.networkId) throw new Error('Unexpected membership requirement without a network');
      throw new IntentNetworkMembershipError(proposal.networkId);
    }
    if (confirmation.kind === 'replay') return confirmation.intent;
    if (confirmation.kind !== 'created') {
      const code = {
        missing: 'proposal_not_found',
        expired: 'proposal_expired',
        consumed: 'proposal_consumed',
        payload_mismatch: 'proposal_payload_mismatch',
        analysis_missing: 'proposal_analysis_missing',
      }[confirmation.kind] as IntentProposalConfirmationErrorCode;
      throw new IntentProposalConfirmationError(code);
    }

    const created = confirmation.intent;
    const scope = proposal.networkId
      ? { scopeType: 'network' as const, scopeId: proposal.networkId }
      : {};
    await this.enqueueProposalAdmission({
      intentId: created.id,
      userId,
      proposalId,
      networkId: proposal.networkId,
      replay: false,
    });

    this.emitProposalCreated(created.id, userId);

    return created;
  }

  /**
   * Re-verify an owner-edited confirmation-card description and make it the
   * proposal's authoritative payload before confirmation continues.
   */
  private async reviseProposalDescription(
    userId: string,
    proposal: IntentProposalRow,
    description: string,
  ) {
    const profileContext = (await this.db.getUserContext(userId, null))?.text ?? '';
    const verifierOutput = intentProposalVerifierOutputSchema.parse(
      await this.verifyProposalEdit(description, profileContext),
    );
    const validClassification = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'].includes(
      verifierOutput.classification,
    );
    const vague = /\b(?:a|any|some)\s+job\b/i.test(description)
      || verifierOutput.semantic_entropy > 0.75
      || verifierOutput.felicity_scores.clarity < 40;
    if (!validClassification || vague) {
      throw new IntentProposalConfirmationError('proposal_edit_rejected');
    }

    const analysis = {
      verifierOutput,
      combinedScore: Math.min(
        verifierOutput.felicity_scores.authority,
        verifierOutput.felicity_scores.sincerity,
        verifierOutput.felicity_scores.clarity,
      ),
    };
    const revised = await this.proposalAdapter.revisePendingProposal({
      proposalId: proposal.id,
      userId,
      expectedDescription: proposal.description,
      expectedNetworkId: proposal.networkId,
      description,
      analysis,
    });
    if (revised) return revised;

    // A same-text concurrent edit is harmless. Any other winner is resolved
    // through the ordinary confirmation errors instead of being overwritten.
    const authoritative = await this.proposalAdapter.getProposalForOwner(proposal.id, userId);
    if (!authoritative) throw new IntentProposalConfirmationError('proposal_not_found');
    if (authoritative.status !== 'pending') throw new IntentProposalConfirmationError('proposal_consumed');
    if (authoritative.expiresAt.getTime() <= Date.now()) {
      throw new IntentProposalConfirmationError('proposal_expired');
    }
    if (authoritative.description !== description || authoritative.networkId !== proposal.networkId) {
      throw new IntentProposalConfirmationError('proposal_payload_mismatch');
    }
    return authoritative;
  }

  /**
   * Obtain durable queue admission for a newly committed confirmation or an
   * exact consumed-proposal retry. The queue contract is idempotent; surfacing
   * failure lets the same authoritative confirmation repair admission.
   */
  private async enqueueProposalAdmission(input: {
    intentId: string;
    userId: string;
    proposalId: string;
    networkId: string | null;
    replay: boolean;
  }): Promise<void> {
    const scope = input.networkId
      ? { scopeType: 'network' as const, scopeId: input.networkId }
      : {};
    try {
      await this.proposalQueue.addGenerateHydeJob({
        intentId: input.intentId,
        userId: input.userId,
        ...scope,
      });
    } catch (error) {
      logger.error(
        input.replay
          ? 'Intent admission enqueue failed during confirmation replay'
          : 'Intent admission enqueue failed after confirmation persistence',
        {
          event: 'intent_admission_enqueue_failed',
          intentId: input.intentId,
          userId: input.userId,
          proposalId: input.proposalId,
          replay: input.replay,
          error,
        },
      );
      throw new IntentAdmissionEnqueueError(input.intentId, error);
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
      runHyde: ({ intentId: id, userId: ownerId }) => this.seedIndexQueue.runGenerateHydeSync(
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
