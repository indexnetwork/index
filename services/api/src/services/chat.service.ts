import { log } from '../lib/log';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import type { ChatPersonaId, ChatScopeType } from '../adapters/database.shared';
import { ChatGraphFactory, ChatTitleGenerator, PERSONAL_AGENT_PERSONA_ID, createPersonalAgentPersona } from '@indexnetwork/protocol';
import type { ChatGraphCompositeDatabase, PersonalAgentScope } from '@indexnetwork/protocol';
import { getCheckpointer } from '../adapters/checkpointer.adapter';
import type { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const logger = log.service.from("ChatSessionService");

export type ChatStreamSurface = 'web' | 'agent' | 'onboarding';

export type ChatPersonaPolicyCode =
  | 'WEB_SIGNAL_SESSION_REQUIRED'
  | 'CHAT_PERSONA_UNSUPPORTED';

export type ChatPersonaPolicyResult =
  | { ok: true; persona: ChatPersonaId }
  | {
      ok: false;
      status: 409;
      code: ChatPersonaPolicyCode;
      error: string;
      action?: { type: 'start_signal_session'; href: string };
    };

/**
 * The retired pre-personafication default. Kept as a literal (not a protocol
 * import) because the persona no longer exists in the runtime — only its rows
 * do, and history has to stay listable and readable.
 */
export const RETIRED_ORCHESTRATOR_PERSONA_ID = 'orchestrator';

/** Telegram notification transcript. Not a chat persona — nothing drives a turn in it. */
export const TELEGRAM_TRANSCRIPT_PERSONA_ID = 'telegram';

/**
 * Persona values whose stored sessions stay readable but can never drive a
 * turn. The policy answers these with a read-only nudge rather than a generic
 * "unsupported" error so the product can keep showing the history.
 */
const READ_ONLY_CHAT_PERSONAS: ReadonlySet<string> = new Set([
  RETIRED_ORCHESTRATOR_PERSONA_ID,
  TELEGRAM_TRANSCRIPT_PERSONA_ID,
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
 * Narrows a personal agent row to the identity a persona introduces itself
 * with. An absent or blank name yields `{}` so the prompt uses its generic
 * fallback rather than a product noun.
 */
function personaIdentity(agent?: { name?: string | null } | null): { agentName?: string } {
  const agentName = agent?.name?.trim();
  return agentName ? { agentName } : {};
}

/**
 * ChatSessionService — H2A (Human-to-Agent) conversation layer.
 *
 * Builds on the unified ConversationDatabaseAdapter to add agent-specific behavior:
 * graph invocation, SSE streaming, title generation, and sharing.
 *
 * Part of the unified conversation architecture:
 * - ConversationDatabaseAdapter: single data layer for all conversation types
 * - ConversationService: general conversation operations (H2H, DMs, metadata)
 * - ChatSessionService (this): H2A-specific behavior layered on top
 */
interface ChatSessionServiceDeps {
  graphDatabase?: ChatGraphCompositeDatabase;
  createTitleGenerator?: () => Pick<ChatTitleGenerator, 'invoke'>;
  now?: () => Date;
}

export class ChatSessionService {
  private graphDb: ChatGraphCompositeDatabase;
  private _factory: ChatGraphFactory | null = null;
  private readonly createTitleGenerator: () => Pick<ChatTitleGenerator, 'invoke'>;
  private readonly now: () => Date;

  constructor(
    private db: ConversationDatabaseAdapter = conversationDatabaseAdapter,
    deps: ChatSessionServiceDeps = {},
  ) {
    this.graphDb = deps.graphDatabase ?? new ChatDatabaseAdapter();
    this.createTitleGenerator = deps.createTitleGenerator ?? (() => new ChatTitleGenerator());
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Inject the ChatGraphFactory after construction.
   * Must be called before any method that uses the factory (the persona graph accessors, session streaming, etc.).
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
   * There is one live persona: PersonalAgent. The policy only fails closed on
   * stored rows that cannot drive a turn — retired read-only personas keep a
   * product-safe nudge, anything else unknown is refused. What a turn may do
   * is decided by the session's scope in the controller, never by a persona
   * id.
   *
   * @param input - The continued session's persisted persona, when present
   * @returns The allowed persona or a typed product-safe denial
   */
  resolveStreamPersonaPolicy(input: {
    storedPersona?: string;
  } = {}): ChatPersonaPolicyResult {
    const storedPersona = input.storedPersona?.trim() || undefined;

    // These sessions stay readable; they just cannot drive a turn.
    if (storedPersona && READ_ONLY_CHAT_PERSONAS.has(storedPersona)) {
      return {
        ok: false,
        status: 409,
        code: 'WEB_SIGNAL_SESSION_REQUIRED',
        error: 'This earlier chat is read-only. Start a new chat with your agent to continue.',
        action: { type: 'start_signal_session', href: '/' },
      };
    }
    if (storedPersona && storedPersona !== PERSONAL_AGENT_PERSONA_ID) {
      return {
        ok: false,
        status: 409,
        code: 'CHAT_PERSONA_UNSUPPORTED',
        error: 'This chat cannot be continued safely.',
      };
    }

    return { ok: true, persona: PERSONAL_AGENT_PERSONA_ID };
  }

  /**
   * Create a new chat session for a user.
   *
   * @param userId - The user's UUID
   * @param title - Optional title for the session
   * @param networkId - Optional index (community) ID to scope the conversation
   * @param scope - Optional canonical network or intent scope
   * @param persona - Persisted persona driving the session (required)
   * @returns The created session ID
   */
  async createSession(
    userId: string,
    title: string | undefined,
    networkId: string | undefined,
    scope: { scopeType: ChatScopeType; scopeId: string } | undefined,
    persona: ChatPersonaId,
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
   * Resolve or create the user's PersonalAgent session pinned to one of their
   * intents — the signal's DM. One session per (user, intent): keyed in
   * `chat_session_scopes` as ('personal-intent', intentId). Race-safe via the
   * unique index (concurrent creates re-read on 23505).
   *
   * The name is part of the IntentAgent host's contract
   * (`lib/intent-agent/intent-agent.host.ts` resolves DM delivery through it),
   * which the parallel negotiation rewrite owns — so it keeps its historical
   * name for now.
   *
   * @param userId - The client user (must own the intent)
   * @param intentId - The intent to pin
   * @returns The session plus the validated intent title
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
   * The user's negotiator session for an intent if it already exists — the
   * read-only companion to {@link resolveNegotiatorIntentSession}. Background
   * work that only wants to rewrite what is already in the DM (the
   * question-message close-out) uses this so it never conjures an empty
   * conversation for a signal the client has never opened.
   *
   * @param userId - The client user
   * @param intentId - The pinned intent
   * @returns The session, or null when the DM does not exist yet
   */
  async findNegotiatorIntentSession(userId: string, intentId: string) {
    return this.db.getNegotiatorIntentChatSession(userId, intentId.trim());
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
    persona: string,
  ) {
    logger.verbose('Getting user sessions', { userId, limit, persona });
    return this.db.getUserChatSessions(userId, limit, persona);
  }

  /**
   * Get ordinary main-web history: readable retired personas plus global
   * PersonalAgent chats. Intent-pinned sessions (a signal's DM) are excluded —
   * they are reached through their signal, not the home history list.
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
      [RETIRED_ORCHESTRATOR_PERSONA_ID, TELEGRAM_TRANSCRIPT_PERSONA_ID, PERSONAL_AGENT_PERSONA_ID],
      { excludeIntentPinned: true },
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
    /** Canned replies rendered as chips under an agent question. */
    options?: string[];
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
      options: params.options,
    });

    // Update session timestamp
    await this.db.updateChatSessionTimestamp(params.sessionId);

    return id;
  }

  /**
   * The newest message in a session, by the same order the session reads use.
   * Anchor read for the question-message edit rule.
   *
   * @param sessionId - The session ID
   * @returns The newest message, or null for an empty session
   */
  async getNewestMessage(sessionId: string) {
    return this.db.getNewestChatMessage(sessionId);
  }

  /**
   * In-place regeneration of an open question-message (the conversational
   * questions edit rule). The write is guarded inside the data layer: it only
   * applies to an agent-authored message in the caller's
   * ('negotiator-intent', intentId) session while that message is still the
   * newest in its conversation.
   *
   * @returns False when the message lost the newest-message race (or is out
   *   of scope) and the caller should append a fresh message instead.
   */
  async updateQuestionMessageInPlace(params: {
    userId: string;
    intentId: string;
    messageId: string;
    content: string;
  }): Promise<boolean> {
    return this.db.updateNewestAgentQuestionMessage({ ...params, regeneratedAt: new Date() });
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
   * Loads the active or one immediately previous durable timeline session for an
   * authorized H2A conversation.
   *
   * @param conversationId - Chat conversation identifier.
   * @param beforeSessionId - Cursor of the currently oldest loaded session.
   * @returns One session section, its messages, and whether another section precedes it.
   */
  async getConversationSessionHistory(conversationId: string, beforeSessionId?: string) {
    return this.db.getChatConversationSessionHistory(conversationId, { beforeSessionId });
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
   * Derive the PersonalAgent graph factory for a scope while sharing the
   * persona-neutral runtime and all injected dependencies.
   *
   * The persona introduces itself as the client's own agent, so it is bound
   * per session to their `type='personal'` agent row. A missing row leaves
   * the name absent and the prompt falls back to a generic self-description —
   * the chat surface still works.
   *
   * Intent-scoped DM turns never derive a graph factory at all: every turn of
   * a signal's DM runs the IntentAgent on its serialized inbox, and none of
   * the retired negotiator-persona chat tool registrations exist any more.
   * The hosts those tools called stay shared: the MCP surface
   * (mcp.controller toolDeps) still registers them.
   *
   * @param scope - The session's derived scope
   * @param agent - Identity from the user's `type='personal'` agent row
   * @returns A PersonalAgent sibling factory
   */
  getPersonalAgentGraphFactory(scope: PersonalAgentScope, agent?: { name?: string | null } | null): ChatGraphFactory {
    return this.factory.withPersona(createPersonalAgentPersona(personaIdentity(agent), scope));
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
      const titleGenerator = this.createTitleGenerator();
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
