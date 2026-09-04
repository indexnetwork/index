/**
 * Database operations for user contexts.
 */

/** User-context operations. */
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

  // ─── Profile context for intent discovery ───

  /**
   * Profile text for a user (sourced from the users row). Used by discovery.
   */
  getUserContext(userId: string, networkId: string | null): Promise<{
    id: string;
    text: string;
    embedding: number[];
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
