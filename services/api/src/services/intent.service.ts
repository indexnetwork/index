import { IntentSuggester, Intents, Networks, decideNegotiationOpening, pairKeyOf, type IntentSuggestions, type PrepareInput } from '@indexnetwork/protocol';

import type { AssignmentVisibility } from '../schemas/database.schema';

import { log } from '../lib/log';
import { IntentDatabaseAdapter, chatDatabaseAdapter, intentDatabaseAdapter, userDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { negotiationDatabaseAdapter } from '../adapters/negotiation.database.adapter';
import { intentIndexing } from '../lib/intent/indexing';
import { scheduleMutualCheck } from '../lib/intent/mutual-check';
import { issuePreparationReceipt, readPreparationReceipt } from '../lib/intent/intent.preparation';
import { IntentEvents } from '../events/intent.event';

const logger = log.service.from("IntentService");

/** Client-owned sourceType whose creates skip admission. Resident-authored text, so no verifier gate. */
const AGENTVILLAGE_SOURCE_TYPE = 'agentvillage';

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
  constructor() { super('Could not prepare this intent. Your answers are kept; try again.'); }
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

/** How many counterparties one search returns when the caller names no limit. */
const DISCOVER_LIMIT = 10;

/** The largest top-N a caller may ask one search for. */
export const DISCOVER_LIMIT_MAX = 30;

/**
 * How deep retrieval reads to fill one search. An intent shared in several of
 * the searched communities takes one row per community, so reading exactly the
 * caller's limit would return fewer than it asked for.
 */
const DISCOVER_RETRIEVAL_MAX = 90;

/** How many counterparties one call may turn into opportunities. */
export const CREATE_OPPORTUNITIES_LIMIT = 30;

/**
 * Provenance for an opportunity the owner's agent created after a search. The
 * agent's judgement is which counterparties it picked, so there is no score to
 * carry: the pair exists because the agent chose it.
 */
const AGENT_PICK_REASONING =
  'Created by the owner\'s personal agent after an on-demand search, so it carries no compatibility score.';

/** Provenance for an opportunity a third party opened. Their own words stay out of it. */
const INTRODUCER_REASONING = 'Opened by a third party who owns neither intent.';

/** One counterparty a search surfaced, as an agent judging it needs to see it. */
export interface DiscoveredCounterparty {
  intentId: string;
  userId: string;
  name: string;
  bio: string | null;
  location: string | null;
  statement: string;
  networkId: string;
  score: number;
}

/** The outcome of searching an owned intent's communities. */
export type IntentDiscoverOutcome =
  | { kind: 'ok'; counterparties: DiscoveredCounterparty[] }
  | { kind: 'not_found' }
  | { kind: 'inactive' };

/** One counterparty an agent picked to turn into an opportunity. */
export interface CounterpartyPick {
  intentId: string;
  networkId: string;
}

/** The outcome of creating opportunities for picked counterparties. */
export type CreateOpportunitiesOutcome =
  | { kind: 'ok'; opportunities: { opportunityId: string }[] }
  | { kind: 'not_found' }
  | { kind: 'inactive' };

/** The outcome of a third party opening an opportunity between two intents. */
export type OpenOpportunityOutcome =
  | { kind: 'ok'; opportunityId: string }
  | { kind: 'not_member' }
  | { kind: 'not_seated' }
  | { kind: 'own_intent' };

/** Client-owned source fields. Undefined leaves a field unchanged; null clears it. */
export interface IntentSource {
  sourceType?: string | null;
  sourceId?: string | null;
}

/** The outcome of rewriting an owned intent's description. */
export type IntentUpdateOutcome =
  | { kind: 'updated' }
  | { kind: 'not_found' }
  | { kind: 'archived' }
  | { kind: 'rejected'; detail: string };

/** The outcome of linking or unlinking one intent and one community. */
export type IntentNetworkLinkOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'refused'; detail: string };

