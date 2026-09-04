import { log } from '../lib/log';
import { Intents } from '@indexnetwork/protocol';
import { IntentDatabaseAdapter, intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { intentIndexing } from '../lib/intent/indexing';
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
  private intentGraph: IntentGraphRunner;
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
  }) {
    this.adapter = deps?.adapter ?? intentDatabaseAdapter;
    this.embedder = deps?.embedder ?? new EmbedderAdapter();
    this.emitCreated = deps?.emitCreated ?? ((intentId, userId) => IntentEvents.onCreated(intentId, userId));
    this.intentGraph = deps?.intentGraph
      ?? new Intents({ database: this.adapter, embedder: this.embedder, followUp: intentIndexing }).createGraph();
  }

  /**
   * Create one intent and share it in exactly the networks the owner named.
   *
   * The graph infers, verifies and persists the signal, then writes an
   * `intent_networks` row per id. A network the caller is not a member of is
   * rejected outright rather than silently dropped.
   *
   * @param userId - The authenticated owner.
   * @param description - The signal text as the owner wrote it.
   * @param networkIds - Networks to share it in; may be empty.
   * @returns The created intent id and the networks it was linked to.
   * @throws {IntentNetworkMembershipError} When an id is not a current membership.
   */
  async create(
    userId: string,
    description: string,
    networkIds: string[],
  ): Promise<{ id: string; networkIds: string[] }> {
    logger.verbose('Creating intent', { userId, networkCount: networkIds.length });

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', inputContent: description, networkIds },
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
    const missing = networkIds.filter((networkId) => !linked.includes(networkId));
    if (missing.length > 0) {
      throw new IntentNetworkMembershipError(missing[0]);
    }

    this.emitCreated(created.intentId, userId);
    return { id: created.intentId, networkIds: linked };
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
