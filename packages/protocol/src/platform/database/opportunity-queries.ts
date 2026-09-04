/**
 * Database operations for HyDE documents and the opportunity lifecycle.
 */

import type { OutcomeOutbox } from './capabilities.js';
import type { CreateHydeDocumentData, CreateIntentCounterpartyData, CreateOpportunityData, HydeDocument, HydeSourceType, IntentScopedOpportunityPersistenceResult, OpenedNegotiation, Opportunity, OpportunityActor, OpportunityNetworkEligibility, OpportunityQueryOptions, OpportunityStatus } from './entities.js';

/** HyDE document and opportunity persistence operations. */
export interface DatabaseOpportunityQueries {
  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Document Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a HyDE document by source and strategy/lens hash.
   * Returns the first matching document when multiple target corpuses exist.
   *
   * @param sourceType - 'intent' | 'query'
   * @param sourceId - Source entity ID (e.g. intent ID, user ID)
   * @param strategy - Lens hash (SHA-256 of lens label) or legacy strategy name
   * @returns The HyDE document or null if not found
   */
  getHydeDocument(
    sourceType: HydeSourceType,
    sourceId: string,
    strategy: string
  ): Promise<HydeDocument | null>;

  /**
   * Get all HyDE documents for a source (all strategies).
   *
   * @param sourceType - 'intent' | 'query'
   * @param sourceId - Source entity ID
   * @returns Array of HyDE documents for that source
   */
  getHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<HydeDocument[]>;

  /**
   * Save a HyDE document (upsert by sourceType + sourceId + strategy/lensHash + targetCorpus).
   *
   * @param data - HyDE document data
   * @returns The saved HyDE document
   */
  saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument>;

  /**
   * Delete all HyDE documents for a source (e.g. when intent archived).
   *
   * @param sourceType - 'intent' | 'query'
   * @param sourceId - Source entity ID
   * @returns Number of documents deleted
   */
  deleteHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<number>;

  /**
   * Delete expired HyDE documents (expires_at <= now). Used by maintenance jobs.
   *
   * @returns Number of documents deleted
   */
  deleteExpiredHydeDocuments(): Promise<number>;

