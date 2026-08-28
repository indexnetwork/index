import cron from 'node-cron';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { background } from '../lib/background';
import { ChatDatabaseAdapter, OpportunityDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

/** Payload for `premise_cascade` jobs. */
export interface PremiseCascadeData {
  /** The premise that was retracted or expired. */
  premiseId: string;
  /** Owner of the premise whose opportunities should be cascaded. */
  userId: string;
  /** What triggered the cascade. */
  event: 'retracted' | 'expired';
}

/** Payload for `premise_decompose_profile` jobs. */
export interface PremiseDecomposeProfileData {
  /** The user whose profile (name/location/intro) should be decomposed into premises. */
  userId: string;
}

// ---------------------------------------------------------------------------
// Opportunity status helpers (kept local to avoid importing schema at queue layer)
// ---------------------------------------------------------------------------

/**
 * In-flight statuses (sent or mid-negotiation) that expire when the premise
 * that motivated them lapses. `accepted` is deliberately excluded: a made
 * connection outlives its originating premise. `stalled` is reserved for
 * negotiation outcomes (turn cap / timeout / no consensus) and is never
 * written by this cascade.
 */
const IN_FLIGHT_STATUSES = ['pending', 'negotiating'] as const;

export type InFlightStatus = (typeof IN_FLIGHT_STATUSES)[number];
export type NonTerminalStatus = InFlightStatus;

// ---------------------------------------------------------------------------
// Grounded-intent re-verification tuning
// ---------------------------------------------------------------------------

/**
 * Cosine similarity floor for treating an intent as "grounded on" a lapsed
 * premise. There is no explicit premise→intent edge in the schema, so the
 * cascade uses embedding proximity (shared text-embedding-3-large space) as
 * the grounding heuristic. Deliberately below the 0.7 network-assignment
 * threshold: premise↔intent pairs are cross-genre (assertion vs. request), so
 * related pairs land lower in cosine space than same-genre pairs.
 */
const GROUNDED_INTENT_MIN_SIMILARITY = 0.5;

/** Max intents re-verified per cascade — caps LLM spend per retraction. */
const GROUNDED_INTENT_LIMIT = 5;

/**
 * Minimal verifier verdict consumed by the cascade. Structurally compatible
 * with the protocol package's `SemanticVerifierOutput` (which carries more
 * fields); kept narrow here so tests can stub it without importing protocol.
 */
export interface IntentReverificationVerdict {
  classification: string;
  felicity_scores: { clarity: number; authority: number; sincerity: number };
  semantic_entropy: number;
  flags: string[];
}

// ---------------------------------------------------------------------------
// Deps interface
// ---------------------------------------------------------------------------

/**
 * Optional dependencies for testing.
 * All fields are typed as narrow abstractions so tests can inject mocks
 * without pulling in concrete adapters.
 */
export interface PremiseQueueDeps {
  /**
   * Retrieve cascade-eligible (non-terminal, non-accepted) opportunities
   * where `userId` is an actor AND whose provenance cites `premiseId`
   * (evidence sourcePremiseId/candidatePremiseId, or actor-level grounding
   * premise). Returns a minimal shape: id + current status.
   */
  getOpportunitiesCitingPremise?: (
    userId: string,
    premiseId: string
  ) => Promise<Array<{ id: string; status: NonTerminalStatus }>>;

  /**
   * Transition an opportunity to a new status. The cascade only ever expires.
   */
  updateOpportunityStatus?: (opportunityId: string, status: 'expired') => Promise<void>;

  /**
   * Find ACTIVE premises whose validity.validUntil has passed.
   * Returns a minimal shape: id + userId.
   */
  getExpiredPremises?: () => Promise<Array<{ id: string; userId: string }>>;

  /**
   * Transition a premise to EXPIRED status.
   */
  expirePremise?: (premiseId: string) => Promise<void>;

  /**
   * Fetch the embedding of a premise (null when the premise is missing or
   * was never embedded — re-verification is skipped in that case).
   */
  getPremiseEmbedding?: (premiseId: string) => Promise<number[] | null>;

  /**
   * Find the user's ACTIVE intents grounded on the given embedding
   * (cosine-similarity heuristic — no explicit premise→intent edge exists).
   */
  getGroundedIntents?: (
    userId: string,
    embedding: number[]
  ) => Promise<Array<{ id: string; payload: string; similarity: number }>>;

  /**
   * Resolve the user's profile context (JSON string) for the verifier prompt.
   */
  getUserProfileContext?: (userId: string) => Promise<string>;

  /**
   * Re-run felicity verification on an intent payload against the profile.
   */
  verifyIntent?: (
    content: string,
    profileContext: string
  ) => Promise<IntentReverificationVerdict>;

  /**
   * Persist a re-verification verdict onto the intent (felicity scores +
   * semantic entropy).
   */
  applyIntentVerification?: (
    intentId: string,
    verdict: IntentReverificationVerdict
  ) => Promise<void>;

  /**
   * Decompose a user's profile text (name/location/intro) into premises via
   * the premise graph's `decompose` operation mode.
   */
  decomposeProfile?: (userId: string) => Promise<void>;
}

/**
 * Builds the free-text profile blob offered to premise decomposition.
 * Name + location + intro only — social links are scraper input, not
 * decomposer input (as decomposer input they'd just yield noise premises
 * like "I have a LinkedIn at …").
 */
function buildProfileInputFromUser(user: { name?: string | null; intro?: string | null; location?: string | null }): string {
  const lines: string[] = [];
  if (user.name?.trim()) lines.push(`Name: ${user.name.trim()}`);
  if (user.location?.trim()) lines.push(`Location: ${user.location.trim()}`);
  if (user.intro?.trim()) lines.push(user.intro.trim());
  return lines.filter((l) => l.trim()).join('\n\n');
}

// ---------------------------------------------------------------------------
// Queue class
// ---------------------------------------------------------------------------

/**
 * Premise cascade and profile regeneration queue.
 *
 * `premise_cascade` — when a premise is retracted or expired, expires only the
 * opportunities whose provenance cites that premise (evidence
 * sourcePremiseId/candidatePremiseId or actor-level grounding premise):
 * draft/latent/pending/negotiating → expired. Opportunities evidenced solely
 * by other premises are untouched (IND-423), `accepted` opportunities are left
 * alone (the connection already happened), and `stalled` is never written
 * here — it is strictly a negotiation outcome (turn cap / timeout / no
 * consensus). The cascade also re-verifies the user's intents grounded on the
 * lapsed premise (embedding-proximity heuristic) so their felicity scores
 * don't go stale.
 *
 */
export class PremiseQueue {
  private readonly logger = log.job.from('PremiseJob');
  private readonly expiryLogger = log.job.from('PremiseJob:ExpiryCheck');
  private readonly cascadeLogger = log.job.from('PremiseJob:Cascade');
  private readonly decomposeLogger = log.job.from('PremiseJob:DecomposeProfile');
  private readonly queueLogger = log.queue.from('PremiseQueue');
  private readonly deps: PremiseQueueDeps | undefined;
  private cronTask: ReturnType<typeof cron.schedule> | null = null;

  constructor(deps?: PremiseQueueDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Fire-and-forget triggers
  // -------------------------------------------------------------------------

  /**
   * Trigger a premise cascade in the background.
   * @param data - Cascade payload
   */
  addCascadeJob(data: PremiseCascadeData): Promise<void> {
    background('premise', () => this.premiseCascade(data));
    return Promise.resolve();
  }

  /**
   * Trigger profile decomposition in the background.
   * @param userId - The user whose profile should be decomposed
   */
  addDecomposeProfileJob(userId: string): Promise<void> {
    background('premise', () => this.decomposeProfile({ userId }));
    return Promise.resolve();
  }

  /**
   * Schedule expiry detection to run every hour. Call from the protocol server only.
   */
  startCrons(): void {
    if (this.cronTask) return; // idempotent
    this.cronTask = cron.schedule('0 * * * *', () => {
      this.checkExpiredPremises()
        .catch((err) => this.expiryLogger.error('Cron failed', { error: err }));
    });
    this.queueLogger.info('📅 Expiry check scheduled (every hour)');
  }

  /**
   * Find ACTIVE premises past their validUntil date and transition each to EXPIRED.
   * The adapter's updatePremise emits onExpired for downstream cascade/regen.
   * @returns Number of premises expired
   */
  async checkExpiredPremises(): Promise<number> {
    this.expiryLogger.verbose('Starting expired premise check');

    const getExpiredPremises =
      this.deps?.getExpiredPremises ??
      (() => this.defaultGetExpiredPremises());

    const expirePremise =
      this.deps?.expirePremise ??
      ((id: string) => this.defaultExpirePremise(id));

    const expired = await getExpiredPremises();
    this.expiryLogger.verbose('Found expired premises', { count: expired.length });

    for (const { id } of expired) {
      // onExpired fires inside the adapter's updatePremise (status EXPIRED) —
      // emitting here as well would double-enqueue the cascade/regen jobs.
      await expirePremise(id);
    }

    this.expiryLogger.info('Expired premises', { count: expired.length });
    return expired.length;
  }

  // -------------------------------------------------------------------------
  // Default production implementations (injected via deps or used as fallbacks)
  // -------------------------------------------------------------------------

  /**
   * Default production implementation: fetch the cascade-eligible
   * opportunities that cite the lapsed premise using a single filtered query.
   * `accepted` is intentionally outside the fetch scope — the cascade must
   * never touch a made connection — and opportunities that don't cite the
   * premise are outside it too (targeted revocation, IND-423).
   */
  private async defaultGetOpportunitiesCitingPremise(
    userId: string,
    premiseId: string
  ): Promise<Array<{ id: string; status: NonTerminalStatus }>> {
    const adapter = new OpportunityDatabaseAdapter();
    const cascadeStatuses: NonTerminalStatus[] = [...IN_FLIGHT_STATUSES];
    const rows = await adapter.getOpportunitiesCitingPremise(userId, premiseId, {
      statuses: cascadeStatuses,
    });
    return rows.map((row) => ({ id: row.id, status: row.status as NonTerminalStatus }));
  }

  /**
   * Default production implementation: update an opportunity's status in the
   * database.
   */
  private async defaultUpdateOpportunityStatus(
    opportunityId: string,
    status: 'expired'
  ): Promise<void> {
    const adapter = new OpportunityDatabaseAdapter();
    await adapter.updateOpportunityStatus(opportunityId, status);
  }

  /**
   * Default production implementation: query the database for ACTIVE premises
   * whose validity.validUntil has passed.
   */
  private async defaultGetExpiredPremises(): Promise<Array<{ id: string; userId: string }>> {
    const adapter = new ChatDatabaseAdapter();
    return adapter.getExpiredPremises();
  }

  /**
   * Default production implementation: set a premise's status to EXPIRED.
   */
  private async defaultExpirePremise(premiseId: string): Promise<void> {
    const adapter = new ChatDatabaseAdapter();
    await adapter.updatePremise(premiseId, { status: 'EXPIRED' });
  }

  async premiseCascade(data: PremiseCascadeData): Promise<void> {
    const { premiseId, userId, event } = data;
    this.cascadeLogger.info('Starting cascade', { premiseId, userId, event });

    const getOpportunitiesCitingPremise =
      this.deps?.getOpportunitiesCitingPremise ??
      ((uid: string, pid: string) => this.defaultGetOpportunitiesCitingPremise(uid, pid));

    const updateOpportunityStatus =
      this.deps?.updateOpportunityStatus ??
      ((oppId: string, status: 'expired') =>
        this.defaultUpdateOpportunityStatus(oppId, status));

    // Targeted revocation (IND-423): only opportunities whose provenance cites
    // the lapsed premise expire. Everything else the user has in flight —
    // including active negotiations grounded in unrelated premises — survives.
    // `stalled` is never written here: it is reserved for negotiation outcomes,
    // and `accepted` rows are outside the fetch scope entirely.
    const opportunities = await getOpportunitiesCitingPremise(userId, premiseId);
    for (const opp of opportunities) {
      await updateOpportunityStatus(opp.id, 'expired');
    }

    // Re-verify intents grounded on the lapsed premise so their felicity
    // scores (notably `felicityAuthority`, the preparatory condition) reflect
    // the reduced grounding. Failures here never fail the cascade job —
    // opportunity expiry must not be retried because an LLM call flaked.
    let reverified = 0;
    try {
      reverified = await this.reverifyGroundedIntents(userId, premiseId);
    } catch (err) {
      this.cascadeLogger.warn('Intent re-verification failed; cascade continues', {
        premiseId,
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.cascadeLogger.info('Cascade complete', {
      premiseId,
      userId,
      event,
      expired: opportunities.length,
      intentsReverified: reverified,
    });
  }

  async decomposeProfile(data: PremiseDecomposeProfileData): Promise<void> {
    const { userId } = data;
    this.decomposeLogger.info('Starting profile decomposition', { userId });

    const decomposeProfile =
      this.deps?.decomposeProfile ??
      ((uid: string) => this.defaultDecomposeProfile(uid));

    await decomposeProfile(userId);

    this.decomposeLogger.info('Profile decomposition complete', { userId });
  }

  /**
   * Default production implementation: build the profile text blob from the
   * users row and decompose it into premises via the premise graph. Imported
   * lazily so loading this queue module (and its tests) doesn't pull the LLM
   * stack.
   */
  private async defaultDecomposeProfile(userId: string): Promise<void> {
    const db = new ChatDatabaseAdapter();
    const user = await db.getUser(userId);
    if (!user) return;

    const input = buildProfileInputFromUser(user);
    if (!input.trim()) return;

    const { PremiseGraphFactory } = await import('@indexnetwork/protocol');
    const graph = new PremiseGraphFactory(db as unknown as PremiseGraphDatabase, new EmbedderAdapter()).createGraph();
    const result = await graph.invoke({ userId, input, operationMode: 'decompose' });
    if (result.error) {
      this.decomposeLogger.error('Profile decomposition failed', { userId, error: result.error });
    }
  }

  /**
   * Find the user's ACTIVE intents grounded on the lapsed premise (embedding
   * proximity — no explicit premise→intent edge exists in the schema) and
   * re-run felicity verification on each, persisting the fresh scores.
   * Per-intent verifier failures are logged and skipped; the count of
   * successfully re-verified intents is returned.
   */
  private async reverifyGroundedIntents(userId: string, premiseId: string): Promise<number> {
    const getPremiseEmbedding =
      this.deps?.getPremiseEmbedding ??
      ((pid: string) => this.defaultGetPremiseEmbedding(pid));

    const getGroundedIntents =
      this.deps?.getGroundedIntents ??
      ((uid: string, embedding: number[]) => this.defaultGetGroundedIntents(uid, embedding));

    const getUserProfileContext =
      this.deps?.getUserProfileContext ??
      ((uid: string) => this.defaultGetUserProfileContext(uid));

    const verifyIntent =
      this.deps?.verifyIntent ??
      ((content: string, profileContext: string) => this.defaultVerifyIntent(content, profileContext));

    const applyIntentVerification =
      this.deps?.applyIntentVerification ??
      ((intentId: string, verdict: IntentReverificationVerdict) =>
        this.defaultApplyIntentVerification(intentId, verdict));

    const embedding = await getPremiseEmbedding(premiseId);
    if (!embedding || embedding.length === 0) {
      this.cascadeLogger.verbose('No premise embedding; skipping intent re-verification', { premiseId });
      return 0;
    }

    const intents = await getGroundedIntents(userId, embedding);
    if (intents.length === 0) {
      this.cascadeLogger.verbose('No grounded intents to re-verify', { premiseId, userId });
      return 0;
    }

    const profileContext = await getUserProfileContext(userId);

    let reverified = 0;
    for (const intent of intents) {
      try {
        const verdict = await verifyIntent(intent.payload, profileContext);
        await applyIntentVerification(intent.id, verdict);
        reverified += 1;
        this.cascadeLogger.verbose('Intent re-verified after premise lapse', {
          intentId: intent.id,
          premiseId,
          similarity: intent.similarity,
          classification: verdict.classification,
          authority: verdict.felicity_scores.authority,
          flags: verdict.flags,
        });
      } catch (err) {
        this.cascadeLogger.warn('Intent re-verification failed for intent; skipping', {
          intentId: intent.id,
          premiseId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return reverified;
  }


  /**
   * Default production implementation: read the premise's stored embedding.
   */
  private async defaultGetPremiseEmbedding(premiseId: string): Promise<number[] | null> {
    const adapter = new ChatDatabaseAdapter();
    const premise = await adapter.getPremise(premiseId);
    return premise?.embedding ?? null;
  }

  /**
   * Default production implementation: cosine search over the user's own
   * ACTIVE intents, capped and thresholded (see tuning constants above).
   */
  private async defaultGetGroundedIntents(
    userId: string,
    embedding: number[]
  ): Promise<Array<{ id: string; payload: string; similarity: number }>> {
    const adapter = new ChatDatabaseAdapter();
    return adapter.getIntentsGroundedOnEmbedding({
      userId,
      embedding,
      minSimilarity: GROUNDED_INTENT_MIN_SIMILARITY,
      limit: GROUNDED_INTENT_LIMIT,
    });
  }

  /**
   * Default production implementation: serialize the user's profile for the
   * verifier prompt (same context shape the intent graph passes at creation).
   */
  private async defaultGetUserProfileContext(userId: string): Promise<string> {
    const adapter = new OpportunityDatabaseAdapter();
    const profile = await adapter.getProfile(userId);
    return JSON.stringify(profile ?? {});
  }

  /**
   * Default production implementation: run the protocol package's
   * intents verifier. Imported lazily so loading this queue module (and its
   * tests) doesn't pull the LLM stack.
   */
  private async defaultVerifyIntent(
    content: string,
    profileContext: string
  ): Promise<IntentReverificationVerdict> {
    const { Intents } = await import('@indexnetwork/protocol');
    const verifier = new Intents();
    return verifier.verifyIntent(content, profileContext);
  }

  /**
   * Default production implementation: persist fresh felicity scores and
   * semantic entropy onto the intent. Classification/flags are logged by the
   * caller but deliberately not acted on — auto-archiving an intent on a
   * degraded verdict would be over-invalidation of a different flavor.
   */
  private async defaultApplyIntentVerification(
    intentId: string,
    verdict: IntentReverificationVerdict
  ): Promise<void> {
    const adapter = new ChatDatabaseAdapter();
    await adapter.updateIntent(intentId, {
      felicityClarity: verdict.felicity_scores.clarity,
      felicityAuthority: verdict.felicity_scores.authority,
      felicitySincerity: verdict.felicity_scores.sincerity,
      semanticEntropy: verdict.semantic_entropy,
    });
  }
}

/** Singleton premise queue instance. Use for adding jobs and starting the worker. */
export const premiseQueue = new PremiseQueue();
