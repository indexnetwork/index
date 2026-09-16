import type { PrincipalMessage, PrincipalQuestion } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter, publishPendingQuestionEvent } from '../adapters/agent-session.database.adapter';
import { createRedisClient } from '../adapters/cache.adapter';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';
import { SYSTEM_AGENT_ID } from '../adapters/database.shared';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { log } from '../lib/log';
import { publishUserEvent, userEventChannel } from '../lib/user-events';

const logger = log.service.from('ConversationService');

/** An owner-facing H2A input failure; no agent work is acknowledged by this error. */
export class AgentConversationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

export interface AgentConversationState {
  status: 'external' | 'hosted';
  pending: PrincipalQuestion | null;
  queuedQuestions: number;
}

/**
 * The questions still waiting on the owner, oldest first.
 *
 * A question leaves the queue only when an answer names it: a message written
 * to the agent answers nothing on its own, and a newer question does not
 * retire the ones asked before it.
 *
 * @param messages - The owner's agent DM for one signal, oldest first.
 * @returns Every unanswered question, oldest first; the last is the displayed one.
 */
function unanswered(messages: readonly PrincipalMessage[]): PrincipalQuestion[] {
  const queue: PrincipalQuestion[] = [];
  for (const message of messages) {
    if (message.kind === 'question') {
      queue.push({
        id: message.questionId ?? message.id, question: message.text, options: message.options,
        scope: message.scope ?? 'intent', matches: message.matches,
      });
    } else if (message.kind === 'answer' && message.questionId) {
      const answered = queue.findIndex((question) => question.id === message.questionId);
      if (answered >= 0) queue.splice(answered, 1);
    }
  }
  return queue;
}

/** A live subscription on one user's event channel. */
export interface UserEventSubscription {
  onMessage(handler: (data: string) => void): void;
  cleanup(): Promise<void>;
}

