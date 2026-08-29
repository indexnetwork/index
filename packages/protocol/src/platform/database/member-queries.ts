/**
 * Database operations for premises and user contexts.
 */

import type { NetworkAssignmentMetadata } from '../../protocol/schemas/network-assignment.schema.js';
import type { PremiseAnalysis, PremiseAssertion, PremiseProvenance, PremiseRecord, PremiseValidity } from './entities.js';

/** Premise and user-context operations. */
export interface DatabaseMemberQueries {
  /**
   * Finds an existing DM conversation between two users, or creates one.
   * Uses a unique `dmPair` column (sorted user IDs joined by ':') to
   * prevent duplicate DMs under concurrency. Used by the Start Chat flow
   * (Plan B Task 8) to atomically surface the h2h conversation when
   * accepting an opportunity.
   */
  getOrCreateDM(userA: string, userB: string, participantType?: 'user' | 'agent'): Promise<{ id: string }>;

  /**
   * Clears hiddenAt for a user on a conversation, making it visible in their
   * conversation list again. Called by startChat when reusing an existing DM
   * that the user had previously hidden.
   */
  unhideConversation(userId: string, conversationId: string): Promise<void>;

  /** Find a user by email. */
  getUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null>;

  // ─── Premise operations ──────────────────────────────────────────────────────

  createPremise(input: {
    userId: string;
    assertion: PremiseAssertion;
    provenance: PremiseProvenance;
    analysis?: PremiseAnalysis;
    validity: PremiseValidity;
    embedding?: number[];
  }): Promise<PremiseRecord>;

  getPremise(premiseId: string): Promise<PremiseRecord | null>;

  getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<PremiseRecord[]>;

  /**
   * Retrieve a user's premises assigned to one of the provided networks.
   * Optional for older/test adapters; OpportunityGraph falls back to capped
   * getPremisesForUser results when unavailable.
   */
  getPremisesForUserInNetworks?(userId: string, networkIds: string[], status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED', limit?: number): Promise<PremiseRecord[]>;

  updatePremise(premiseId: string, updates: {
    assertion?: PremiseAssertion;
    analysis?: PremiseAnalysis;
    validity?: PremiseValidity;
    embedding?: number[];
    status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    retractedAt?: Date;
  }): Promise<PremiseRecord>;

  assignPremiseToNetwork(
    premiseId: string,
    networkId: string,
    relevancyScore: number,
    assignmentMetadata?: NetworkAssignmentMetadata,
  ): Promise<void>;

  getPremiseNetworks(premiseId: string): Promise<Array<{
    networkId: string;
    relevancyScore: number | null;
    assignmentMetadata?: NetworkAssignmentMetadata | null;
  }>>;

  /**
   * Cosine similarity search against premise embeddings, scoped to shared networks.
   * Used by the opportunity graph's premise discovery path (path D).
   */
  searchPremisesBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
    minScore?: number;
  }): Promise<Array<{
    premiseId: string;
    userId: string;
    networkId: string;
    assertionText: string;
    similarity: number;
  }>>;

  /**
   * Batched version of premise similarity search. Executes one bounded DB call
   * for all selected source premises instead of one query per source premise.
   * Optional for older/test adapters; OpportunityGraph falls back to the
   * single-source method when unavailable.
   */
  searchPremisesBySimilarityBatch?(params: {
    sources: Array<{ premiseId: string; embedding: number[] }>;
    networkIds: string[];
    excludeUserId: string;
    limitPerSource: number;
    minScore?: number;
  }): Promise<Array<{
    sourcePremiseId: string;
    premiseId: string;
    userId: string;
    networkId: string;
    assertionText: string;
    similarity: number;
  }>>;

  /**
   * Find the single most-similar ACTIVE premise belonging to the SAME user whose
   * cosine similarity to `embedding` meets or exceeds `threshold`. Used by the
   * premise graph to skip near-duplicate premises on create. Returns null when no
   * active premise clears the threshold (or the user has none with an embedding).
   * Optional so older/test adapters can omit it — the premise graph skips dedup
   * when it is unavailable.
   */
  findSimilarActivePremise?(params: {
    userId: string;
    embedding: number[];
    threshold: number;
  }): Promise<{ premiseId: string; assertionText: string; similarity: number } | null>;

  // ─── Profile context for intent discovery ───

  /**
   * Profile text for a user (sourced from the users row). Used by discovery.
   */
  getUserContext(userId: string, networkId: string | null): Promise<{
    id: string;
    text: string;
    embedding: number[];
    premiseHash: string;
    generatedAt: Date;
  } | null>;

  /**
   * Cosine similarity search against intent embeddings using a context embedding.
   * Restores the profile→intent cross-search deleted when Path B was removed.
   */
  searchIntentsByContextEmbedding(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
    minScore?: number;
  }): Promise<Array<{
    intentId: string;
    userId: string;
    networkId: string;
    payload: string;
    summary: string | null;
    similarity: number;
  }>>;
}