/** The `transition` action's outcome, as reported on `intentGraph`'s `transitionResult` field. */
export type IntentTransitionOutcome =
  | { kind: 'success'; id: string; status: 'active' | 'paused'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: 'active' | 'paused' | null; archived: boolean }
  | { kind: 'enqueue_failed'; id: string; status: 'active' | 'paused'; lifecycleVersionMs: number };

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
  private suggester: IntentSuggester | null = null;

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
  async prepare(userId: string, input: PrepareInput) {
    const result = await this.runPrepare(input);
    if (result.status !== 'ready') return result;
    const preparationReceipt = await issuePreparationReceipt(userId, result);
    return { status: result.status, payload: result.payload, preparationReceipt };
  }

  /**
   * Suggest first intents from the owner's profile: two they might be looking
   * for, then one they could offer. Onboarding offers these as one-tap starts.
   *
   * @returns The three suggestions and the example starters rewritten for them; both empty when the model has nothing.
   */
  async suggest(userId: string): Promise<IntentSuggestions> {
    const [user, active] = await Promise.all([
      userDatabaseAdapter.findById(userId),
      chatDatabaseAdapter.getActiveIntents(userId),
    ]);
    if (!user) return { suggestions: [], examples: [] };
    this.suggester ??= new IntentSuggester();
    const result = await this.suggester.invoke({
      name: user.name ?? null,
      intro: user.intro ?? null,
      location: user.location ?? null,
      existingIntents: active.map((intent) => intent.summary || intent.payload),
    });
    return result ?? { suggestions: [], examples: [] };
  }

  private async runPrepare(input: PrepareInput) {
    try {
      return await this.intents.prepare(input);
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
   * is assigned to, so an unlinked intent would reach nobody.
   *
   * @param userId - The authenticated owner.
   * @param description - The intent text as the owner wrote it.
   * @param networkIds - Networks to share it in; empty means all memberships.
   * @param preparationReceipt - Server authorization from guided preparation, valid for final revisions.
   * @param source - Optional client-owned source fields, stored unchanged.
   * @returns The created intent id and the networks it was linked to.
   * @throws {IntentNetworkMembershipError} When a named id is not a current membership.
   */
  async create(
    userId: string,
    description: string,
    networkIds: string[],
    preparationReceipt?: string,
    source: IntentSource = {},
    options: { visibility?: AssignmentVisibility; isPrivate?: boolean } = {},
  ): Promise<{ id: string; networkIds: string[] }> {
    if (options.isPrivate && options.visibility) {
      throw new IntentCreateRejectedError('A private intent has no assignment visibility.');
    }
    if (options.isPrivate) {
      for (const networkId of networkIds) {
        if (!await this.adapter.isNetworkMember(networkId, userId)) throw new IntentNetworkMembershipError(networkId);
      }
      const embedding = await this.embedder.generate(description) as number[];
      const created = await this.adapter.createIntent({
        userId,
        payload: description,
        isPrivate: true,
        embedding,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
      });
      for (const networkId of networkIds) await this.adapter.assignIntentToNetwork(created.id, networkId);
      this.emitCreated(created.id, userId);
      return { id: created.id, networkIds };
    }

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
    } else if (source.sourceType === AGENTVILLAGE_SOURCE_TYPE) {
      // Agentvillage intents are the resident's own words; admission is skipped and no measurements are taken.
      preparation = { metadata: null };
    } else {
      const result = await this.runPrepare({ payload: description });
      if (result.status !== 'ready') throw new IntentCreateRejectedError(result.feedback);
      preparation = { metadata: result.metadata };
    }

    logger.verbose('Creating intent', { userId, networkCount: targetNetworkIds.length });

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', inputContent: description, preparation, networkIds: targetNetworkIds, visibility: options.visibility, ...source },
      { recursionLimit: 100 },
    ) as {
      executionResults?: Array<{ actionType: string; success: boolean; intentId?: string; error?: string; linkedNetworkIds?: string[] }>;
      validationFailures?: Array<{ category: string; message: string }>;
    };

    const created = result.executionResults?.find((execution) => execution.actionType === 'create' && execution.success);
    if (!created?.intentId) {
      const failure = result.validationFailures?.[0];
      throw new IntentCreateRejectedError(failure?.message ?? 'The intent could not be created from this description.');
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
   * Rewrite an owned intent's description, its source fields, or both.
   *
   * A description rewrite goes through the graph, which re-infers and
   * re-verifies the text, persists it with any source fields, and re-evaluates
   * the intent's community assignments. A source-only update writes the columns
   * without re-verifying. Ownership is checked here because the graph's update
   * path, like create, does not filter by owner.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @param description - The rewritten intent text, or undefined to keep it.
   * @param source - Optional client-owned source fields, stored unchanged.
   * @returns Whether the rewrite landed, or why it did not.
   */
  async update(
    intentId: string,
    userId: string,
    description: string | undefined,
    source: IntentSource = {},
    options: { isPrivate?: boolean } = {},
  ): Promise<IntentUpdateOutcome> {
    logger.verbose('Updating intent', { intentId, userId });

    const intent = await this.adapter.getIntentById(intentId, userId);
    if (!intent) return { kind: 'not_found' };
    if (intent.archivedAt) return { kind: 'archived' };
    if (intent.isPrivate && options.isPrivate === false) {
      return { kind: 'rejected', detail: 'A private intent stays private. Create a new one instead.' };
    }

    if (intent.isPrivate || options.isPrivate) {
      const embedding = description !== undefined ? await this.embedder.generate(description) as number[] : undefined;
      const updated = await this.adapter.updateIntent(intentId, {
        ...(description !== undefined ? { payload: description } : {}),
        ...(embedding !== undefined ? { embedding } : {}),
        ...(options.isPrivate ? { isPrivate: true } : {}),
        ...source,
      });
      return updated ? { kind: 'updated' } : { kind: 'not_found' };
    }

    if (description === undefined) {
      const updated = await this.adapter.updateIntent(intentId, source);
      return updated ? { kind: 'updated' } : { kind: 'not_found' };
    }

    const result = await this.intentGraph.invoke(
      { userId, userProfile: '', inputContent: description, targetIntentIds: [intentId], ...source },
      { recursionLimit: 100 },
    ) as {
      executionResults?: Array<{ success: boolean; error?: string }>;
      validationFailures?: Array<{ message: string }>;
    };

    if (!result.executionResults?.some((execution) => execution.success)) {
      return {
        kind: 'rejected',
        detail: result.validationFailures?.[0]?.message
          ?? 'The intent could not be updated from this description.',
      };
    }

    return { kind: 'updated' };
  }

  /**
   * List the communities an owned intent is shared in.
   *
   * @param intentId - Full intent UUID.
   * @param userId - Authenticated owner.
   * @returns The linked network ids, or null when the intent is missing or foreign.
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
   * Share an owned intent in one community. The assignment graph enforces
   * ownership and current membership, and is idempotent.
   *
   * @param intentId - Full intent UUID.
   * @param networkId - The community to share it in.
   * @param userId - Authenticated owner.
   * @returns Whether the link exists now, or why it was refused.
   */
  async exclude(intentId: string, userId: string, excludedUserId: string): Promise<boolean> {
    return this.adapter.excludeUser(intentId, userId, excludedUserId);
  }

  async unexclude(intentId: string, userId: string, excludedUserId: string): Promise<boolean> {
    return this.adapter.unexcludeUser(intentId, userId, excludedUserId);
  }

  async addToNetwork(
    intentId: string,
    networkId: string,
    userId: string,
    visibility?: AssignmentVisibility,
  ): Promise<IntentNetworkLinkOutcome> {
    logger.verbose('Linking intent to network', { intentId, networkId, userId });
    const linked = await this.runLink(intentId, networkId, userId, 'create');
    if (linked.kind === 'ok' && visibility) {
      await this.adapter.assignIntentToNetwork(intentId, networkId, undefined, undefined, visibility);
      if (visibility === 'mutuals_only') scheduleMutualCheck(intentId, [networkId]);
    }
    return linked;
  }

  /**
   * Withdraw an owned intent from one community, leaving the intent itself
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
        status: intent.status ?? 'active' as const,
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
    return intent ? { ...intent, status: intent.status ?? 'active' as const } : null;
  }

  /**
   * Search the communities an owned intent is shared in for counterparties.
   *
   * The query is the caller's, embedded as written and matched against stored
   * intent vectors. Nothing is judged and nothing is written: the caller reads
   * the ranked counterparties and decides which are worth an opportunity.
   *
   * Retrieval has no similarity floor, so what comes back is the strongest N
   * rather than however many clear a cutoff. A repeat can return the same
   * counterparties. The caller compares them with opportunities already
   * started and opens only the ones that have none.
   *
   * @param intentId - Full intent UUID, owned by the caller.
   * @param userId - Authenticated owner.
   * @param input - The query in the caller's own words, how many counterparties to return, and optionally only intents that arrived after `since`.
   * @returns Ranked counterparties, or why the intent cannot be searched.
   */
  async discover(
    intentId: string,
    userId: string,
    input: { query: string; limit?: number; since?: Date; peerUserId?: string },
  ): Promise<IntentDiscoverOutcome> {
    const intent = await this.adapter.getIntentById(intentId, userId);
    if (!intent) return { kind: 'not_found' };
    if (intent.archivedAt || (intent.status != null && intent.status !== 'active')) return { kind: 'inactive' };

    const networkScope = await chatDatabaseAdapter.getNetworkIdsForIntent(intentId);
    if (networkScope.length === 0) return { kind: 'ok', counterparties: [] };

    const limit = input.limit ?? DISCOVER_LIMIT;

    logger.verbose('Discovering counterparties', { intentId, userId, networkCount: networkScope.length, limit });

    const embedding = await this.embedder.generate(input.query) as number[];
    const candidates = await this.embedder.searchIntentCandidates(embedding, {
      networkScope,
      excludeUserId: userId,
      searchingIntentId: intentId,
      ...(input.peerUserId ? { userId: input.peerUserId } : {}),
      limit: Math.min(limit * 3, DISCOVER_RETRIEVAL_MAX),
      minScore: 0,
      ...(input.since ? { since: input.since } : {}),
    });

    // One intent shared in several of the searched communities comes back once
    // per community; the strongest hit is the one worth reporting.
    const best = new Map<string, { networkId: string; score: number }>();
    for (const candidate of candidates) {
      const seen = best.get(candidate.id);
      if (!seen || candidate.score > seen.score) {
        best.set(candidate.id, { networkId: candidate.networkId, score: candidate.score });
      }
    }

    const rows = await this.adapter.listCounterpartyCandidates(intentId, [...best.keys()]);
    const counterparties = rows
      .map((row) => {
        const hit = best.get(row.id)!;
        return {
          intentId: row.id,
          userId: row.userId,
          name: row.name,
          bio: row.bio,
          location: row.location,
          statement: row.statement,
          networkId: hit.networkId,
          score: hit.score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (!input.peerUserId) await chatDatabaseAdapter.markIntentFirstDiscoverySucceeded(intentId);

    return { kind: 'ok', counterparties };
  }

  /**
   * Open every discoverable intent pair between the caller and one peer: each
   * of the caller's active intents is discovered against the peer alone, so
   * eligibility is discovery's own. Idempotent on each pair.
   *
   * @param userId - Authenticated owner.
   * @param peerUserId - The member to pair with.
   * @returns The opportunities that now exist, or `no_pair` when nothing was discoverable.
   */
  async pairWithUser(userId: string, peerUserId: string): Promise<{ kind: 'ok'; opportunityIds: string[] } | { kind: 'no_pair' }> {
    if (userId === peerUserId) return { kind: 'no_pair' };
    const opportunityIds: string[] = [];
    for (const intent of await chatDatabaseAdapter.getActiveIntents(userId)) {
      const found = await this.discover(intent.id, userId, { query: intent.payload, peerUserId, limit: CREATE_OPPORTUNITIES_LIMIT });
      if (found.kind !== 'ok' || found.counterparties.length === 0) continue;
      const created = await this.createOpportunities(intent.id, userId, found.counterparties);
      if (created.kind === 'ok') opportunityIds.push(...created.opportunities.map((o) => o.opportunityId));
    }
    return opportunityIds.length ? { kind: 'ok', opportunityIds } : { kind: 'no_pair' };
  }

  /**
   * Create one opportunity per counterparty the caller picked.
   *
   * Opening is idempotent on the pair: a counterparty that already shares an
   * opportunity with this intent reports that one rather than a second.
   * Counterparties that are no longer seated in the named community are
   * skipped, because a membership can end between the search and this call.
   *
   * @param intentId - Full intent UUID, owned by the caller.
   * @param userId - Authenticated owner.
   * @param picks - Counterparty intents and the community each pair sits in.
   * @returns The opportunities that now exist, or why none could be created.
   */
  async createOpportunities(
    intentId: string,
    userId: string,
    picks: CounterpartyPick[],
  ): Promise<CreateOpportunitiesOutcome> {
    const intent = await this.adapter.getIntentById(intentId, userId);
    if (!intent) return { kind: 'not_found' };
    if (intent.archivedAt || (intent.status != null && intent.status !== 'active')) return { kind: 'inactive' };

    logger.verbose('Creating opportunities from picked counterparties', { intentId, userId, count: picks.length });

    const pairs = [];
    for (const pick of picks.slice(0, CREATE_OPPORTUNITIES_LIMIT)) {
      if (pick.intentId === intentId) continue;
      const initiator = await negotiationDatabaseAdapter.seatedIntent(intentId, pick.networkId);
      const responder = initiator && await negotiationDatabaseAdapter.seatedIntent(pick.intentId, pick.networkId, {
        visible: true,
        otherUserId: initiator.userId,
        otherIntentId: intentId,
      });
      if (!initiator || !responder || initiator.userId === responder.userId) continue;
      pairs.push({
        pairKey: pairKeyOf(pick.networkId, initiator.intentId, responder.intentId),
        networkId: pick.networkId,
        intentA: initiator.intentId,
        intentB: responder.intentId,
        userA: initiator.userId,
        userB: responder.userId,
        score: 100,
        reasoning: AGENT_PICK_REASONING,
        evidence: [],
        detection: { source: 'personal_agent', createdBy: userId },
      });
    }

    if (pairs.length === 0) return { kind: 'ok', opportunities: [] };

    await negotiationDatabaseAdapter.openCounterparties(pairs, decideNegotiationOpening);

    // `openCounterparties` reports only what it created, and reports "already
    // an opportunity" and "not eligible" identically. Reading each pair back is
    // how a pair that was already open still counts as done here.
    const records = await Promise.all(
      pairs.map((pair) => negotiationDatabaseAdapter.findByPairKey(pair.pairKey)),
    );

    return {
      kind: 'ok',
      opportunities: records
        .filter((record): record is NonNullable<typeof record> => record !== null)
        .map((record) => ({ opportunityId: record.opportunityId })),
    };
  }

  /**
   * Open one opportunity between two intents the caller owns neither of. The
   * caller holds no seat; the owner of the first intent takes the first turn.
   * Idempotent on the pair.
   *
   * @param userId - The introducer.
   * @param networkId - A network the introducer belongs to, where both intents are shared.
   * @param intentIds - The two intents, the first one's owner speaking first.
   * @param context - Why they should meet, in the introducer's words.
   * @returns The opportunity, or why it could not be opened.
   */
  async openOpportunity(
    userId: string,
    networkId: string,
    intentIds: [string, string],
    context: string,
  ): Promise<OpenOpportunityOutcome> {
    if (!await this.adapter.isNetworkMember(networkId, userId)) return { kind: 'not_member' };
    const a = await negotiationDatabaseAdapter.seatedIntent(intentIds[0], networkId, { visible: true });
    const b = a && await negotiationDatabaseAdapter.seatedIntent(intentIds[1], networkId, {
      visible: true,
      otherUserId: a.userId,
      otherIntentId: a.intentId,
    });
    if (!a || !b || a.intentId === b.intentId) return { kind: 'not_seated' };
    if (a.userId === userId || b.userId === userId || a.userId === b.userId) return { kind: 'own_intent' };

    const pairKey = pairKeyOf(networkId, a.intentId, b.intentId);
    await negotiationDatabaseAdapter.openCounterparties([{
      pairKey,
      networkId,
      intentA: a.intentId,
      intentB: b.intentId,
      userA: a.userId,
      userB: b.userId,
      score: 100,
      reasoning: INTRODUCER_REASONING,
      evidence: [],
      detection: { source: 'introducer', createdBy: userId },
      introducer: { userId, context },
    }], decideNegotiationOpening);

    const record = await negotiationDatabaseAdapter.findByPairKey(pairKey);
    return record ? { kind: 'ok', opportunityId: record.opportunityId } : { kind: 'not_seated' };
  }

  /**
   * Pause or resume an owned intent via the Intent Graph's `transition` action.
   * The graph enqueues resume discovery and compensates back to paused if that
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
    status: 'active' | 'paused',
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
   * row, drops its network associations, and expires referencing
   * opportunities). Ownership is checked here: the graph's expire path, like
   * create/update, does not filter by owner — that's the caller's
   * responsibility.
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

  /** Run one intent↔community mutation through the assignment graph. */
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
      return { kind: 'refused', detail: mutation?.error ?? 'The intent could not be linked to this network.' };
    }
    return { kind: 'ok', message: mutation.message ?? 'Done.' };
  }
}

export const intentService = new IntentService();
