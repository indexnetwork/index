import { log } from '../lib/log';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import type { ChatPersonaId, ChatScopeType } from '../adapters/database.shared';
import { ChatGraphFactory, ChatTitleGenerator, NEGOTIATOR_PERSONA_ID, ORCHESTRATOR_PERSONA_ID, SIGNAL_PERSONA, SIGNAL_PERSONA_ID, createNegotiatorPersona } from '@indexnetwork/protocol';
import type { ChatGraphCompositeDatabase } from '@indexnetwork/protocol';
import { getCheckpointer } from '../adapters/checkpointer.adapter';
import { negotiatorMemoryRetrievalAdapter } from '../adapters/negotiator-memory.retrieval.adapter';
import { isNegotiatorMemoryWriteEnabled } from '../lib/negotiator-feature';
import { isWebSignalAgentEnabled } from '../lib/signal-feature';
import { HumanMessage } from '@langchain/core/messages';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const logger = log.service.from("ChatSessionService");

export type ChatStreamSurface = 'web' | 'non_web';

export type ChatPersonaPolicyCode =
  | 'WEB_SIGNAL_PERSONA_REQUIRED'
  | 'WEB_SIGNAL_SESSION_REQUIRED'
  | 'CHAT_PERSONA_MISMATCH'
  | 'CHAT_PERSONA_UNSUPPORTED'
  | 'WEB_SIGNAL_AGENT_DISABLED'
  | 'WEB_SIGNAL_PERSONA_FORBIDDEN';

export type ChatPersonaPolicyResult =
  | { ok: true; persona: ChatPersonaId }
  | {
      ok: false;
      status: 403 | 409;
      code: ChatPersonaPolicyCode;
      error: string;
      action?: { type: 'start_signal_session'; href: '/' };
    };

