import { Intents, Networks, type ClarifyInput } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { IntentDatabaseAdapter, chatDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentIndexing } from '../lib/intent/indexing';
import { issuePreparationReceipt, readPreparationReceipt } from '../lib/intent/intent.preparation';
import { IntentEvents } from '../events/intent.event';

const logger = log.service.from("IntentService");

/** Stable typed failure for a description verification refused to admit. */
export class IntentCreateRejectedError extends Error {
  readonly code = 'intent_rejected' as const;

  constructor(detail: string) {
    super(detail);
    this.name = 'IntentCreateRejectedError';
  }
}

/** Model failures during preparation are retryable, never a completed round. */
export class IntentPreparationFailedError extends Error {
  constructor() { super('Could not prepare this signal. Your answers are kept; try again.'); }
}

/** Stable typed failure for a create naming a network the caller is not a member of. */
export class IntentNetworkMembershipError extends Error {
  readonly code = 'network_membership_required' as const;

  constructor(readonly networkId: string) {
    super('You are not a current member of this network');
    this.name = 'IntentNetworkMembershipError';
  }
}

/** Minimal shape of a compiled protocol graph, narrowed to what this service invokes. */
export interface IntentGraphRunner {
  invoke(input: Record<string, unknown>, options?: { recursionLimit?: number }): Promise<Record<string, unknown>>;
}

/** The outcome of rewriting an owned signal's description. */
export type IntentUpdateOutcome =
  | { kind: 'updated' }
  | { kind: 'not_found' }
  | { kind: 'archived' }
  | { kind: 'rejected'; detail: string };

/** The outcome of linking or unlinking one signal and one community. */
export type IntentNetworkLinkOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'refused'; detail: string };

