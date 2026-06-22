import { log } from '../lib/log';

import { createRedisClient, getRedisClient } from '../adapters/cache.adapter';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from('ConversationService');

/**
 * Manages conversation lifecycle, messaging, and DM deduplication.
 *
 * Part of the unified conversation architecture:
 * - ConversationDatabaseAdapter: single data layer for all conversation types (H2A, H2H, future A2A)
 * - ConversationService: general conversation operations (create, message, DM, metadata, real-time)
 * - ChatSessionService: layered on top for H2A-specific behavior (graph invocation, SSE streaming,
 *   title generation, sharing, ghost invites)
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
    return this.db.getConversationsForUser(`agent:${userId}`);
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

    const participants = await this.db.getParticipants(conversationId);

    // Publish to all participants' SSE channels (best-effort)
    try {
      const event = JSON.stringify({
        type: 'message',
        conversationId,
        message: msg,
      });
      const pubClient = getRedisClient();
      for (const p of participants) {
        if (p.participantId === senderId) continue;
        await pubClient.publish(`conversations:user:${p.participantId}`, event);
      }
    } catch (err) {
      logger.error('[sendMessage] Failed to publish SSE event', {
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Ghost invite email: on first user message to a ghost, send an invite
    if (role === 'user') {
      try {
        await this.sendGhostInviteIfNeeded(conversationId, senderId, parts, participants);
      } catch (err) {
        logger.error('[sendMessage] Ghost invite email failed', {
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

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
   * Sends a ghost invite email if any non-sender participant is a ghost user
   * and no invite has been sent yet for this conversation.
   */
  private async sendGhostInviteIfNeeded(
    conversationId: string,
    senderId: string,
    parts: unknown[],
    participants: { participantId: string; participantType: string }[],
  ): Promise<void> {
    const otherUsers = participants.filter(
      (p) => p.participantId !== senderId && p.participantType === 'user',
    );
    if (otherUsers.length === 0) return;

    const metadata = await this.db.getMetadata(conversationId);
    if (metadata?.ghostInviteSent) return;

    for (const p of otherUsers) {
      const recipient = await this.db.getUser(p.participantId);
      if (!recipient || !recipient.isGhost || recipient.deletedAt || !recipient.email) continue;

      const sender = await this.db.getUser(senderId);
      if (!sender) continue;

      const messageText = parts
        .map((part) => (typeof part === 'object' && part !== null && 'text' in part ? (part as { text: string }).text : ''))
        .filter(Boolean)
        .join('\n') || '(attachment)';

      const { ghostInviteTemplate } = await import('../lib/email/templates');
      const { emailQueue } = await import('../queues/email.queue');

      const appUrl = process.env.APP_URL || 'https://index.network';
      const replyUrl = `${appUrl}/onboarding?ref=invite&alpha=true`;
      const notifSettings = await this.db.getOrCreateNotificationSettings(recipient.id);
      const unsubscribeUrl = `${appUrl}/api/unsubscribe/${notifSettings.unsubscribeToken}`;

      const email = ghostInviteTemplate(
        recipient.name ?? 'there',
        sender.name ?? 'Someone',
        messageText,
        replyUrl,
        unsubscribeUrl,
      );

      await emailQueue.addJob({
        to: recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      await this.db.upsertMetadata(conversationId, {
        ...(metadata ?? {}),
        ghostInviteSent: true,
      });

      logger.info('[sendMessage] Ghost invite email queued', {
        conversationId,
        recipientId: recipient.id,
      });
      break;
    }
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
          logger.error('[subscribe] Redis subscribe failed', {
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