const KNOWN_CHAT_PERSONAS: ReadonlySet<string> = new Set([
  ORCHESTRATOR_PERSONA_ID,
  SIGNAL_PERSONA_ID,
  NEGOTIATOR_PERSONA_ID,
]);

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
   * Resolve the persona allowed to create or continue a streamed chat.
   *
   * Web-surface routes participate in the Signal cutover; non-web routes
   * retain the orchestrator default. A persisted persona is
   * authoritative and unknown values always fail closed.
   *
   * @param input - Server-selected route surface plus requested/persisted persona
   * @returns The allowed persona or a typed product-safe denial
   */
  resolveStreamPersonaPolicy(input: {
    surface: ChatStreamSurface;
    requestedPersona?: string;
    storedPersona?: string;
  }): ChatPersonaPolicyResult {
    const webSignalEnabled = isWebSignalAgentEnabled();
    const requestedPersona = input.requestedPersona?.trim() || undefined;
    const storedPersona = input.storedPersona?.trim() || undefined;

    if (storedPersona && !KNOWN_CHAT_PERSONAS.has(storedPersona)) {
      return {
        ok: false,
        status: 409,
        code: 'CHAT_PERSONA_UNSUPPORTED',
        error: 'This chat cannot be continued safely.',
      };
    }
    if (requestedPersona && !KNOWN_CHAT_PERSONAS.has(requestedPersona)) {
      return {
        ok: false,
        status: 409,
        code: 'CHAT_PERSONA_UNSUPPORTED',
        error: 'This chat type is not supported.',
      };
    }

    if (storedPersona) {
      if (requestedPersona && requestedPersona !== storedPersona) {
        return {
          ok: false,
          status: 409,
          code: 'CHAT_PERSONA_MISMATCH',
          error: 'This request does not match the chat that was opened.',
        };
      }

      if (storedPersona === SIGNAL_PERSONA_ID) {
        if (!webSignalEnabled) {
          return {
            ok: false,
            status: 409,
            code: 'WEB_SIGNAL_AGENT_DISABLED',
            error: 'Signal Agent is not available right now. Your chat history is still saved.',
          };
        }
        if (input.surface !== 'web') {
          return {
            ok: false,
            status: 403,
            code: 'WEB_SIGNAL_PERSONA_FORBIDDEN',
            error: 'This chat can only be continued in the web app.',
          };
        }
        return { ok: true, persona: SIGNAL_PERSONA_ID };
      }

      if (
        storedPersona === ORCHESTRATOR_PERSONA_ID
        && webSignalEnabled
        && input.surface === 'web'
      ) {
        return {
          ok: false,
          status: 409,
          code: 'WEB_SIGNAL_SESSION_REQUIRED',
          error: 'This earlier chat is read-only. Start a new Signal Agent chat to continue.',
          action: { type: 'start_signal_session', href: '/' },
        };
      }

      return { ok: true, persona: storedPersona as ChatPersonaId };
    }

    if (requestedPersona === SIGNAL_PERSONA_ID) {
      if (!webSignalEnabled) {
        return {
          ok: false,
          status: 409,
          code: 'WEB_SIGNAL_AGENT_DISABLED',
          error: 'Signal Agent is not available right now.',
        };
      }
      if (input.surface !== 'web') {
        return {
          ok: false,
          status: 403,
          code: 'WEB_SIGNAL_PERSONA_FORBIDDEN',
          error: 'Signal Agent chats can only be started in the web app.',
        };
      }
      return { ok: true, persona: SIGNAL_PERSONA_ID };
    }

    if (requestedPersona === NEGOTIATOR_PERSONA_ID) {
      return { ok: true, persona: NEGOTIATOR_PERSONA_ID };
    }

    if (webSignalEnabled && input.surface === 'web') {
      return {
        ok: false,
        status: 409,
        code: 'WEB_SIGNAL_PERSONA_REQUIRED',
        error: 'Start a new Signal Agent chat to continue.',
        action: { type: 'start_signal_session', href: '/' },
      };
    }

    return { ok: true, persona: ORCHESTRATOR_PERSONA_ID };
  }

  /**
   * Create a new chat session for a user.
   *
   * @param userId - The user's UUID
   * @param title - Optional title for the session
   * @param networkId - Optional index (community) ID to scope the conversation
   * @param scope - Optional canonical network or intent scope
   * @param persona - Persisted persona, defaulting to orchestrator
   * @returns The created session ID
   */
  async createSession(
    userId: string,
    title?: string,
    networkId?: string,
    scope?: { scopeType: ChatScopeType; scopeId: string },
    persona: ChatPersonaId = ORCHESTRATOR_PERSONA_ID,
  ): Promise<string> {
    logger.verbose('Creating new session', {
      userId,
      hasTitle: Boolean(title?.trim()),
      networkId: networkId ?? undefined,
      scopeType: scope?.scopeType,
      scopeId: scope?.scopeId,
      persona,
    });

    const id = crypto.randomUUID();
    await this.db.createChatSession({
      id,
      userId,
      title,
      networkId,
      ...(scope ? { scopeType: scope.scopeType, scopeId: scope.scopeId } : {}),
      persona,
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
      session.persona,
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
   * Resolve or create the stable persona-specific session for a scoped entity.
   */
  async resolveSessionForScope(
    userId: string,
    scope: { scopeType: ChatScopeType; scopeId: string },
    persona: ChatPersonaId = ORCHESTRATOR_PERSONA_ID,
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

    const existing = await this.db.getChatSessionByScope(userId, scope.scopeType, normalizedScopeId, persona);
    if (existing) return { session: existing, created: false };

    try {
      const id = await this.createSession(
        userId,
        title,
        scope.scopeType === 'network' ? normalizedScopeId : undefined,
        { scopeType: scope.scopeType, scopeId: normalizedScopeId },
        persona,
      );
      const session = await this.getSession(id, userId);
      if (!session) return { error: 'Failed to create session', status: 500 as const };
      return { session, created: true };
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        const raced = await this.db.getChatSessionByScope(userId, scope.scopeType, normalizedScopeId, persona);
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

  /**
   * True when the error (or any error in its `cause` chain) is a Postgres
   * unique violation. Drizzle wraps driver errors in `DrizzleQueryError`
   * with the pg error on `cause`, so checking only the top level misses the
   * 23505 and turns a benign create race into a 500.
   */
  private isUniqueViolation(err: unknown): boolean {
    let current: unknown = err;
    for (let depth = 0; current !== null && typeof current === 'object' && depth < 5; depth++) {
      if ((current as { code?: unknown }).code === '23505') return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
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
   * @param persona - Exact persona to list (defaults to orchestrator)
   * @returns List of sessions
   */
  async getUserSessions(
    userId: string,
    limit = 10,
    persona: string = ORCHESTRATOR_PERSONA_ID,
  ) {
    logger.verbose('Getting user sessions', { userId, limit, persona });
    return this.db.getUserChatSessions(userId, limit, persona);
  }

  /**
   * Get ordinary main-web history across the legacy orchestrator and Signal
   * personas while excluding the pinned negotiator surface.
   *
   * @param userId - The user's UUID
   * @param limit - Maximum number of sessions to return
   * @returns Web-visible chat sessions ordered by recency
   */
  async getWebUserSessions(userId: string, limit = 10) {
    logger.verbose('Getting web user sessions', { userId, limit });
    return this.db.getUserChatSessions(
      userId,
      limit,
      [ORCHESTRATOR_PERSONA_ID, SIGNAL_PERSONA_ID],
    );
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
   * Derive the restricted Signal Agent graph factory while sharing the
   * persona-neutral runtime and all injected dependencies.
   *
   * @returns A Signal-persona sibling factory
   */
  getSignalGraphFactory(): ChatGraphFactory {
    return this.factory.withPersona(SIGNAL_PERSONA);
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
