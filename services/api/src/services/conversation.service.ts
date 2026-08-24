import { log } from '../lib/log';

import { createRedisClient } from '../adapters/cache.adapter';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from('ConversationService');

/**
 * Manages conversation lifecycle, messaging, and DM deduplication.
 *
 * Part of the unified conversation architecture:
 * - ConversationDatabaseAdapter: single data layer for all conversation types (H2A, H2H, future A2A)
 * - ConversationService: general conversation operations (create, message, DM, metadata, real-time)
 * - ChatSessionService: layered on top for H2A-specific behavior (graph invocation, SSE streaming,
 *   title generation, sharing)
 *
 * @remarks Delegates all persistence to ConversationDatabaseAdapter. Does not call other services.
 */
export class ConversationService {
  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {}

  /**
   * Resolve a conversation identifier (full UUID or short prefix) to a full UUID.
   * @param idOrPrefix - Full UUID or short hex prefix
   * @param userId - The user ID (for participant scoping)
   * @returns Resolved ID, or error object with status
   */
  async resolveId(idOrPrefix: string, userId: string): Promise<{ id: string } | { error: string; status: number }> {
    const result = await this.db.resolveConversationId(idOrPrefix, userId);
    if (!result) {
      return { error: 'Conversation not found', status: 404 };
    }
    if ('ambiguous' in result) {
      return { error: 'Ambiguous ID prefix, please provide more characters', status: 409 };
    }
    return { id: result.id };
  }

  /**
   * Verifies a user is a participant in a conversation.
   * @param userId - User ID to verify
   * @param conversationId - Conversation ID
   * @throws Error if the user is not a participant
   */
  async verifyParticipant(userId: string, conversationId: string): Promise<void> {
    const ok = await this.db.isParticipant(conversationId, userId)
      || await this.db.isParticipant(conversationId, `agent:${userId}`);
    if (!ok) throw new Error('Forbidden: not a participant in this conversation');
  }

  /**
   * Creates a new conversation with the given participants.
   * @param participants - List of participant descriptors (user or agent)
   * @returns The newly created conversation
   */
  async createConversation(participants: { participantId: string; participantType: 'user' | 'agent' }[]) {
    return this.db.createConversation(participants);
  }

  /**
   * Retrieves a conversation by ID, including its participants.
   * @param conversationId - Conversation ID
   * @returns The conversation with participants, or null if not found
   */
  async getConversation(conversationId: string) {
    return this.db.getConversation(conversationId);
  }

  /**
   * Lists all visible conversations for a user, ordered by most recent message.
   * @param userId - The user whose conversations to list
   * @returns Summaries with participant lists
   */
  async getConversations(userId: string) {
    return this.db.getConversationsForUser(userId);
  }

  /**
   * Lists A2A conversations where `agent:{userId}` is a participant.
   * Used to surface negotiation conversations to the user whose agent participated.
   */
  async getAgentConversations(userId: string) {
    // The agent participant authenticates the A2A thread, while the owning
    // human is the only identity permitted to see intent provenance.
    return this.db.getConversationsForUser(`agent:${userId}`, userId, true);
  }

  async getNegotiationTaskIndex(userId: string) {
    return this.db.getNegotiationTaskIndex(userId);
  }

  /**
   * Returns the latest persisted A2A turns grouped by correspondent for one
   * intent owned by the authenticated user.
   */
  async getIntentCycleForIntent(userId: string, intentId: string) {
    return this.db.getIntentCycleForIntent(userId, intentId);
  }

  async getIntentCycleTimelineForIntent(userId: string, intentId: string) {
    return this.db.getIntentCycleTimelineForIntent(userId, intentId);
  }

  async getIntentCycleNegotiationForIntent(userId: string, intentId: string, taskId: string) {
    return this.db.getIntentCycleNegotiationForIntent(userId, intentId, taskId);
  }

