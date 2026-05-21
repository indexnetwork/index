import { log } from '../lib/log';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { ChatGraphFactory, ChatTitleGenerator } from '@indexnetwork/protocol';
import type { ChatGraphCompositeDatabase } from '@indexnetwork/protocol';
import { getCheckpointer } from '../adapters/checkpointer.adapter';
import { HumanMessage } from '@langchain/core/messages';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const logger = log.service.from("ChatSessionService");

/**
 * Generates a Snowflake-like ID for chat messages.
 * Uses timestamp + random component for sortable, unique IDs.
 * Format: timestamp (42 bits) + random (22 bits)
 */
function generateSnowflakeId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 4194304); // 2^22
  const snowflake = BigInt(timestamp) * BigInt(4194304) + BigInt(random);
  return snowflake.toString();
}

/**
 * ChatSessionService — H2A (Human-to-Agent) conversation layer.
 *
 * Builds on the unified ConversationDatabaseAdapter to add agent-specific behavior:
 * graph invocation, SSE streaming, title generation, sharing, and ghost invites.
 *
 * Part of the unified conversation architecture:
 * - ConversationDatabaseAdapter: single data layer for all conversation types
 * - ConversationService: general conversation operations (H2H, DMs, metadata)
 * - ChatSessionService (this): H2A-specific behavior layered on top
 */
export class ChatSessionService {
  private graphDb: ChatGraphCompositeDatabase;
  private _factory: ChatGraphFactory | null = null;

  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {
    // Initialize protocol adapters for graph processing
    this.graphDb = new ChatDatabaseAdapter();
  }

  /**
   * Inject the ChatGraphFactory after construction.
   * Must be called before any method that uses the factory (processMessage, getGraphFactory, etc.).
   * Called by the composition root (mcp.controller.ts) during module initialization.
   *
   * @param factory - The ChatGraphFactory instance to use
   */
  setFactory(factory: ChatGraphFactory): void {
    this._factory = factory;
  }

  private get factory(): ChatGraphFactory {
    if (!this._factory) throw new Error('ChatGraphFactory not initialized — call setFactory() before use');
    return this._factory;
  }
  /**
   * Create a new chat session for a user.
   *
   * @param userId - The user's UUID
   * @param title - Optional title for the session
   * @param networkId - Optional index (community) ID to scope the conversation
   * @returns The created session ID
   */
  async createSession(userId: string, title?: string, networkId?: string): Promise<string> {
    logger.verbose('Creating new session', { userId, hasTitle: Boolean(title?.trim()), networkId: networkId ?? undefined });

    const id = crypto.randomUUID();
    await this.db.createChatSession({ id, userId, title, networkId });

    return id;
  }

  /**
   * Update the index scope for a session. Validates ownership.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @param networkId - The index ID to set, or undefined to clear
   * @returns True if updated, false if not found or unauthorized
   */
  async updateSessionIndex(sessionId: string, userId: string, networkId: string | undefined): Promise<boolean> {
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return false;
    }

    await this.db.updateChatSessionIndex(sessionId, networkId?.trim() || null);

