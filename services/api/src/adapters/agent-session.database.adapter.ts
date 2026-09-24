import { and, asc, eq, isNull, sql } from 'drizzle-orm';

import { RuntimeConflictError } from '../lib/agent/runtime-errors';
import db from '../lib/drizzle/drizzle';
import { publishUserEvent } from '../lib/user-events';
import { agentSessions, agents, messages, type Message } from '../schemas/database.schema';

import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { SYSTEM_AGENT_ID } from './database.shared';

export interface AgentExecution { userId: string; intentId: string; token: string }

export type QuestionScope = 'intent' | 'match';

export interface MatchReference {
  opportunityId: string;
  counterparty: { id: string; name: string | null };
}

/** One human-facing entry on the agent DM, which can concern several negotiations. */
export interface PrincipalMessage {
  id: string;
  createdAt: string;
  questionId?: string;
  /** `expire` is the agent retiring its own question: it leaves the queue unanswered. */
  kind: 'question' | 'answer' | 'user' | 'message' | 'expire';
  matches: readonly MatchReference[];
  text: string;
  scope?: QuestionScope;
  options?: string[];
}

/** A question the agent put to its owner; wording, scope, and references stay stable until answered. */
export interface PrincipalQuestion {
  id: string;
  question: string;
  options?: string[];
  scope: QuestionScope;
  matches: readonly MatchReference[];
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const LEASE_SECONDS = 60;
const QUESTION_HEADLINE = 'Question from your agent';
const QUESTION_BODY_MAX_CHARS = 140;

function toPrincipalMessage(message: Message): PrincipalMessage {
  const metadata = message.metadata as { principalMessage?: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'> } | null;
  const stored = metadata?.principalMessage;
  return {
    ...stored, id: message.id, createdAt: message.createdAt.toISOString(),
    kind: stored?.kind ?? (message.role === 'user' ? 'user' : 'message'), matches: stored?.matches ?? [],
    text: (message.parts as { kind: string; text?: string }[])
      .filter((part) => part && part.kind === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n'),
  };
}

/** A competing runtime owns the lease until the database's recorded expiry. */
export class AgentSessionLeaseConflict extends Error {
  readonly retryAt: number;

  constructor(readonly leaseExpiresAt: Date, retryAfterMs: number) {
    super('This principal/intent already has an active personal-agent session.');
    this.retryAt = Date.now() + retryAfterMs;
  }
}

/**
 * Announce a question the owner has to answer before their agent can continue.
 *
 * The frame names the intent rather than the H2A conversation: the question
 * lives in that signal's agent conversation, and every surface reaches it by
 * intent id.
 *
 * @param userId - The principal who owes the answer.
 * @param intentId - Signal whose personal agent is suspended.
 * @param question - The question as the agent recorded it.
 */
export async function publishPendingQuestionEvent(
  userId: string,
  intentId: string,
  question: PrincipalQuestion,
): Promise<void> {
  const text = question.question.trim();
  await publishUserEvent(userId, {
    type: 'question.pending',
    id: question.id,
    title: QUESTION_HEADLINE,
    body: text.length > QUESTION_BODY_MAX_CHARS
      ? `${text.slice(0, QUESTION_BODY_MAX_CHARS - 1).trimEnd()}…`
      : text,
    data: {
      intentId,
      questionId: question.id,
      scope: question.scope,
      opportunityId: question.matches[0]?.opportunityId ?? null,
    },
  });
}

/** Fence A2A writes against an exclusively owned runtime session and persist the agent DM's H2A entries. */
export class AgentSessionDatabaseAdapter {
  /** @param id - Receipt returned by the agent after an atomic input checkpoint. @returns Its canonical conversation message. */
  static async readMessage(id: string): Promise<Message> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    if (!message) throw new Error('The personal-agent input was not persisted.');
    return message;
  }

  /** Extend the lease if this process still owns it. @param tx - The caller's transaction. @param execution - Its session fence. @throws When ownership expired or moved to another process. */
  static async assertOwner(tx: Transaction, execution: AgentExecution): Promise<void> {
    const [row] = await tx.update(agentSessions).set({
      leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'`, updatedAt: new Date(),
    }).where(and(
      eq(agentSessions.userId, execution.userId), eq(agentSessions.intentId, execution.intentId),
      eq(agentSessions.leaseToken, execution.token), sql`${agentSessions.leaseExpiresAt} > now()`,
    )).returning({ token: agentSessions.leaseToken });
    if (!row) await AgentSessionDatabaseAdapter.rejectLostLease(tx, execution);
  }

  private static async rejectLostLease(tx: Transaction, execution: AgentExecution): Promise<never> {
    const [lease] = await tx.select({
      expiresAt: agentSessions.leaseExpiresAt,
      retryAfterMs: sql<number>`greatest(0, extract(epoch from (${agentSessions.leaseExpiresAt} - clock_timestamp())) * 1000)::integer`,
    }).from(agentSessions).where(and(eq(agentSessions.userId, execution.userId), eq(agentSessions.intentId, execution.intentId)));
    throw new AgentSessionLeaseConflict(lease?.expiresAt ?? new Date(), lease?.retryAfterMs ?? 0);
  }

  /**
   * @param userId - Owning principal.
   * @param intentId - Signal whose agent-DM entries to read.
   * @returns The agent DM and its H2A transcript for that signal.
   */
  static async readTranscript(userId: string, intentId: string) {
    const conversation = await new ConversationDatabaseAdapter().getOrCreateAgentDm(userId);
    const history = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return { conversationId: conversation.id, messages: history.map(toPrincipalMessage) };
  }

  /**
   * Persist agent-authored H2A on the owner's agent DM.
   *
   * An external speaker names itself and is only allowed to write while it is
   * still the selected negotiator. The hosted seat names no agent id and is
   * refused the same way once an external negotiator holds the seat.
   *
   * @param input - Owner, signal, the selected agent when one is speaking, and question/message entries.
   * @returns The inserted conversation messages.
   * @throws RuntimeConflictError when a named agent is no longer the selected negotiator, or an unnamed caller writes while one is selected.
   */
  static async publishAgentEntries(input: {
    userId: string; intentId: string; agentId?: string; entries: readonly PrincipalMessage[];
  }): Promise<Message[]> {
    const conversations = new ConversationDatabaseAdapter();
    const conversation = await conversations.getOrCreateAgentDm(input.userId);
    const persisted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.userId}`}, 0))`);
      if (input.agentId) {
        const [selected] = await tx.select({ id: agents.id }).from(agents).where(and(
          eq(agents.id, input.agentId), eq(agents.ownerId, input.userId),
          eq(agents.type, 'external'), eq(agents.status, 'active'),
          eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
        ));
        if (!selected) throw new RuntimeConflictError();
      } else {
        const [selected] = await tx.select({ id: agents.id }).from(agents).where(and(
          eq(agents.ownerId, input.userId), eq(agents.type, 'external'),
          eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
        ));
        if (selected) throw new RuntimeConflictError();
      }
      const inserted: Message[] = [];
      for (const entry of input.entries) {
        if (entry.kind !== 'question' && entry.kind !== 'message' && entry.kind !== 'expire') continue;
        const { id, createdAt, text, ...principalMessage } = entry;
        inserted.push(await conversations.insertMessageWithConversationSession(tx, {
          id, createdAt: new Date(createdAt), conversationId: conversation.id,
          senderId: SYSTEM_AGENT_ID, role: 'agent',
          parts: [{ kind: 'text', text }], metadata: { intentId: input.intentId, principalMessage }, extensions: null,
        }));
      }
      return inserted;
    });
    await Promise.all(persisted.map((message) => conversations.publishMessage(message)));
    return persisted;
  }

  /**
   * Persist an owner answer or direct message on the agent DM.
   * @param input - Owner, signal, canonical DM, text, and the displayed question when answering.
   * @returns The inserted conversation message.
   */
  static async writeOwnerInput(input: {
    userId: string; intentId: string; conversationId: string; text: string;
    questionId: string | null; pending: PrincipalQuestion | null;
  }): Promise<Message> {
    const human: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'> = input.questionId
      ? { kind: 'answer', questionId: input.questionId, matches: input.pending?.matches ?? [], scope: input.pending?.scope }
      : { kind: 'user', matches: [] };
    return new ConversationDatabaseAdapter().createMessage({
      conversationId: input.conversationId, senderId: input.userId, role: 'user',
      parts: [{ kind: 'text', text: input.text }],
      metadata: { intentId: input.intentId, principalMessage: human },
    });
  }

  /**
   * Persist several owner answers on the agent DM as one write.
   *
   * The single transaction is the point: the wake these answers trigger reads a
   * transcript that already holds all of them, instead of deciding on the first
   * and discarding the rest.
   *
   * @param input - Owner, signal, canonical DM, and each answer with the question it names.
   * @returns The inserted messages, in the order given.
   */
  static async writeOwnerAnswers(input: {
    userId: string; intentId: string; conversationId: string;
    answers: readonly { text: string; question: PrincipalQuestion | null }[];
  }): Promise<Message[]> {
    const conversations = new ConversationDatabaseAdapter();
    const persisted = await db.transaction(async (tx) => {
      const inserted: Message[] = [];
      for (const answer of input.answers) {
        const human: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'> = answer.question
          ? { kind: 'answer', questionId: answer.question.id, matches: answer.question.matches, scope: answer.question.scope }
          : { kind: 'user', matches: [] };
        inserted.push(await conversations.insertMessageWithConversationSession(tx, {
          id: crypto.randomUUID(), conversationId: input.conversationId,
          senderId: input.userId, role: 'user',
          parts: [{ kind: 'text', text: answer.text }],
          metadata: { intentId: input.intentId, principalMessage: human }, extensions: null,
        }));
      }
      return inserted;
    });
    await Promise.all(persisted.map((message) => conversations.publishMessage(message)));
    return persisted;
  }
}