/** The `transition` action's outcome, as reported on `intentGraph`'s `transitionResult` field. */
export type IntentTransitionOutcome =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | null; archived: boolean }
  | { kind: 'enqueue_failed'; id: string; status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED'; lifecycleVersionMs: number };

/**
 * IntentService
 *
 * Intent CRUD (create, list, get, archive, pause/resume) all route through the
 * compiled Intent Graph — the single write path for intent mutations. Reads
 * (list/get/resolve) go straight to the adapter.
 */
export class IntentService {
  private intents: Intents;
  private intentGraph: IntentGraphRunner;
  private intentNetworkGraph: IntentGraphRunner;
  private adapter: IntentDatabaseAdapter;
  private embedder: EmbedderAdapter;
  private emitCreated: (intentId: string, userId: string) => void;

  /**
   * @param deps - Optional dependency overrides for focused service tests.
   */
  constructor(deps?: {
    adapter?: IntentDatabaseAdapter;
    embedder?: EmbedderAdapter;
    emitCreated?: (intentId: string, userId: string) => void;
    intentGraph?: IntentGraphRunner;
    intentNetworkGraph?: IntentGraphRunner;
  }) {
    this.adapter = deps?.adapter ?? intentDatabaseAdapter;
    this.embedder = deps?.embedder ?? new EmbedderAdapter();
    this.emitCreated = deps?.emitCreated ?? ((intentId, userId) => IntentEvents.onCreated(intentId, userId));
    this.intents = new Intents({ database: this.adapter, embedder: this.embedder, followUp: intentIndexing });
    this.intentGraph = deps?.intentGraph ?? this.intents.createGraph();
    this.intentNetworkGraph = deps?.intentNetworkGraph
      ?? new Networks({ database: chatDatabaseAdapter }).createAssignmentGraph();
  }

  /**
   * Prepare a draft and authorize final revisions only after protocol admission.
   * @param userId - Authenticated owner.
   * @param input - Draft and pending answers.
   * @returns Repairable feedback or a signed receipt for final review.
   * @throws {IntentPreparationFailedError} When a model fails; retain answers for retry.
   */
  async clarify(userId: string, input: ClarifyInput) {
    const result = await this.prepare(input);
    if (result.status !== 'ready') return result;
    const preparationReceipt = await issuePreparationReceipt(userId, result);
    return { status: result.status, payload: result.payload, questions: result.questions, preparationReceipt };
  }

  private async prepare(input: ClarifyInput) {
    try {
      return await this.intents.clarify(input);
    } catch (error) {
      logger.error('Intent preparation failed', { error });
      throw new IntentPreparationFailedError();
    }
  }

  /**
   * Create one intent and share it in the owner's networks.
   *
   * The protocol prepares the description once and persists it verbatim, then writes an
   * `intent_networks` row per id. Naming networks shares it in exactly those,
   * and a network the caller is not a member of is rejected outright rather
   * than silently dropped. Naming none shares it in every network the owner
   * currently belongs to: discovery only admits an intent in the networks it
   * is assigned to, so an unlinked signal would reach nobody.
   *
   * @param userId - The authenticated owner.
   * @param description - The signal text as the owner wrote it.
   * @param networkIds - Networks to share it in; empty means all memberships.
   * @param preparationReceipt - Server authorization from guided preparation, valid for final revisions.
   * @returns The created intent id and the networks it was linked to.
   * @throws {IntentNetworkMembershipError} When a named id is not a current membership.
   */
  async create(
    userId: string,
    description: string,
    networkIds: string[],
    preparationReceipt?: string,
  ): Promise<{ id: string; networkIds: string[] }> {
    const targetNetworkIds = networkIds.length > 0
      ? networkIds
      : (await chatDatabaseAdapter.getAssignmentNetworkMembershipsForUser(userId))
        .map((membership) => membership.networkId);

    for (const networkId of networkIds) {
      if (!await this.adapter.isNetworkMember(networkId, userId)) throw new IntentNetworkMembershipError(networkId);
    }
    let preparation;
    if (preparationReceipt) {
      preparation = await readPreparationReceipt(userId, description, preparationReceipt);
    } else {
      const result = await this.prepare({ payload: description });
      if (result.status !== 'ready') throw new IntentCreateRejectedError(result.feedback);
      preparation = { metadata: result.metadata };
    }

    logger.verbose('Creating intent', { userId, networkCount: targetNetworkIds.length });

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', inputContent: description, preparation, networkIds: targetNetworkIds },
      { recursionLimit: 100 },
    ) as {
      executionResults?: Array<{ actionType: string; success: boolean; intentId?: string; error?: string; linkedNetworkIds?: string[] }>;
      validationFailures?: Array<{ category: string; message: string }>;
    };

    const created = result.executionResults?.find((execution) => execution.actionType === 'create' && execution.success);
    if (!created?.intentId) {
      const failure = result.validationFailures?.[0];
      throw new IntentCreateRejectedError(failure?.message ?? 'The signal could not be created from this description.');
    }

    const linked = created.linkedNetworkIds ?? [];
    // Only the ids the caller named are a hard requirement: a membership that
    // ends between the lookup above and the write must not fail the create.
    const missing = networkIds.filter((networkId) => !linked.includes(networkId));
    if (missing.length > 0) {
      throw new IntentNetworkMembershipError(missing[0]);
    }

    this.emitCreated(created.intentId, userId);
    return { id: created.intentId, networkIds: linked };
  }

  /**
   * Rewrite an owned signal's description.
   *
   * The graph re-infers and re-verifies the text, persists it, and re-evaluates
   * the signal's community assignments. Ownership is checked here because the
   * graph's update path, like create, does not filter by owner.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @param description - The rewritten signal text.
   * @returns Whether the rewrite landed, or why it did not.
   */
  async update(intentId: string, userId: string, description: string): Promise<IntentUpdateOutcome> {
    logger.verbose('Updating intent', { intentId, userId });

    const intent = await this.adapter.getIntentById(intentId, userId);
    if (!intent) return { kind: 'not_found' };
    if (intent.archivedAt) return { kind: 'archived' };

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', inputContent: description, targetIntentIds: [intentId] },
      { recursionLimit: 100 },
    ) as {
      executionResults?: Array<{ success: boolean; error?: string }>;
      validationFailures?: Array<{ message: string }>;
    };

    if (!result.executionResults?.some((execution) => execution.success)) {
      return {
        kind: 'rejected',
        detail: result.validationFailures?.[0]?.message
          ?? 'The signal could not be updated from this description.',
      };
    }

    return { kind: 'updated' };
  }

  /**
   * List the communities an owned signal is shared in.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @returns The linked network ids, or null when the signal is missing or foreign.
   */
  async listNetworks(intentId: string, userId: string): Promise<string[] | null> {
    const result = await this.intentNetworkGraph.invoke({
      userId,
      intentId,
      operationMode: 'read',
    }) as {
      readResult?: { links?: Array<{ networkId: string }> };
      error?: string;
    };

    if (result.error || !result.readResult?.links) return null;
    return result.readResult.links.map((link) => link.networkId);
  }

  /**
   * Share an owned signal in one community. The assignment graph enforces
   * ownership and current membership, and is idempotent.
   *
   * @param intentId - Full intent UUID.
   * @param networkId - The community to share it in.
   * @param userId - Authenticated owner.
   * @returns Whether the link exists now, or why it was refused.
   */
  async addToNetwork(intentId: string, networkId: string, userId: string): Promise<IntentNetworkLinkOutcome> {
    logger.verbose('Linking intent to network', { intentId, networkId, userId });
    return this.runLink(intentId, networkId, userId, 'create');
  }

  /**
   * Withdraw an owned signal from one community, leaving the signal itself
   * intact. Idempotent when the link is already gone.
   *
   * @param intentId - Full intent UUID.
   * @param networkId - The community to withdraw it from.
   * @param userId - Authenticated owner.
   * @returns Whether the link is gone now, or why it was refused.
   */
  async removeFromNetwork(intentId: string, networkId: string, userId: string): Promise<IntentNetworkLinkOutcome> {
    logger.verbose('Unlinking intent from network', { intentId, networkId, userId });
    return this.runLink(intentId, networkId, userId, 'delete');
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
    q?: string;
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
      q: options.q,
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
   * @returns Resolved ID, or error object with status
   */
  async resolveId(
    idOrPrefix: string,
    userId: string,
  ): Promise<{ id: string } | { error: string; status: number }> {
    const result = await this.adapter.resolveIntentId(idOrPrefix, userId);
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
   * @returns The graph's transition outcome.
   */
  async transitionStatus(
    intentId: string,
    userId: string,
    status: 'ACTIVE' | 'PAUSED',
  ): Promise<IntentTransitionOutcome> {
    logger.verbose('Transitioning intent lifecycle', { intentId, userId, status });

    const result = await this.intentGraph.invoke(
      {
        userId,
        userProfile: '',
        targetIntentIds: [intentId],
        status,
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

  /** Run one signal↔community mutation through the assignment graph. */
  private async runLink(
    intentId: string,
    networkId: string,
    userId: string,
    operationMode: 'create' | 'delete',
  ): Promise<IntentNetworkLinkOutcome> {
    const result = await this.intentNetworkGraph.invoke({
      userId,
      intentId,
      networkId,
      operationMode,
    }) as { mutationResult?: { success: boolean; message?: string; error?: string } };

    const mutation = result.mutationResult;
    if (!mutation?.success) {
      return { kind: 'refused', detail: mutation?.error ?? 'The signal could not be linked to this network.' };
    }
    return { kind: 'ok', message: mutation.message ?? 'Done.' };
  }
}

export const intentService = new IntentService();