  /**
   * Get stale HyDE documents for refresh (e.g. createdAt < threshold).
   *
   * @param threshold - Date threshold; documents created before this are considered stale
   * @returns Array of stale HyDE documents
   */
  getStaleHydeDocuments(threshold: Date): Promise<HydeDocument[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new opportunity.
   *
   * @param data - Opportunity creation data
   * @returns The created opportunity
   */
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;

  /**
   * Turn every pair discovery scored into an opportunity with a negotiation
   * record beside it, and hand back the ones that were newly opened.
   *
   * There is no open decision to make: whether a match is worth pursuing is
   * the initiator's first turn. Implementations key on `pairKey`, so a pair the
   * counterparty's run already opened is skipped and the result is exactly the
   * set the caller still owes a `negotiation.turn`.
   */
  openCounterparties(pairs: CreateIntentCounterpartyData[]): Promise<OpenedNegotiation[]>;

  /**
   * Atomically create only while every actor still has an active membership on
   * the actor's network. Implementations lock the membership rows through the
   * insert commit so concurrent removal cannot race opportunity creation.
   */
  createOpportunityIfNetworkEligible?(
    data: CreateOpportunityData,
    eligibility: OpportunityNetworkEligibility,
  ): Promise<Opportunity | null>;

  /**
   * Intent-scoped discovery persistence boundary. Implementations serialize on
   * the normalized intent pair, reject any existing opportunity for that exact
   * pair, then create/expire while the existing network eligibility locks
   * remain held. Other intents remain fully independent.
   */
  persistIntentScopedOpportunityIfNetworkEligible?(
    data: CreateOpportunityData,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibility & { triggerIntentId: string },
  ): Promise<IntentScopedOpportunityPersistenceResult | null>;

  /**
   * Atomically update status only while the supplied participant anchors remain
   * active and, when supplied, the opportunity still has `expectedStatus`.
   * Used for discovery dedup reactivation races.
   *
   * @param id - Opportunity ID
   * @param status - Target lifecycle status
   * @param actors - Participant anchors that must remain network-eligible
   * @param eligibility - Authoritative owner/network/intent scope
   * @param expectedStatus - Optional compare-and-set source status
   * @returns The updated opportunity, or null after eligibility/status drift
   */
  updateOpportunityStatusIfNetworkEligible?(
    id: string,
    status: OpportunityStatus,
    actors: OpportunityActor[],
    eligibility: OpportunityNetworkEligibility,
    expectedStatus?: OpportunityStatus,
  ): Promise<Opportunity | null>;

  /**
   * Get a single opportunity by ID.
   *
   * @param id - Opportunity ID
   * @returns The opportunity or null if not found
   */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /**
   * Get multiple opportunities by ID in a single batched query.
   *
   * Returns rows in arbitrary order; callers should index by `id`.
   * Missing IDs are silently dropped (no error).
   *
   * @param ids - Opportunity IDs (deduplicated by the caller is fine but not required)
   * @returns Opportunities found
   */
  getOpportunitiesByIds(ids: string[]): Promise<Opportunity[]>;

  /**
   * Find opportunities that superseded a previous opportunity through enrichment.
   * Uses the existing JSONB `detection.enrichedFrom` array, so no schema-level relation is required.
   * Results are newest-first so callers can choose the newest visible replacement.
   *
   * @param opportunityId - Superseded opportunity ID
   * @returns Replacement opportunities, newest first
   */
  findEnrichedReplacementOpportunities(opportunityId: string): Promise<Opportunity[]>;

  /**
   * Resolve an opportunity identifier (full UUID or short prefix) to a full UUID.
   * @param idOrPrefix - Full UUID or short hex prefix
   * @param userId - The user ID (for visibility scoping)
   * @returns Resolved ID, ambiguous marker, or null if not found
   */
  resolveOpportunityId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null>;

  /**
   * Get opportunities for a user (as any actor role).
   *
   * @param userId - User ID (actor userId)
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForUser(
    userId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Get the live candidate pool created exactly by one intent and visible to
   * its recipient. Unlike selected-intent reads, this never falls back to an
   * actor.intent match.
   */
  getLivePoolOpportunitiesForIntent(
    recipientUserId: string,
    intentId: string,
  ): Promise<Opportunity[]>;

  /**
   * Get opportunities in an index (for index admins).
   *
   * @param networkId - Network ID
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForNetwork(
    networkId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Update an opportunity's status.
   *
   * @param id - Opportunity ID
   * @param status - New status
   * @param acceptedBy - Required when `status === 'accepted'`
   * @param outbox - Optional IND-434 atomic outcome-capture (same-txn insert)
   * @returns The updated opportunity or null if not found
   */
  updateOpportunityStatus(
    id: string,
    status: OpportunityStatus,
    acceptedBy?: string,
    outbox?: OutcomeOutbox,
  ): Promise<Opportunity | null>;

  /**
   * Stamp `actedAt` on the actor matching `actorUserId` and update the
   * opportunity's status atomically (row-lock + JSONB merge in one txn).
   *
   * Used by `sendNode` (status → 'pending') and `updateNode` (status →
   * 'accepted'). The self-accept guard is enforced in the caller, not here —
   * this method blindly stamps. Callers must pre-check `actor.actedAt` before
   * invocation when the semantics require it (i.e. accepting).
   *
   * @param id - Opportunity ID
   * @param actorUserId - The user whose actor entry should be stamped
   * @param status - New opportunity status
   * @param acceptedBy - Required when `status === 'accepted'`
   * @param outbox - Optional IND-434 atomic outcome-capture (same-txn insert)
   * @returns The updated opportunity, or null if not found
   */
  stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: OpportunityStatus,
    acceptedBy?: string,
    outbox?: OutcomeOutbox,
  ): Promise<Opportunity | null>;

