import { log } from '../log';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { buildProfileFromUser } from '../../adapters/database.shared';
import { HydeGraphFactory, HydeGenerator, LensInferrer, Intents, buildNetworkAssignmentDecision, deriveDiscoveryNetworkIds, resolveAssignmentNetworkScope } from '@indexnetwork/protocol';
import type { AssignmentNetworkMembership, HydeGraphDatabase, IntentFollowUp, IntentIndexerOutput, ToolScopeType } from '@indexnetwork/protocol';
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

/** Union of HyDE generate/delete payloads. */
export type IntentJobPayload = IntentJobData | IntentDeleteData;

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

/** Minimal database interface for intent indexing (used when deps provided in tests). */
export type IntentIndexingDatabase = Pick<
  ChatDatabaseAdapter,
  'getIntentForIndexing' | 'getAssignmentNetworkMembershipsForUser' | 'getAssignmentNetworkIdsForUser' | 'assignIntentToNetworkIfMember' | 'deleteHydeDocumentsForSource' | 'getHydeDocumentsForSource' | 'getNetworkIdsForIntent' | 'getNetworkAssignmentContext' | 'getProfile' | 'getActiveIntents'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub database, HyDE invocation, or opportunity discovery.
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
  addOpportunityJob?: (data: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown>;
  evaluateIntentAssignment?: (opts: {
    intent: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
    sourceName?: string | null;
  }) => Promise<IntentIndexerOutput | null>;
}

/**
 * Intent HyDE follow-up: assign networks, run HyDE, start discovery.
 *
 * Handles `generate_hyde` (assign intent to user indexes, run HyDE graph, start opportunity discovery)
 * and `delete_hyde` (remove HyDE documents for an intent). Implements {@link IntentFollowUp} so
 * the protocol intent graph can start this work without depending on this module.
 */
export class IntentIndexing implements IntentFollowUp {
  /**
   * Generate HyDE documents for an intent (implements {@link IntentFollowUp}).
   * @param data - intentId, userId, and optional scope envelope. When scopeType/scopeId
   *   is set, indexing is restricted to the focused network.
   */
  generateHyde(data: IntentJobData): Promise<void> {
    return this.addJob('generate_hyde', data);
  }

  /**
   * Delete HyDE documents for an intent (implements {@link IntentFollowUp}).
   * @param data - intentId
   */
  deleteHyde(data: { intentId: string }): Promise<void> {
    return this.addJob('delete_hyde', data);
  }

  /**
   * Start discovery for an intent resumed from PAUSED back to ACTIVE
   * (implements {@link IntentFollowUp}).
   */
  resumeDiscovery(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return intentDiscovery.addJob(
      { intentId: data.intentId, userId: data.userId, trigger: 'intent_resume' },
    );
  }

  private readonly logger = log.job.from('IntentJob');
  private readonly hydeLogger = log.job.from('IntentJob:Hyde');
  private readonly assignLogger = log.job.from('IntentJob:Assign');
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
   * Run HyDE generate/delete/reconcile work.
   * @param name - `generate_hyde` or `delete_hyde`
   * @param data - Payload
   */
  async addJob(
    name: 'generate_hyde' | 'delete_hyde' | 'reconcile_intent_networks' | 'reconcile_orphaned_intent',
    data: IntentJobData | IntentDeleteData,
    _options?: { jobId?: string; priority?: number }
  ): Promise<void> {
    await this.processJob(name, data as IntentJobPayload);
  }

  /**
   * Run the job handler for a given job name and payload. Used by the worker and by tests with injected deps.
   * @param name - Job name (`generate_hyde` or `delete_hyde`)
   * @param data - Job payload
   */
  async processJob(name: string, data: IntentJobPayload): Promise<void> {
    switch (name) {
      case 'generate_hyde':
        await this.handleGenerateHyde(data as IntentJobData);
        break;
      case 'reconcile_intent_networks':
        await this.handleReconcileNetworks(data as IntentJobData);
        break;
      case 'reconcile_orphaned_intent':
        await this.handleReconcileOrphanedIntent(data as IntentJobData);
        break;
      case 'delete_hyde':
        await this.handleDeleteHyde(data as IntentDeleteData);
        break;
      default:
        this.logger.warn('Unknown job name', { name });
    }
  }

