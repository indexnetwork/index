import { setTimeout as sleep } from 'node:timers/promises';

import type { PrincipalMessage, PrincipalQuestion } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter, publishPendingQuestionEvent } from '../adapters/agent-session.database.adapter';
import { createRedisClient } from '../adapters/cache.adapter';
import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';
import { SYSTEM_AGENT_ID } from '../adapters/database.shared';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { log } from '../lib/log';
import { ackUserEvent, ensureUserEventGroup, publishUserEvent, readUserEventGroup, readUserEvents, type UserEventRecord } from '../lib/user-events';

const logger = log.service.from('ConversationService');

/** An owner-facing H2A input failure; no agent work is acknowledged by this error. */
export class AgentConversationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) { super(message); }
}

export interface AgentConversationState {
  status: 'external' | 'hosted';
  /** Every question still waiting on the owner, oldest first. */
  questions: PrincipalQuestion[];
}

/**
 * The questions still waiting on the owner, oldest first.
 *
 * A question leaves the queue when an answer names it, or when the agent
 * retires it with an `expire` entry: a message written to the agent answers
 * nothing on its own, and a newer question does not retire the ones asked
 * before it.
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
    } else if ((message.kind === 'answer' || message.kind === 'expire') && message.questionId) {
      const retired = queue.findIndex((question) => question.id === message.questionId);
      if (retired >= 0) queue.splice(retired, 1);
    }
  }
  return queue;
}

/** A live read of one user's event stream. */
export interface UserEventSubscription {
  onMessage(handler: (event: UserEventRecord) => void): void;
  cleanup(): Promise<void>;
}

