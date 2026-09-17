import type { PrincipalMessage, PrincipalQuestion, PrincipalState, PrincipalStore } from '@indexnetwork/agent';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import { RuntimeConflictError } from '../lib/agent/runtime-errors';
import db from '../lib/drizzle/drizzle';
import { publishUserEvent } from '../lib/user-events';
import { agentSessions, agents, intents, messages, type Message } from '../schemas/database.schema';

import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { SYSTEM_AGENT_ID } from './database.shared';

export interface AgentExecution { userId: string; intentId: string; token: string }
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

/** Startup cannot continue until the intent or executor configuration changes. */
export class AgentSessionIneligibleError extends Error {}

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

/** Fence checkpoints and A2A writes against the same exclusively owned runtime session. */
export class AgentSessionDatabaseAdapter implements PrincipalStore {
  readonly execution: AgentExecution;
  private revision = 0;
  private conversationId = '';
  private askedQuestionId: string | null = null;
  private readonly conversations = new ConversationDatabaseAdapter();

  constructor(userId: string, intentId: string) {
    this.execution = { userId, intentId, token: crypto.randomUUID() };
  }

  /** @param userId - Owning principal. @param intentId - Owned intent. @returns Its persisted checkpoint and lease. */
  static async readSession(userId: string, intentId: string) {
    const [row] = await db.select().from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId)));
    return row ? { ...row, state: row.state as PrincipalState | null } : null;
  }

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

  /** Acquire the session and read its canonical intent conversation. @returns The checkpoint and H2A history. @throws If another process owns it or the intent is not the principal's. */
  async load(): Promise<{ state: PrincipalState | null; messages: PrincipalMessage[] }> {
    const { userId, intentId, token } = this.execution;
    const [intent] = await db.select({ id: intents.id, status: intents.status, archivedAt: intents.archivedAt })
      .from(intents).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
    if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') {
      throw new AgentSessionIneligibleError('The selected intent must be active and belong to this principal.');
    }
    const conversation = await this.conversations.getOrCreateAgentDm(userId);
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${userId}`}, 0))`);
      const [external] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.ownerId, userId), eq(agents.type, 'external'), eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
      )).limit(1);
      if (external) throw new AgentSessionIneligibleError('This principal has selected an external negotiation executor.');
      await tx.insert(agentSessions).values({ userId, intentId, conversationId: conversation.id }).onConflictDoNothing();
      const [acquired] = await tx.update(agentSessions).set({
        leaseToken: token, leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'`, updatedAt: new Date(),
      }).where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId),
        or(isNull(agentSessions.leaseToken), sql`${agentSessions.leaseExpiresAt} <= now()`))).returning();
      if (!acquired) await AgentSessionDatabaseAdapter.rejectLostLease(tx, this.execution);
      return acquired;
    });
    this.revision = row.revision;
    this.conversationId = row.conversationId;
    this.askedQuestionId = (row.state as PrincipalState | null)?.inbox.question?.id ?? null;
    const history = await db.select().from(messages).where(and(eq(messages.conversationId, row.conversationId), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return { state: row.state as PrincipalState | null, messages: history.map(toPrincipalMessage) };
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
   * Persist agent-authored H2A while this executor is still selected.
   * @param input - Owner, signal, selected agent, and question/message entries.
   * @returns The inserted conversation messages.
   * @throws RuntimeConflictError when this agent is no longer the selected negotiator.
   */
  static async publishAsExecutor(input: {
    userId: string; intentId: string; executorId: string; entries: readonly PrincipalMessage[];
  }): Promise<Message[]> {
    const conversations = new ConversationDatabaseAdapter();
    const conversation = await conversations.getOrCreateAgentDm(input.userId);
    const persisted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.userId}`}, 0))`);
      const [selected] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.id, input.executorId), eq(agents.ownerId, input.userId),
        eq(agents.type, 'external'), eq(agents.status, 'active'),
        eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
      ));
      if (!selected) throw new RuntimeConflictError();
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

  /** Extend this process's lease for a long action. @throws When ownership expired or moved. */
  async renew(): Promise<void> {
    await db.transaction(async (tx) => { await AgentSessionDatabaseAdapter.assertOwner(tx, this.execution); });
  }

  /** @param state - Opaque agent checkpoint. @param entries - H2A messages published by that checkpoint. @throws On a stale revision, lost lease, or failed transaction. */
  async save(state: PrincipalState, entries: readonly PrincipalMessage[]): Promise<void> {
    const persisted = await db.transaction(async (tx) => {
      await AgentSessionDatabaseAdapter.assertOwner(tx, this.execution);
      const updated = await tx.update(agentSessions).set({ state, revision: this.revision + 1, updatedAt: new Date() })
        .where(and(eq(agentSessions.userId, this.execution.userId), eq(agentSessions.intentId, this.execution.intentId), eq(agentSessions.revision, this.revision))).returning({ revision: agentSessions.revision });
      if (!updated.length) throw new Error('Personal-agent checkpoint revision changed.');
      const inserted: Message[] = [];
      for (const entry of entries) {
        const { id, createdAt, text, ...principalMessage } = entry;
        const human = entry.kind === 'user' || entry.kind === 'answer';
        inserted.push(await this.conversations.insertMessageWithConversationSession(tx, {
          id, createdAt: new Date(createdAt), conversationId: this.conversationId,
          senderId: human ? this.execution.userId : SYSTEM_AGENT_ID, role: human ? 'user' : 'agent',
          parts: [{ kind: 'text', text }], metadata: { intentId: this.execution.intentId, principalMessage }, extensions: null,
        }));
      }
      return inserted;
    });
    this.revision++;
    await Promise.all(persisted.map((message) => this.conversations.publishMessage(message)));
    // A checkpoint saves the same pending question until it is answered, so the
    // owner is told once per question rather than once per turn.
    const question = state.inbox.question;
    if (question && question.id !== this.askedQuestionId) {
      await publishPendingQuestionEvent(this.execution.userId, this.execution.intentId, question);
    }
    this.askedQuestionId = question?.id ?? null;
  }

  /** Release this process's lease without erasing the saved conversation or pending question. */
  async close(): Promise<void> {
    await db.update(agentSessions).set({ leaseToken: null, leaseExpiresAt: null })
      .where(and(eq(agentSessions.userId, this.execution.userId), eq(agentSessions.intentId, this.execution.intentId), eq(agentSessions.leaseToken, this.execution.token)));
  }
}