  /**
   * Run assignment-only reconciliation for an intent. Unlike
   * {@link generateHyde} this never regenerates HyDE docs or runs
   * opportunity discovery — it only (re)evaluates and writes intent_networks
   * rows. Used by network-join backfill and the orphan-reconcile sweep.
   *
   * @param data - intentId, userId, and optional scope envelope to restrict the
   *   evaluated network set (defaults to all assignment-eligible memberships).
   */
  addReconcileJob(data: IntentJobData): Promise<void> {
    return this.addJob('reconcile_intent_networks', data, {
      jobId: `reconcile-${data.intentId}-${data.scopeId ?? data.networkScopeId ?? 'global'}`,
    });
  }

  /**
   * Re-admit an active intent only when an indexing prerequisite is absent.
   * Rechecks lifecycle, ownership, membership, scope, assignments,
   * and HyDE state at execution time, making retries safe after pauses,
   * archives, unassignments, or scoped-agent changes.
   */
  addOrphanReconciliationJob(data: IntentJobData): Promise<void> {
    return this.addJob('reconcile_orphaned_intent', data, {
      jobId: `reconcile-orphaned-${data.intentId}-${data.scopeId ?? data.networkScopeId ?? 'global'}`,
    });
  }

  /**
   * Run a network-scoped reconcile for every active intent a user owns.
   *
   * This is the join-time half of the protocol rule "membership re-evaluates a
   * member's existing intents against the network": intents created before the
   * user joined never get an assignment pass for the new network otherwise.
   * Driven by the `NetworkMembershipEvents.onMemberAdded` hook so it fires for
   * every membership path (REST self-join, owner-add, and the protocol
   * `create_network_membership` graph) — all converge on `addMemberToNetwork`.
   * Best-effort per intent; assignment-only (no HyDE/opportunity side effects).
   *
   * @param userId - The member whose existing intents should be re-evaluated.
   * @param networkId - The joined network; scopes evaluation to it.
   * @returns The number of reconcile runs started.
   */
  async addNetworkReconcileForUser(userId: string, networkId: string): Promise<number> {
    const db = this.deps?.database ?? this.database;
    const intents = await db.getActiveIntents(userId);
    await Promise.all(
      intents.map((i) =>
        this.addReconcileJob({ intentId: i.id, userId, scopeType: 'network', scopeId: networkId }).catch((err) =>
          this.reconcileLogger.warn('Reconcile failed', { intentId: i.id, networkId, userId, error: err }),
        ),
      ),
    );
    this.reconcileLogger.info('Started network reconcile for member', { userId, networkId, intentCount: intents.length });
    return intents.length;
  }

  /**
   * Run HyDE generation for an intent synchronously (e.g. during db-seed).
   * When skipOpportunity is true, does not start opportunity discovery — use for seed to avoid matching test users.
   * @param data - intentId and userId
   * @param options - skipOpportunity: if true, do not add opportunity discovery job
   */
  async runGenerateHydeSync(
    data: IntentJobData,
    options?: { skipOpportunity?: boolean }
  ): Promise<void> {
    const addOpportunityJob = options?.skipOpportunity
      ? async () => {}
      : (this.deps?.addOpportunityJob ?? ((d: { intentId: string; userId: string; networkIds?: string[] }) => intentDiscovery.addJob(d)));
    await this.handleGenerateHyde(data, { addOpportunityJob });
  }

