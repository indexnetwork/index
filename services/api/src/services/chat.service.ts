import { log } from '../lib/log';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import type { ChatScopeType } from '../adapters/database.shared';
import { ChatGraphFactory, ChatTitleGenerator, NEGOTIATOR_PERSONA_ID, createNegotiatorPersona } from '@indexnetwork/protocol';
import type { ChatGraphCompositeDatabase } from '@indexnetwork/protocol';
import { getCheckpointer } from '../adapters/checkpointer.adapter';
import { negotiatorMemoryRetrievalAdapter } from '../adapters/negotiator-memory.retrieval.adapter';
import { isNegotiatorMemoryWriteEnabled } from '../lib/negotiator-feature';
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
  async createSession(
    userId: string,
    title?: string,
    networkId?: string,
    scope?: { scopeType: ChatScopeType; scopeId: string },
  ): Promise<string> {
    logger.verbose('Creating new session', {
      userId,
      hasTitle: Boolean(title?.trim()),
      networkId: networkId ?? undefined,
      scopeType: scope?.scopeType,
      scopeId: scope?.scopeId,
    });

    const id = crypto.randomUUID();
    await this.db.createChatSession({
      id,
      userId,
      title,
      networkId,
      ...(scope ? { scopeType: scope.scopeType, scopeId: scope.scopeId } : {}),
    });

    return id;
  }

  /**
   * Update the network scope for a session. Validates ownership.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to validate ownership
   * @param networkId - The network ID to set, or undefined to clear
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
   * Update the canonical focused scope for a session. Validates ownership.
   */
  async updateSessionScope(
    sessionId: string,
    userId: string,
    scope: { scopeType: ChatScopeType; scopeId: string } | null,
  ): Promise<boolean> {
    const session = await this.getSession(sessionId, userId);
    if (!session) {
      return false;
    }

    await this.db.updateChatSessionScope(
      sessionId,
      userId,
      scope?.scopeType ?? null,
      scope?.scopeId ?? null,
    );

    logger.verbose('Session scope updated', { sessionId, scopeType: scope?.scopeType ?? null, scopeId: scope?.scopeId ?? null });
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
      return { ok: false, status: 403, error: 'You are not a member of this network' };
    }

    return { ok: true };
  }

  /**
   * Validate that a user can scope chat to one of their intents.
   * Intent scope is owner-only because intent listing pages show the user's own intents.
   */
  async validateIntentScope(
    userId: string,
    intentId: string,
  ): Promise<{ ok: true; title: string } | { ok: false; status: 403 | 404; error: string }> {
    const normalizedIntentId = intentId.trim();
    const intent = await this.graphDb.getIntent(normalizedIntentId);
    if (!intent || intent.archivedAt) {
      return { ok: false, status: 404, error: 'Intent not found' };
    }
    if (intent.userId !== userId) {
      return { ok: false, status: 403, error: 'You do not have access to this intent' };
    }

    const rawTitle = (intent.summary?.trim() || intent.payload?.trim() || 'Intent chat').replace(/\s+/g, ' ');
    const title = rawTitle.length > 80 ? `${rawTitle.slice(0, 77)}…` : rawTitle;
    return { ok: true, title };
  }

  /**
   * Resolve or create the stable orchestrator session for a scoped entity.
   */
  async resolveSessionForScope(
    userId: string,
    scope: { scopeType: ChatScopeType; scopeId: string },
  ) {
    const normalizedScopeId = scope.scopeId.trim();
    if (!normalizedScopeId) {
      return { error: 'scopeId is required', status: 400 as const };
    }

    let title: string | undefined;
    if (scope.scopeType === 'network') {
      const validation = await this.validateIndexScope(userId, normalizedScopeId);
      if (!validation.ok) return validation;
    } else {
      const validation = await this.validateIntentScope(userId, normalizedScopeId);
      if (!validation.ok) return validation;
      title = validation.title;
    }

    const existing = await this.db.getChatSessionByScope(userId, scope.scopeType, normalizedScopeId);
    if (existing) return { session: existing, created: false };

    try {
      const id = await this.createSession(
        userId,
        title,
        scope.scopeType === 'network' ? normalizedScopeId : undefined,
        { scopeType: scope.scopeType, scopeId: normalizedScopeId },
      );
      const session = await this.getSession(id, userId);
      if (!session) return { error: 'Failed to create session', status: 500 as const };
      return { session, created: true };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const raced = await this.db.getChatSessionByScope(userId, scope.scopeType, normalizedScopeId);
        if (raced) return { session: raced, created: false };
      }
      throw err;
    }
  }

  /**
   * Resolve or create the user's stable negotiator DM session (P4.1).
   * Idempotent: repeat calls return the same session. Race-safe via the
   * chat_session_scopes unique index (concurrent creates re-read on 23505).
   *
   * @param userId - The client user
   * @param title - Session title used on first creation (the negotiator agent's name)
   */
  async resolveNegotiatorSession(
    userId: string,
    title?: string,
  ): Promise<{ session: NonNullable<Awaited<ReturnType<ChatSessionService['getSession']>>>; created: boolean } | { error: string; status: 500 }> {
    const existing = await this.db.getNegotiatorChatSession(userId);
    if (existing) return { session: existing, created: false };

    try {
      const id = crypto.randomUUID();
      await this.db.createNegotiatorChatSession({ id, userId, title });
      const session = await this.getSession(id, userId);
      if (!session) return { error: 'Failed to create negotiator session', status: 500 as const };
      return { session, created: true };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const raced = await this.db.getNegotiatorChatSession(userId);
        if (raced) return { session: raced, created: false };
      }
      throw err;
    }
  }

  /**
   * Resolve or create the user's negotiator session pinned to one of their
   * intents (P4.2/IND-403). One session per (user, intent, negotiator
   * persona): keyed in `chat_session_scopes` as ('negotiator-intent',
   * intentId), so it never collides with the orchestrator's ('intent',
   * intentId) session for the same intent. Race-safe via the unique index
   * (concurrent creates re-read on 23505).
   *
   * @param userId - The client user (must own the intent)
   * @param intentId - The intent to pin
   * @returns The session plus the validated intent title (for prompt pinning)
   */
  async resolveNegotiatorIntentSession(
    userId: string,
    intentId: string,
  ): Promise<
    | { session: NonNullable<Awaited<ReturnType<ChatSessionService['getSession']>>>; created: boolean; intentTitle: string }
    | { error: string; status: 400 | 403 | 404 | 500 }
  > {
    const normalizedIntentId = intentId.trim();
    if (!normalizedIntentId) {
      return { error: 'intentId is required', status: 400 as const };
    }

    const validation = await this.validateIntentScope(userId, normalizedIntentId);
    if (!validation.ok) return validation;

    const existing = await this.db.getNegotiatorIntentChatSession(userId, normalizedIntentId);
    if (existing) return { session: existing, created: false, intentTitle: validation.title };

    try {
      const id = crypto.randomUUID();
      await this.db.createNegotiatorIntentChatSession({
        id,
        userId,
        intentId: normalizedIntentId,
        title: validation.title,
      });
      const session = await this.getSession(id, userId);
      if (!session) return { error: 'Failed to create negotiator session', status: 500 as const };
      return { session, created: true, intentTitle: validation.title };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const raced = await this.db.getNegotiatorIntentChatSession(userId, normalizedIntentId);
        if (raced) return { session: raced, created: false, intentTitle: validation.title };
      }
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
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
   * @param limit - Maximum number of sessions to return (default: 10)
   * @param persona - Optional persona filter (e.g. 'orchestrator'). Omit for all.
   * @returns List of sessions
   */
  async getUserSessions(userId: string, limit = 10, persona?: string) {
    logger.verbose('Getting user sessions', { userId, limit, persona });

    // The negotiator DM is a pinned surface, not history: without an explicit
    // persona filter it is excluded from the recent-sessions listing.
    const excludePersona = persona ? undefined : NEGOTIATOR_PERSONA_ID;
    return this.db.getUserChatSessions(userId, limit, persona, excludePersona);
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
    interrupted?: boolean;
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
      interrupted: params.interrupted,
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
   * Derive a negotiator-persona graph factory bound to the client's personal
   * negotiator agent identity. Shares all dependencies with the orchestrator
   * factory; only prompt/toolset/loop behaviors differ.
   *
   * @param agent - Identity from the user's `type='personal'` agent row
   * @param pinnedIntent - Optional pinned-signal label for intent-scoped
   *                       sessions (P4.2); rendered in the prompt's pinned
   *                       signal section
   */
  async getNegotiatorGraphFactory(
    agent: { name: string; description?: string | null },
    userId: string,
    pinnedIntent?: { label?: string },
  ): Promise<ChatGraphFactory> {
    // P5.3: the client's accumulated negotiator memories inform the DM
    // persona (gated on NEGOTIATOR_MEMORY_INJECT; [] → byte-identical
    // prompt). The adapter never throws — the catch is belt and braces so a
    // memory failure can never take down the chat surface.
    const memory = await negotiatorMemoryRetrievalAdapter.retrieveForChat(userId).catch(() => []);
    return this.factory.withPersona(
      createNegotiatorPersona({
        agentName: agent.name,
        ...(agent.description?.trim() ? { agentDescription: agent.description } : {}),
        ...(pinnedIntent?.label?.trim() ? { pinnedIntentLabel: pinnedIntent.label.trim() } : {}),
        ...(memory.length > 0 ? { memory } : {}),
        // P5.4: the remember/forget tools are registered by the composition
        // root under the same flag — the prompt advertises them only when
        // they actually exist for this session.
        ...(isNegotiatorMemoryWriteEnabled() ? { memoryToolsEnabled: true } : {}),
      }),
    );
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