  /**
   * Create one opportunity and expire others in a single transaction.
   * Atomic: insert then update status to 'expired' for each id in expireIds.
   * Used when enriching replaces overlapping opportunities so subscribers see consistent state.
   *
   * @param data - Opportunity creation data (caller may set status when enriched)
   * @param expireIds - Opportunity IDs to set status to 'expired'
   * @returns The created opportunity and the list of opportunities that were expired
   */
  createOpportunityAndExpireIds(
    data: CreateOpportunityData,
    expireIds: string[]
  ): Promise<{ created: Opportunity; expired: Opportunity[] }>;

  /** Eligibility-locked variant of create+expire for discovery persistence. */
  createOpportunityAndExpireIdsIfNetworkEligible?(
    data: CreateOpportunityData,
    expireIds: string[],
    eligibility: OpportunityNetworkEligibility,
  ): Promise<{ created: Opportunity; expired: Opportunity[] } | null>;

  /**
   * Check if an opportunity already exists between the given actors in the index (deduplication).
   *
   * @param actorIds - Array of user IDs that would be actors
   * @param networkId - Network ID
   * @returns True if a non-expired opportunity exists with exactly these actors in this network
   */
  opportunityExistsBetweenActors(
    actorIds: string[],
    networkId: string
  ): Promise<boolean>;

  /**
   * Find opportunities whose actors contain all the given user IDs.
   *
   * The `includeIntroducers` flag controls actor matching: when false (default), matching
   * is restricted by role; when true, any role in `actors` counts.
   *
   * Index-agnostic. Ordered by updatedAt desc.
   *
   * @param actorIds - User IDs that must all appear in each returned opportunity's actors
   * @param options - includeIntroducers (default false), statuses (include filter), excludeStatuses (exclude filter)
   * @returns Matching opportunities, newest first
   */
  findOpportunitiesByActors(
    actorIds: string[],
    options?: {
      includeIntroducers?: boolean;
      statuses?: OpportunityStatus[];
      excludeStatuses?: OpportunityStatus[];
    }
  ): Promise<Opportunity[]>;

  /**
   * IND-567 Rejection cool-down: returns the subset of `candidateUserIds` that
   * have at least one non-draft opportunity with `discovererId` whose `updatedAt`
   * falls within the last `windowMs` milliseconds AND whose status is `rejected`
   * `rejected`. Used by the evaluation node to apply a score penalty before
   * sending candidates to the LLM, suppressing cross-query re-surfacing of
   * recently-rejected pairs.
   *
   * Optional — adapters that do not implement it return `undefined`; the graph
   * degrades gracefully (no penalty applied, dedup persist-node guard still fires).
   *
   * @param discovererId - User running discovery
   * @param candidateUserIds - Candidate user IDs to check (may be empty — return [])
   * @param windowMs - Look-back window in milliseconds
   * @returns Candidate user IDs (subset of input) with a recent rejected opp
   */
  getRecentlyRejectedOpportunityCounterparties?(
    discovererId: string,
    candidateUserIds: string[],
    windowMs: number,
  ): Promise<string[]>;

  /**
   * Expire opportunities referencing an intent (e.g. when intent is archived).
   *
   * @param intentId - Intent ID to match in opportunity actors
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesByIntent(intentId: string): Promise<number>;

  /**
   * Expire opportunities for a user removed from an index.
   *
   * @param networkId - Network ID
   * @param userId - User ID that was removed
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesForRemovedMember(
    networkId: string,
    userId: string
  ): Promise<number>;

  /**
   * Expire opportunities whose expires_at <= now. Used by maintenance cron.
   *
   * @returns Number of opportunities updated to expired
   */
  expireStaleOpportunities(): Promise<number>;

  /**
   * Accept all sibling opportunities between the same actor pair in one transaction.
   * Selects opportunities where both userId and counterpartUserId are actors and status
   * is not accepted/expired/rejected, excludes excludeOpportunityId, then bulk-updates status to accepted.
   * Rolls back on any failure.
   *
   * @param userId - First actor user ID
   * @param counterpartUserId - Second actor user ID
   * @param excludeOpportunityId - Opportunity ID to exclude (the one already being accepted)
   * @returns IDs of opportunities that were updated to accepted
   */
  acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]>;

}