  private async handleGenerateHyde(
    data: IntentJobData,
    overrides?: { addOpportunityJob?: (d: { intentId: string; userId: string; networkIds?: string[] }) => Promise<unknown> }
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
    const { assignedNetworkIds } = await this.assignIntentToNetworks(intentId, userId, scope);
    this.hydeLogger.info('Index assignment complete', { intentId, assignedIndexCount: assignedNetworkIds.length });

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
    this.hydeLogger.info('HyDE generation complete, enqueuing opportunity discovery', { intentId, userId });
    const addJob =
      overrides?.addOpportunityJob ??
      this.deps?.addOpportunityJob ??
      ((d: { intentId: string; userId: string; networkIds?: string[] }) => intentDiscovery.addJob(d));
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
      await addJob({
        intentId,
        userId,
        ...discoveryScope,
      });
    } catch (error) {
      this.hydeLogger.error('Discovery start failed', {
        event: 'intent_discovery_start_failed',
        intentId,
        userId,
        error,
      });
      throw error;
    }
  }

  /**
   * Resolve the user's eligible networks (respecting optional scope), score the
   * intent against each, and upsert intent_networks rows for assigned networks.
   *
   * Pure assignment: no HyDE regeneration and no opportunity discovery, so it is
   * safe to call for reconciliation/backfill without spamming users with new
   * opportunity notifications on existing intents. Idempotent —
   * {@link ChatDatabaseAdapter.assignIntentToNetworkIfMember} upserts on
   * (intentId, networkId).
   *
   * @param intentId - Intent to assign.
   * @param userId - Owner of the intent.
   * @param opts - Optional scope envelope to restrict the evaluated set and a
   *   `source` tag recorded in assignment metadata.
   * @returns Assigned network IDs and the number of networks evaluated.
   */
  private async assignIntentToNetworks(
    intentId: string,
    userId: string,
    opts?: { scopeType?: ToolScopeType; scopeId?: string; networkScopeId?: string; source?: string },
  ): Promise<{ assignedNetworkIds: string[]; evaluatedCount: number }> {
    const scope = resolveIntentJobScope(opts);
    const source = opts?.source ?? 'intent-indexing';
    const db = this.deps?.database ?? this.database;
    const intent = await db.getIntentForIndexing(intentId);
    if (!intent) {
      this.assignLogger.warn('Intent not found, skipping', { intentId });
      return { assignedNetworkIds: [], evaluatedCount: 0 };
    }
    if (
      intent.userId !== userId ||
      intent.archivedAt ||
      (intent.status != null && intent.status !== 'ACTIVE')
    ) {
      this.assignLogger.info('Intent is not eligible for assignment, skipping', {
        intentId,
        userId,
        actualUserId: intent.userId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return { assignedNetworkIds: [], evaluatedCount: 0 };
    }

    const assignedNetworkIds: string[] = [];
    let evaluatedCount = 0;
    try {
      const assignmentMemberships = await this.getAssignmentMemberships(userId);
      const userIndexIds = resolveAssignmentNetworkScope({ memberships: assignmentMemberships, ...scope });
      evaluatedCount = userIndexIds.length;
      this.assignLogger.info('User assignment networks found', { intentId, userId, indexCount: userIndexIds.length, indexIds: userIndexIds });

      // Instantiate the model-backed evaluator only when at least one network
      // actually has prompts. Prompt-less networks deterministically assign at
      // score 1 and must not require an OpenRouter credential.
      let evaluateIntentAssignment = this.deps?.evaluateIntentAssignment;
      const getIntentAssignmentEvaluator = () => {
        evaluateIntentAssignment ??= (() => {
          const indexer = new Intents();
          return (o: {
            intent: string;
            indexPrompt: string | null;
            memberPrompt: string | null;
            sourceName?: string | null;
          }) => indexer.indexIntent(o.intent, o.indexPrompt, o.memberPrompt, o.sourceName ?? null);
        })();
        return evaluateIntentAssignment;
      };

      const sourceName = intent.sourceType
        ? `${intent.sourceType}:${intent.sourceId ?? ''}`
        : undefined;

      const scoringResults = await Promise.all(
        userIndexIds.map(async (networkId) => {
          const ctx = await db.getNetworkAssignmentContext(networkId, userId);
          if (!ctx) {
            this.assignLogger.warn('Assignment context missing for network, skipping fail-closed', { intentId, userId, networkId });
            return null;
          }
          const indexPrompt = ctx.indexPrompt ?? null;
          const memberPrompt = ctx.memberPrompt ?? null;
          const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();
          let result: IntentIndexerOutput | null = null;
          if (hasPrompts) {
            try {
              result = await getIntentAssignmentEvaluator()({
                intent: intent.payload,
                indexPrompt,
                memberPrompt,
                sourceName,
              });
            } catch (err) {
              this.assignLogger.warn('IntentIndexer failed for network', { intentId, networkId, error: err });
            }
          }

          const decision = buildNetworkAssignmentDecision({
            resourceType: 'intent',
            mode: 'automatic',
            scope: scope.scopeType ? 'network' : 'global',
            indexPrompt,
            memberPrompt,
            rawScores: result ? { indexScore: result.indexScore, memberScore: result.memberScore } : undefined,
            evaluator: 'intent-networker',
            source,
            reason: result?.reasoning,
            createdAt: new Date().toISOString(),
          });
          return { networkId, decision };
        })
      );

      for (const scoringResult of scoringResults) {
        if (!scoringResult) continue;
        const { networkId, decision } = scoringResult;
        if (!decision.assigned) continue;
        try {
          const outcome = await db.assignIntentToNetworkIfMember(
            userId,
            intentId,
            networkId,
            decision.finalScore,
            decision.metadata,
          );
          if (outcome.kind === 'assigned' || outcome.kind === 'already_assigned') {
            assignedNetworkIds.push(networkId);
          } else {
            this.assignLogger.debug('Assign intent to network skipped by final authority', {
              intentId,
              networkId,
              outcome: outcome.kind,
            });
          }
        } catch (assignErr) {
          this.assignLogger.debug('Assign intent to network skipped', { intentId, networkId, error: assignErr });
        }
      }
    } catch (err) {
      this.assignLogger.warn('Failed to assign intent to user networks', { intentId, userId, error: err });
    }

    if (assignedNetworkIds.length === 0) {
      // Explicit orphan signal: an intent registered to no network is invisible
      // in every network UI. Surface it so it can be alerted on or swept rather
      // than silently lost.
      this.assignLogger.warn('Intent assigned to no networks', {
        event: 'intent_network_assignment_zero',
        intentId,
        userId,
        scopeType: scope.scopeType,
        scopeId: scope.scopeId,
        evaluatedCount,
        reason: evaluatedCount === 0 ? 'no_eligible_memberships' : 'below_threshold_or_assignment_failure',
      });
    }
    return { assignedNetworkIds, evaluatedCount };
  }

  /**
   * Handle a `reconcile_intent_networks` job: run assignment only, with no HyDE
   * regeneration or opportunity discovery. Idempotent and safe to re-run.
   *
   * @param data - intentId, userId, and optional scope envelope.
   */
  private async handleReconcileNetworks(data: IntentJobData): Promise<void> {
    const { intentId, userId } = data;
    await this.assignIntentToNetworks(intentId, userId, { ...resolveIntentJobScope(data), source: 'intent-reconcile' });
  }

  /**
   * Re-run the normal admission sequence for an active intent whose assignment
   * or intent HyDE artifact is missing. This deliberately does not treat a
   * prompted below-threshold result as an error: the normal assignment policy
   * remains authoritative, including deterministic 1.0 promptless assignment.
   */
  private async handleReconcileOrphanedIntent(data: IntentJobData): Promise<void> {
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

    const [assignedNetworkIds, hydeDocuments, memberships] = await Promise.all([
      db.getNetworkIdsForIntent(intentId),
      db.getHydeDocumentsForSource('intent', intentId),
      this.getAssignmentMemberships(userId),
    ]);
    const eligibleNetworkIds = new Set(resolveAssignmentNetworkScope({ memberships, ...scope }));
    const validAssignedNetworkIds = assignedNetworkIds.filter((networkId) => eligibleNetworkIds.has(networkId));
    if (validAssignedNetworkIds.length > 0 && hydeDocuments.length > 0) {
      this.reconcileLogger.info('Orphan reconciliation already satisfied', {
        event: 'intent_orphan_reconciliation_noop',
        intentId,
        userId,
        assignedNetworkCount: validAssignedNetworkIds.length,
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
      assignedNetworkCount: validAssignedNetworkIds.length,
      hydeDocumentCount: hydeDocuments.length,
    });
    await this.handleGenerateHyde({ intentId, userId, ...scope });
  }

  private async handleDeleteHyde(data: IntentDeleteData): Promise<void> {
    const { intentId } = data;
    const db = this.deps?.database ?? this.database;
    await db.deleteHydeDocumentsForSource('intent', intentId);
    this.hydeLogger.verbose('Deleted HyDE documents for intent', { intentId });
  }
}

/** Singleton intent indexing follow-up. */
export const intentIndexing = new IntentIndexing();