/** Well-known conversation id for the caller's own agent DM. */
export const AGENT_DM_ID = 'agent';

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
  private readonly intents = new IntentDatabaseAdapter();
  private readonly registry = new AgentDatabaseAdapter();

  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {}

  /**
   * Resolve a conversation identifier to a full UUID.
   *
   * `agent` is the caller's own agent DM, created on first use: the owner has
   * exactly one, so it needs no id to address.
   *
   * @param idOrPrefix - `agent`, a full UUID, or a short hex prefix
   * @param userId - The user ID (for participant scoping)
   * @returns Resolved ID, or error object with status
   */
  async resolveId(idOrPrefix: string, userId: string): Promise<{ id: string } | { error: string; status: number }> {
    if (idOrPrefix === AGENT_DM_ID) {
      const conversation = await this.db.getOrCreateAgentDm(userId);
      return { id: conversation.id };
    }

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
  private async verifyParticipant(userId: string, conversationId: string): Promise<void> {
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
   * Lists all visible conversations for a user, ordered by most recent message.
   * @param userId - The user whose conversations to list
   * @returns Summaries with participant lists
   */
  async getConversations(userId: string) {
    return this.db.getConversationsForUser(userId);
  }

  /**
   * Finds an existing DM between two users, or creates one if none exists.
   * @param userA - First user ID
   * @param userB - Second user ID
   * @returns The existing or newly created conversation
   */
  async getOrCreateDm(userA: string, userB: string) {
    return this.db.getOrCreateDM(userA, userB);
  }

  /**
   * True when the conversation is an owner's agent DM.
   *
   * The agent is a participant of that thread and of nothing else, so its
   * membership is what identifies the thread.
   *
   * @param conversationId - Conversation ID
   * @returns Whether the agent speaks in this conversation
   */
  async isAgentDm(conversationId: string): Promise<boolean> {
    return this.db.isParticipant(conversationId, SYSTEM_AGENT_ID);
  }

  /**
   * Sends a message in a conversation.
   * @param conversationId - Conversation ID
   * @param senderId - ID of the sender (must be a participant)
   * @param role - Role of the sender ('user' or 'agent')
   * @param parts - Message content parts
   * @param opts - Optional metadata
   * @returns The created message
   * @throws Error if senderId is not a participant
   */
  async sendMessage(
    conversationId: string,
    senderId: string,
    role: 'user' | 'agent',
    parts: unknown[],
    opts?: { metadata?: Record<string, unknown> },
  ) {
    await this.verifyParticipant(senderId, conversationId);

    const msg = await this.db.createMessage({
      conversationId,
      senderId,
      role,
      parts,
      metadata: opts?.metadata,
    });

    return msg;
  }

  /**
   * The agent speaks in its owner's agent DM.
   *
   * Questions only — outcomes live in Radar. One DM per owner carries every
   * signal, so the `intentId` tag is what keeps the message on its own: it is
   * read back only under that signal. The write itself tells the owner:
   * `createMessage` publishes the message on their conversation channel, which
   * is where the question gets answered.
   *
   * @param conversationId - The owner's agent DM.
   * @param parts - Message content parts.
   * @param opts - Metadata, carrying the `intentId` tag.
   * @returns The created message.
   */
  async sendAgentMessage(
    conversationId: string,
    parts: unknown[],
    opts?: { metadata?: Record<string, unknown> },
  ) {
    return this.sendMessage(conversationId, SYSTEM_AGENT_ID, 'agent', parts, opts);
  }

  /**
   * Retrieves messages for a conversation.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), intent filter, or userId for authorization
   * @returns Ordered list of messages
   * @throws Error if opts.userId is provided and is not a participant
   */
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string; userId?: string; intentId?: string }) {
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
    opts: { userId: string; beforeSessionId?: string },
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
   * @param userId - Authenticated owner.
   * @param intentId - Intent conversation being read.
   * @returns Pending question, or the hosted status when Index holds the seat.
   * @throws AgentConversationError when the caller does not own the intent.
   */
  async agentState(userId: string, intentId: string): Promise<AgentConversationState> {
    if (!await this.intents.isOwnedByUser(intentId, userId)) throw new AgentConversationError('Intent not found.', 404);
    // The hosted negotiator only takes A2A turns, so it has no owner transcript.
    if (!await this.registry.getSelectedNegotiator(userId)) {
      return { status: 'hosted', pending: null, queuedQuestions: 0 };
    }
    const { messages } = await AgentSessionDatabaseAdapter.readTranscript(userId, intentId);
    const queue = unanswered(messages);
    return { status: 'external', pending: queue.at(-1) ?? null, queuedQuestions: Math.max(queue.length - 1, 0) };
  }

  /**
   * Persist owner input for the selected external negotiator and notify that runtime.
   *
   * Whatever the owner sends is kept: a message written while a question is on
   * screen, or an answer to a question that has since been overtaken, still
   * reaches the agent, which decides what it applies to. Only input naming the
   * question currently displayed is recorded as that question's answer.
   *
   * @param input - Authenticated owner, intent, canonical DM, and the question the owner was answering (or null for a direct message).
   * @returns The persisted message.
   * @throws AgentConversationError when the intent is not owned or Index holds the seat.
   */
  async sendOwnerInput(input: { userId: string; intentId: string; conversationId: string; text: string; questionId: string | null }) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new AgentConversationError('Intent not found.', 404);
    if (!await this.registry.getSelectedNegotiator(input.userId)) throw new AgentConversationError('The Index negotiator does not chat. Select a negotiator to message your agent.', 409);
    const { conversationId, messages } = await AgentSessionDatabaseAdapter.readTranscript(input.userId, input.intentId);
    if (conversationId !== input.conversationId) throw new AgentConversationError('Agent conversation not found.', 404);
    const displayed = unanswered(messages).at(-1) ?? null;
    const answered = input.questionId && displayed?.id === input.questionId ? displayed : null;
    const message = await AgentSessionDatabaseAdapter.writeOwnerInput({ ...input, questionId: answered?.id ?? null, pending: answered });
    await publishUserEvent(input.userId, {
      type: 'principal.input', id: message.id, title: '', body: '',
      data: { intentId: input.intentId, questionId: answered?.id ?? null, text: input.text },
    });
    return message;
  }

  /**
   * Persist an external speaker's question or message on the owner's agent DM.
   * @param input - Owner, selected executor, signal, and agent-authored H2A entries.
   * @throws AgentConversationError when the intent is not owned.
   */
  async publishH2A(input: { userId: string; intentId: string; executorId: string; entries: PrincipalMessage[] }) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new AgentConversationError('Intent not found.', 404);
    const { messages } = await AgentSessionDatabaseAdapter.readTranscript(input.userId, input.intentId);
    const known = new Set(messages.map((message) => message.id));
    const entries = input.entries.filter((entry) => (entry.kind === 'question' || entry.kind === 'message') && !known.has(entry.id));
    if (!entries.length) return;
    const asked = unanswered(messages).at(-1) ?? null;
    await AgentSessionDatabaseAdapter.publishAsExecutor({ ...input, entries });
    const displayed = [...entries].reverse().find((entry) => entry.kind === 'question');
    if (displayed && displayed.questionId && displayed.questionId !== asked?.id) {
      await publishPendingQuestionEvent(input.userId, input.intentId, {
        id: displayed.questionId, question: displayed.text, options: displayed.options,
        scope: displayed.scope ?? 'intent', matches: displayed.matches,
      });
    }
  }

  /**
   * Opens a dedicated Redis subscriber on a user's event channel — messages and
   * notification frames alike, since one channel carries both.
   *
   * Resolves only after Redis acknowledges the subscription, and buffers frames
   * that arrive before the consumer registers its handler, so a publish racing
   * the connection is delivered rather than dropped.
   *
   * @param userId - User to subscribe for
   * @returns Object with `onMessage` handler registration and `cleanup` teardown function
   * @throws Error if Redis refuses the subscription
   */
  async openEventStream(userId: string): Promise<UserEventSubscription> {
    const sub = createRedisClient();
    const channel = userEventChannel(userId);
    let handler: ((data: string) => void) | null = null;
    let buffered: string[] = [];
    let cleaned = false;

    sub.on('message', (receivedChannel: string, data: string) => {
      if (cleaned || receivedChannel !== channel) return;
      if (handler) handler(data);
      else buffered.push(data);
    });

    try {
      await sub.subscribe(channel);
    } catch (error: unknown) {
      cleaned = true;
      buffered = [];
      try { await sub.disconnect(); } catch { /* best-effort cleanup */ }
      logger.error('Redis subscribe failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    return {
      onMessage(nextHandler) {
        if (cleaned) return;
        handler = nextHandler;
        const pending = buffered;
        buffered = [];
        for (const data of pending) handler(data);
      },
      async cleanup() {
        if (cleaned) return;
        cleaned = true;
        handler = null;
        buffered = [];
        try { await sub.unsubscribe(channel); } catch { /* disconnect still runs */ }
        try { await sub.disconnect(); } catch { /* best-effort cleanup */ }
      },
    };
  }
}