  /**
   * Finds an existing DM between two users, or creates one if none exists.
   * @param userA - First user ID
   * @param userB - Second user ID
   * @returns The existing or newly created conversation
   */
  async getOrCreateDM(userA: string, userB: string) {
    return this.db.getOrCreateDM(userA, userB);
  }

  /**
   * Sends a message in a conversation.
   * @param conversationId - Conversation ID
   * @param senderId - ID of the sender (must be a participant)
   * @param role - Role of the sender ('user' or 'agent')
   * @param parts - Message content parts
   * @param opts - Optional task association and metadata
   * @returns The created message
   * @throws Error if senderId is not a participant
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    role: 'user' | 'agent',
    parts: unknown[],
    opts?: { taskId?: string; metadata?: Record<string, unknown> },
  ) {
    await this.verifyParticipant(senderId, conversationId);

    const msg = await this.db.createMessage({
      conversationId,
      senderId,
      role,
      parts,
      taskId: opts?.taskId,
      metadata: opts?.metadata,
    });

    return msg;
  }

  /**
   * Retrieves messages for a conversation.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), taskId filter, or userId for authorization
   * @returns Ordered list of messages
   * @throws Error if opts.userId is provided and is not a participant
   */
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string; taskId?: string; userId?: string }) {
    if (opts?.userId) {
      await this.verifyParticipant(opts.userId, conversationId);
    }
    return this.db.getMessages(conversationId, opts);
  }

  /**
   * Loads one durable timeline session for an authorized conversation.
   *
   * @param conversationId - Conversation identifier.
   * @param opts - Caller visibility plus optional task or prior-session cursor.
   * @returns The selected session, messages, and previous-session signal.
   */
  async getSessionHistory(
    conversationId: string,
    opts: { userId: string; taskId?: string; beforeSessionId?: string },
  ) {
    await this.verifyParticipant(opts.userId, conversationId);
    return this.db.getConversationSessionHistory(conversationId, opts);
  }

  /**
   * Marks a conversation read for a specific participant.
   * @param userId - The participant marking the conversation read (must be a participant)
   * @param conversationId - Conversation ID
   * @throws Error if userId is not a participant
   */
  async markConversationRead(userId: string, conversationId: string) {
    await this.verifyParticipant(userId, conversationId);
    const participantId = await this.db.isParticipant(conversationId, userId)
      ? userId
      : `agent:${userId}`;
    return this.db.markConversationRead(participantId, conversationId);
  }

  /**
   * Hides a conversation for a specific user by setting hiddenAt.
   * @param userId - The user hiding the conversation (must be a participant)
   * @param conversationId - Conversation ID
   * @throws Error if userId is not a participant
   */
  async hideConversation(userId: string, conversationId: string) {
    await this.verifyParticipant(userId, conversationId);
    return this.db.hideConversation(userId, conversationId);
  }

  /**
   * Upserts arbitrary JSON metadata on a conversation.
   * @param conversationId - Conversation ID
   * @param metadata - Metadata to store
   * @param userId - User requesting the update (must be a participant)
   * @throws Error if userId is not a participant
   */
  async updateMetadata(conversationId: string, metadata: Record<string, unknown>, userId: string) {
    await this.verifyParticipant(userId, conversationId);
    return this.db.upsertMetadata(conversationId, metadata);
  }

  /**
   * Creates a dedicated Redis subscriber for a user's conversation events.
   * @param userId - User to subscribe for
   * @returns Object with `onMessage` handler registration and `cleanup` teardown function
   */
  subscribe(userId: string) {
    const sub = createRedisClient();
    const channel = `conversations:user:${userId}`;
    let cancelled = false;

    return {
      onMessage(handler: (data: string) => void) {
        sub.on('message', (_ch: string, data: string) => {
          if (!cancelled) handler(data);
        });
        sub.subscribe(channel).catch((err) => {
          logger.error('Redis subscribe failed', {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      },
      cleanup() {
        cancelled = true;
        sub.unsubscribe(channel).then(() => sub.disconnect()).catch(() => {});
      },
    };
  }
}