    logger.verbose('Session index updated', { sessionId, networkId: networkId ?? null });
    return true;
  }

  /**
   * Validate that a user can scope chat to an index.
   * Requires the index to exist and the user to be a member.
   */
  async validateIndexScope(
    userId: string,
    networkId: string
  ): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
    const normalizedIndexId = networkId.trim();
    const index = await this.graphDb.getNetwork(normalizedIndexId);
    if (!index) {
      return { ok: false, status: 404, error: 'Index not found' };
    }

    const isMember = await this.graphDb.isNetworkMember(normalizedIndexId, userId);
    if (!isMember) {
      return { ok: false, status: 403, error: 'You are not a member of this index' };
    }

    return { ok: true };
  }

  /**
   * Get a session by ID, validating ownership.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @returns The session if found and owned by user, null otherwise
   */
  async getSession(sessionId: string, userId: string) {
    logger.verbose('Getting session', { sessionId, userId });
    
    const session = await this.db.getChatSession(sessionId);
    
    if (!session || session.userId !== userId) {
      logger.warn('Session not found or unauthorized', { sessionId, userId });
      return null;
    }
    
    return session;
  }

  /**
   * Get all sessions for a user, ordered by most recent.
   * 
   * @param userId - The user's UUID
   * @param limit - Maximum number of sessions to return (default: 20)
   * @returns List of sessions
   */
  async getUserSessions(userId: string, limit = 10) {
    logger.verbose('Getting user sessions', { userId, limit });
    
    return this.db.getUserChatSessions(userId, limit);
  }

  /**
   * Add a message to a session.
   * 
   * @param params - Message parameters
   * @returns The created message ID (snowflake format)
   */
  async addMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    routingDecision?: Record<string, unknown>;
    subgraphResults?: Record<string, unknown>;
    tokenCount?: number;
  }): Promise<string> {
    logger.verbose('Adding message', {
      sessionId: params.sessionId,
      role: params.role,
      contentLength: params.content.length,
    });

    const id = generateSnowflakeId();

    await this.db.createChatMessage({
      id,
      sessionId: params.sessionId,
      role: params.role,
      content: params.content,
      routingDecision: params.routingDecision,
      subgraphResults: params.subgraphResults,
      tokenCount: params.tokenCount,
    });

    // Update session timestamp
    await this.db.updateChatSessionTimestamp(params.sessionId);

    return id;
  }

  /**
   * Get messages for a session in chronological order.
   * 
   * @param sessionId - The session ID
   * @param limit - Maximum number of messages to return (all if omitted)
   * @returns List of messages
   */
  async getSessionMessages(sessionId: string, limit?: number) {
    logger.verbose('Getting session messages', { sessionId, limit });
    
    return this.db.getChatSessionMessages(sessionId, limit);
  }

  /**
   * Delete a session and all its messages (cascade).
   * 
   * @param sessionId - The session ID to delete
   * @param userId - The user ID to validate ownership
   * @returns True if deleted, false if not found or unauthorized
   */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    logger.verbose('Deleting session', { sessionId, userId });
    
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      logger.warn('Cannot delete: session not found or unauthorized', { sessionId, userId });
      return false;
    }
    
    await this.db.deleteChatSession(sessionId);
    
    logger.verbose('Session deleted', { sessionId });
    return true;
  }

  /**
   * Update session title.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @param title - The new title
   * @returns True if updated, false if not found or unauthorized
   */
  async updateSessionTitle(sessionId: string, userId: string, title: string): Promise<boolean> {
    logger.verbose('Updating session title', { sessionId, userId, titleLength: title.length });
    
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return false;
    }
    
    await this.db.updateChatSessionTitle(sessionId, title);
    
    return true;
  }

  async shareSession(sessionId: string, userId: string): Promise<string | null> {
    const session = await this.getSession(sessionId, userId);
    if (!session) return null;

    if (session.shareToken) return session.shareToken;

    const token = crypto.randomUUID();
    await this.db.setChatShareToken(sessionId, token);
    logger.verbose('Session shared', { sessionId });
    return token;
  }

  async unshareSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.getSession(sessionId, userId);
    if (!session) return false;

    await this.db.setChatShareToken(sessionId, null);
    logger.verbose('Session unshared', { sessionId });
    return true;
  }

  async getSharedSession(shareToken: string) {
    const session = await this.db.getChatSessionByShareToken(shareToken);
    if (!session) return null;

    const messages = await this.db.getChatSessionMessages(session.id, 200);
    return { session, messages };
  }

  /**
   * Process a message through the chat graph (non-streaming).
   * 
   * @param userId - The user ID
   * @param messageContent - The message content
   * @returns Graph execution result with response text
   */
  async processMessage(userId: string, messageContent: string): Promise<{
    responseText: string;
    error?: string;
  }> {
    logger.verbose('Processing message', { userId });

    const graph = this.factory.createGraph();
    const result = await graph.invoke({
      userId,
      messages: [new HumanMessage(messageContent)]
    });

    return {
      responseText: result.responseText || '',
      error: result.error
    };
  }

  /**
   * Get checkpointer for streaming (if needed).
   * 
   * @returns PostgresSaver checkpointer or undefined
   */
  async getCheckpointer(): Promise<PostgresSaver | undefined> {
    try {
      return await getCheckpointer();
    } catch (error) {
      logger.warn('Failed to initialize checkpointer', {
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Get the chat graph factory for streaming operations.
   * This is used by controllers that need to stream chat events.
   * 
   * @returns The ChatGraphFactory instance
   */
  getGraphFactory(): ChatGraphFactory {
    return this.factory;
  }

  /**
   * Verify that a message belongs to a session owned by the given user.
   *
   * @param messageId - The message ID to check
   * @param userId - The user ID to verify ownership against
   * @returns True if the message exists and its session is owned by the user
   */
  async verifyMessageOwnership(messageId: string, userId: string): Promise<boolean> {
    return this.db.verifyChatMessageOwnership(messageId, userId);
  }

  /**
   * Save trace events and debug metadata for a chat message.
   *
   * @param params - Message metadata to persist
   */
  async saveMessageMetadata(params: {
    messageId: string;
    userId?: string;
    traceEvents?: unknown;
    debugMeta?: unknown;
    streamingDrafts?: unknown;
  }): Promise<void> {
    if (params.userId) {
      const isOwner = await this.db.verifyChatMessageOwnership(params.messageId, params.userId);
      if (!isOwner) throw new Error('Not authorized');
    }
    const id = generateSnowflakeId();
    await this.db.upsertChatMessageMetadata({
      id,
      messageId: params.messageId,
      traceEvents: params.traceEvents,
      debugMeta: params.debugMeta,
      streamingDrafts: params.streamingDrafts,
    });
  }

  /**
   * Upsert session-level metadata (e.g. aggregated debug info).
   *
   * @param params - Session metadata to persist
   */
  async upsertSessionMetadata(params: {
    sessionId: string;
    metadata: unknown;
  }): Promise<void> {
    const id = generateSnowflakeId();
    await this.db.upsertChatSessionMetadata({
      id,
      sessionId: params.sessionId,
      metadata: params.metadata,
    });
  }

  /**
   * Retrieve message metadata for a list of message IDs.
   *
   * @param messageIds - The message IDs to look up
   * @returns Array of message metadata records
   */
  async getMessageMetadataByMessageIds(messageIds: string[]) {
    return this.db.getChatMessageMetadataByIds(messageIds);
  }

  /**
   * Retrieve session metadata by session ID.
   *
   * @param sessionId - The session ID
   * @returns The session metadata record or undefined
   */
  async getSessionMetadata(sessionId: string) {
    return this.db.getChatSessionMetadata(sessionId);
  }

  /**
   * Auto-generate a session title based on conversation history.
   * 
   * @param sessionId - The session ID
   * @param userId - The user ID
   * @returns The generated title or undefined if generation fails
   */
  async generateSessionTitle(sessionId: string, userId: string): Promise<string | undefined> {
    logger.verbose('Generating session title', { sessionId });

    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return undefined;
    }

    // Only generate if there's no title yet
    if (session.title?.trim()) {
      return session.title;
    }

    const messages = await this.getSessionMessages(sessionId, 10);
    const hasUser = messages.some((m) => m.role === 'user');
    const hasAssistant = messages.some((m) => m.role === 'assistant');

    if (!hasUser || !hasAssistant) {
      return undefined;
    }

    try {
      const titleGenerator = new ChatTitleGenerator();
      const title = await titleGenerator.invoke({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      await this.updateSessionTitle(sessionId, userId, title);
      logger.verbose('Session title generated', { sessionId, titleLength: title.length });

      return title;
    } catch (err) {
      logger.warn('Failed to generate session title', {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
}

export const chatSessionService = new ChatSessionService();