/** How long a read waits on Redis before asking again. */
const STREAM_BLOCK_MS = 15000;

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
   * @returns Every unanswered question, or the hosted status when Index holds the seat.
   * @throws AgentConversationError when the caller does not own the intent.
   */
  async agentState(userId: string, intentId: string): Promise<AgentConversationState> {
    if (!await this.intents.isOwnedByUser(intentId, userId)) throw new AgentConversationError('Intent not found.', 404);
    // The hosted negotiator only takes A2A turns, so it has no owner transcript.
    if (!await this.registry.getSelectedNegotiator(userId)) {
      return { status: 'hosted', questions: [] };
    }
    const { messages } = await AgentSessionDatabaseAdapter.readTranscript(userId, intentId);
    return { status: 'external', questions: unanswered(messages) };
  }

  /**
   * Persist owner input on this signal's inbox and notify the runtime.
   *
   * Whatever the owner sends is kept: a message written while questions are on
   * screen, or an answer to a question that has since been overtaken, still
   * reaches the agent, which decides what it applies to. Input naming any
   * question still waiting is recorded as that question's answer, so the owner
   * can work through them in whatever order they like. The inbox is not the
   * responder seat — a message is accepted whether or not a negotiator is selected.
   *
   * @param input - Authenticated owner, intent, canonical DM, and the question the owner was answering (or null for a direct message).
   * @returns The persisted message.
   * @throws AgentConversationError when the intent is not owned.
   */
  async sendOwnerInput(input: { userId: string; intentId: string; conversationId: string; text: string; questionId: string | null }) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new AgentConversationError('Intent not found.', 404);
    const { conversationId, messages } = await AgentSessionDatabaseAdapter.readTranscript(input.userId, input.intentId);
    if (conversationId !== input.conversationId) throw new AgentConversationError('Agent conversation not found.', 404);
    const answered = input.questionId
      ? unanswered(messages).find((question) => question.id === input.questionId) ?? null
      : null;
    const message = await AgentSessionDatabaseAdapter.writeOwnerInput({ ...input, questionId: answered?.id ?? null, pending: answered });
    await publishUserEvent(input.userId, {
      type: 'principal.input', id: message.id, title: '', body: '',
      data: { intentId: input.intentId, questionId: answered?.id ?? null, text: input.text },
    });
    return message;
  }

  /**
   * Persist several owner answers at once.
   *
   * Every answer is matched against one reading of the queue and written in a
   * single transaction, so the wake they trigger sees all of them rather than
   * deciding on the first and clearing the rest. An answer naming a question
   * that is no longer waiting is still kept, as a plain message. Like
   * {@link sendOwnerInput}, the write is accepted whether or not a negotiator
   * is selected: the inbox is a chat, not the responder seat.
   *
   * @param input - Authenticated owner, intent, canonical DM, and the answers to write.
   * @returns The persisted messages, in the order given.
   * @throws AgentConversationError when the intent is not owned.
   */
  async answerQuestions(input: { userId: string; intentId: string; conversationId: string; answers: { questionId: string; text: string }[] }) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new AgentConversationError('Intent not found.', 404);
    const { conversationId, messages } = await AgentSessionDatabaseAdapter.readTranscript(input.userId, input.intentId);
    if (conversationId !== input.conversationId) throw new AgentConversationError('Agent conversation not found.', 404);
    const queue = unanswered(messages);
    const prepared = input.answers.map((answer) => ({
      text: answer.text,
      question: queue.find((question) => question.id === answer.questionId) ?? null,
    }));
    const persisted = await AgentSessionDatabaseAdapter.writeOwnerAnswers({
      userId: input.userId, intentId: input.intentId, conversationId, answers: prepared,
    });
    // Published only once the batch is durable: the first wake then reads a
    // transcript that already holds every answer.
    for (const [index, message] of persisted.entries()) {
      const answer = prepared[index]!;
      await publishUserEvent(input.userId, {
        type: 'principal.input', id: message.id, title: '', body: '',
        data: { intentId: input.intentId, questionId: answer.question?.id ?? null, text: answer.text },
      });
    }
    return persisted;
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
    const entries = input.entries.filter(
      (entry) => (entry.kind === 'question' || entry.kind === 'message' || entry.kind === 'expire') && !known.has(entry.id),
    );
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
   * Follows a user's event stream on a dedicated Redis client — messages and
   * notification frames alike, since one stream carries both.
   *
   * A consumer that names itself keeps its offset in Redis: entries it never
   * acknowledged are redelivered after a reconnect, and two connections under
   * the same name compete for entries instead of each taking every one. An
   * anonymous consumer resumes from `after`, or reads only live frames.
   *
   * @param userId - Owner whose stream to follow.
   * @param options - `after` is the last entry the client saw; `consumer` names one of the owner's agents.
   * @returns Object with `onMessage` handler registration and `cleanup` teardown function.
   * @throws AgentConversationError when `consumer` does not name an agent this user owns.
   * @throws Error when Redis is unreachable.
   */
  async openEventStream(
    userId: string,
    options: { after?: string; consumer?: string } = {},
  ): Promise<UserEventSubscription> {
    const group = options.consumer;
    if (group) {
      const agent = await this.registry.getAgent(group);
      if (!agent || agent.ownerId !== userId) {
        throw new AgentConversationError('consumer must name one of your agents.', 404);
      }
    }

    const client = createRedisClient();
    let cursor = options.after ?? '$';
    let stopped = false;

    try {
      await client.ping();
      if (group) await ensureUserEventGroup(userId, group);
    } catch (error: unknown) {
      stopped = true;
      client.disconnect();
      logger.error('Redis event stream refused', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    // The agent is the consumer, so its first read collects what an earlier
    // connection took but never acknowledged, and a second connection under the
    // same agent competes for entries instead of taking every one again.
    let from: '>' | '0' = '0';

    const follow = async (handler: (event: UserEventRecord) => void): Promise<void> => {
      while (!stopped) {
        try {
          const records = group
            ? await readUserEventGroup(client, { group, consumer: group, userIds: [userId], from, blockMs: STREAM_BLOCK_MS })
            : await readUserEvents(client, new Map([[userId, cursor]]), STREAM_BLOCK_MS);
          from = '>';

          for (const record of records) {
            if (stopped) return;
            handler(record);
            if (group) await ackUserEvent(group, record);
            else cursor = record.id;
          }
        } catch (error: unknown) {
          if (stopped) return;
          logger.error('Redis event stream read failed', {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          // A restarted Redis has neither the group nor this consumer's pending
          // entries, so the group is recreated and the next read starts from
          // whatever the consumer never acknowledged.
          if (group) {
            from = '0';
            await ensureUserEventGroup(userId, group).catch(() => {});
          }
          await sleep(STREAM_BLOCK_MS);
        }
      }
    };

    return {
      onMessage(handler) {
        if (stopped) return;
        // Read failures are handled by the loop; this releases the connection
        // if the loop itself ever gives up.
        void follow(handler).catch(() => { stopped = true; client.disconnect(); });
      },
      async cleanup() {
        if (stopped) return;
        stopped = true;
        client.disconnect();
      },
    };
  }
}
