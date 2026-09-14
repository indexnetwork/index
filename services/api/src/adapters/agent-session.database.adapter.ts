import { createHash } from 'node:crypto';

import { pendingPrincipalQuestion, validPrincipalEffects, acceptedPrincipalMessage, type PrincipalDelegation, type PrincipalMessage, type PrincipalQuestion, type PrincipalRecords, type PrincipalRecordsView, type PrincipalEffects } from '@indexnetwork/agent';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { publishUserEvent } from '../lib/user-events';
import { agentSessions, agents, conversations, intents, intentNetworks, networkMembers, networks, negotiations, negotiationTurns, users, messages, type Message } from '../schemas/database.schema';

import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { SYSTEM_AGENT_ID } from './database.shared';

export interface AgentExecution { userId: string; intentId: string; token: string }

/** Reject an effect based on records superseded during model work. */
class PrincipalContextChanged extends Error {}
interface PrincipalMetadata {
  principalMessage?: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'>;
  principalDelegation?: Omit<PrincipalDelegation, 'id' | 'createdAt'>;
  retiredQuestionId?: string;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const LEASE_SECONDS = 60;
const QUESTION_HEADLINE = 'Question from your agent';
const QUESTION_BODY_MAX_CHARS = 140;

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
    },
  });
}

/** Read domain records and fence explicit effects with the existing host execution lease. */
export class AgentSessionDatabaseAdapter implements PrincipalRecords {
  readonly execution: AgentExecution;
  private conversationId = '';
  private heartbeat?: ReturnType<typeof setInterval>;
  private renewal: Promise<void> = Promise.resolve();
  private failure?: Error;
  private readonly conversations = new ConversationDatabaseAdapter();

  constructor(userId: string, intentId: string) {
    this.execution = { userId, intentId, token: crypto.randomUUID() };
  }

  /** @param userId - Owner. @param intentId - Owned intent. @returns Canonical conversation and reconstructed question status without a lease or write. */
  static async readConversation(userId: string, intentId: string) {
    return db.transaction(async (tx) => {
      const [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmPair, `agent-dm:${userId}`));
      const [owned] = await tx.select({ id: intents.id }).from(intents).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
      if (!conversation || !owned) return null;
      const records = await this.readView(tx, userId, intentId, conversation.id);
      return { conversationId: conversation.id, pending: pendingPrincipalQuestion(records) };
    }, { isolationLevel: 'repeatable read' });
  }

  /** @param id - Receipt returned after an atomic input write. @returns Its canonical conversation message. */
  static async readMessage(id: string): Promise<Message> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    if (!message) throw new Error('The personal-agent input was not persisted.');
    return message;
  }

  /** @param tx - The caller's transaction. @param execution - Its session fence. @throws When ownership expired or moved to another process. */
  static async assertOwner(tx: Transaction, execution: AgentExecution): Promise<void> {
    const [row] = await tx.select({ token: agentSessions.leaseToken }).from(agentSessions).where(and(
      eq(agentSessions.userId, execution.userId), eq(agentSessions.intentId, execution.intentId),
      eq(agentSessions.leaseToken, execution.token), sql`${agentSessions.leaseExpiresAt} > now()`,
    )).for('update');
    if (!row) throw new Error('This personal-agent session is no longer owned by this process.');
  }

  /** Acquire host execution ownership without restoring model work. @throws When the intent is ineligible or another host owns it. */
  async start(): Promise<void> {
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
      if (!acquired) {
        const [lease] = await tx.select({
          expiresAt: agentSessions.leaseExpiresAt,
          retryAfterMs: sql<number>`greatest(0, extract(epoch from (${agentSessions.leaseExpiresAt} - clock_timestamp())) * 1000)::integer`,
        }).from(agentSessions).where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId)));
        throw new AgentSessionLeaseConflict(lease!.expiresAt!, lease!.retryAfterMs);
      }
      return acquired;
    });
    this.conversationId = row.conversationId;
    this.heartbeat = setInterval(() => {
      this.renewal = this.renewal.then(async () => {
        const renewed = await db.update(agentSessions).set({ leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'` })
          .where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId), eq(agentSessions.leaseToken, token), sql`${agentSessions.leaseExpiresAt} > now()`)).returning({ token: agentSessions.leaseToken });
        if (!renewed.length) throw new Error('Personal-agent execution lease expired.');
      }).catch((error: unknown) => { this.failure = error instanceof Error ? error : new Error(String(error)); });
    }, 20_000);
    this.heartbeat.unref();
  }

  /** @returns Fresh intent, profile, messages, retirements and delegations; this read writes no checkpoint. */
  async read(): Promise<PrincipalRecordsView> {
    if (this.failure) throw this.failure;
    return db.transaction((tx) => AgentSessionDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId), { isolationLevel: 'repeatable read' });
  }

  private static async readView(tx: Transaction, userId: string, intentId: string, conversationId: string): Promise<PrincipalRecordsView> {
    const [principal] = await tx.select({ intent: { id: intents.id, payload: intents.payload, status: intents.status, archivedAt: intents.archivedAt, updatedAt: intents.updatedAt },
      name: users.name, intro: users.intro, location: users.location, confirmedAt: sql<string | null>`${users.onboarding}->>'profileConfirmedAt'` })
      .from(intents).innerJoin(users, eq(users.id, intents.userId)).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
    if (!principal) throw new AgentSessionIneligibleError('Intent not found.');
    const history = await tx.select().from(messages).where(and(eq(messages.conversationId, conversationId), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const scope = await tx.select({ assignment: intentNetworks, membership: networkMembers, network: networks }).from(intentNetworks)
      .innerJoin(networks, eq(networks.id, intentNetworks.networkId))
      .leftJoin(networkMembers, and(eq(networkMembers.networkId, intentNetworks.networkId), eq(networkMembers.userId, userId)))
      .where(eq(intentNetworks.intentId, intentId)).orderBy(asc(intentNetworks.networkId));
    const executors = await tx.select({ id: agents.id, type: agents.type, status: agents.status, selected: agents.handleNegotiations, deletedAt: agents.deletedAt })
      .from(agents).where(eq(agents.ownerId, userId)).orderBy(asc(agents.id));
    const entries: PrincipalMessage[] = [];
    const delegations: PrincipalDelegation[] = [];
    const retiredQuestionIds: string[] = [];
    for (const message of history) {
      const metadata = message.metadata as PrincipalMetadata | null;
      const internal = message.role === 'agent' && message.senderId === SYSTEM_AGENT_ID;
      if (internal && metadata?.principalDelegation) {
        delegations.push({ ...metadata.principalDelegation, id: message.id, createdAt: message.createdAt.toISOString() });
      } else if (internal && metadata?.retiredQuestionId) {
        retiredQuestionIds.push(metadata.retiredQuestionId);
      } else {
        const stored = metadata?.principalMessage;
        entries.push({ ...stored, id: message.id, createdAt: message.createdAt.toISOString(),
          kind: stored?.kind ?? (message.role === 'user' ? 'user' : 'message'), matches: stored?.matches ?? [],
          text: (message.parts as { kind: string; text?: string }[]).filter((part) => part && part.kind === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') });
      }
    }
    return {
      intent: { id: intentId, payload: principal.intent.payload },
      principalContext: principal.confirmedAt
        ? JSON.stringify({ confirmedProfile: { name: principal.name, intro: principal.intro, location: principal.location } })
        : 'No confirmed profile is available. Ask for missing personal facts.',
      messages: entries, retiredQuestionIds, delegations,
      version: createHash('sha256').update(JSON.stringify({ principal, history, scope, executors })).digest('hex'),
    };
  }

  /** @param tx - Effect transaction holding the lease fence. @param execution - Owner. @param expectedVersion - Context used by the model. @throws If principal evidence or execution eligibility changed. */
  static async assertContext(tx: Transaction, execution: AgentExecution, expectedVersion: string): Promise<void> {
    const [intent] = await tx.select().from(intents).where(and(eq(intents.id, execution.intentId), eq(intents.userId, execution.userId))).for('share');
    if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') throw new AgentSessionIneligibleError('The principal intent is no longer active.');
    await tx.select({ id: users.id }).from(users).where(eq(users.id, execution.userId)).for('share');
    await tx.select().from(intentNetworks).innerJoin(networks, eq(networks.id, intentNetworks.networkId))
      .where(eq(intentNetworks.intentId, execution.intentId)).for('share');
    await tx.select().from(networkMembers).where(eq(networkMembers.userId, execution.userId)).for('share');
    const [session] = await tx.select({ conversationId: agentSessions.conversationId }).from(agentSessions)
      .where(and(eq(agentSessions.userId, execution.userId), eq(agentSessions.intentId, execution.intentId)));
    const current = await this.readView(tx, execution.userId, execution.intentId, session!.conversationId);
    if (current.version !== expectedVersion) throw new PrincipalContextChanged();
  }

  /** @param input - Direct principal input or an exact-question answer. @returns Committed input, or null if the question changed. */
  async accept(input: PrincipalMessage): Promise<PrincipalMessage | null> {
    if (this.failure) throw this.failure;
    const result = await db.transaction(async (tx) => {
      await AgentSessionDatabaseAdapter.assertOwner(tx, this.execution);
      const [intent] = await tx.select({ status: intents.status, archivedAt: intents.archivedAt }).from(intents)
        .where(and(eq(intents.id, this.execution.intentId), eq(intents.userId, this.execution.userId))).for('share');
      if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') throw new AgentSessionIneligibleError('The principal intent is no longer active.');
      const current = await AgentSessionDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
      const accepted = acceptedPrincipalMessage(current, input);
      if (!accepted) return null;
      const message = await this.insertMessage(tx, accepted);
      return { accepted, message };
    });
    if (!result) return null;
    await this.conversations.publishMessage(result.message);
    return result.accepted;
  }

  private async insertMessage(tx: Transaction, entry: PrincipalMessage): Promise<Message> {
    const { id, createdAt, text, ...principalMessage } = entry;
    const human = entry.kind === 'user' || entry.kind === 'answer';
    return this.conversations.insertMessageWithConversationSession(tx, {
      id, createdAt: new Date(createdAt), conversationId: this.conversationId,
      senderId: human ? this.execution.userId : SYSTEM_AGENT_ID, role: human ? 'user' : 'agent',
      parts: [{ kind: 'text', text }], metadata: { intentId: this.execution.intentId, principalMessage }, extensions: null,
    });
  }

  /** @param effects - Explicit outputs only. @param expectedVersion - Source context. @returns False for stale or duplicate effects; notifications follow commit. */
  async write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean> {
    if (this.failure) throw this.failure;
    let persisted: Message[];
    try {
      persisted = await db.transaction(async (tx) => {
        await AgentSessionDatabaseAdapter.assertOwner(tx, this.execution);
        await AgentSessionDatabaseAdapter.assertContext(tx, this.execution, expectedVersion);
        const current = await AgentSessionDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
        if (!validPrincipalEffects(current, effects)) throw new PrincipalContextChanged();
        for (const expected of [...effects.negotiations].sort((a, b) => a.opportunityId.localeCompare(b.opportunityId))) {
          const [record] = await tx.select().from(negotiations).where(eq(negotiations.opportunityId, expected.opportunityId)).for('update');
          if (!record || !(record.initiatorUserId === this.execution.userId && record.initiatorIntentId === this.execution.intentId
            || record.responderUserId === this.execution.userId && record.responderIntentId === this.execution.intentId)) throw new Error('Negotiation belongs to another principal or intent.');
          const [turns] = await tx.select({ count: sql<number>`count(*)::integer` }).from(negotiationTurns).where(eq(negotiationTurns.negotiationId, record.id));
          if (turns!.count !== expected.turnCount || record.outcome !== expected.outcome || record.awaitingUserId !== expected.awaitingUserId) throw new PrincipalContextChanged();
        }
        const inserted: Message[] = [];
        for (const entry of effects.messages) inserted.push(await this.insertMessage(tx, entry));
        for (const delegation of effects.delegations) {
          if (!effects.negotiations.some((record) => record.opportunityId === delegation.opportunityId && !record.outcome)) throw new Error('A delegation needs a current unsettled negotiation.');
          const { id, createdAt, ...principalDelegation } = delegation;
          await tx.insert(messages).values({ id, createdAt: new Date(createdAt), conversationId: this.conversationId, senderId: SYSTEM_AGENT_ID,
            role: 'agent', parts: [], metadata: { intentId: this.execution.intentId, principalDelegation } });
        }
        return inserted;
      });
    } catch (error) {
      if (error instanceof PrincipalContextChanged) return false;
      throw error;
    }
    await Promise.all(persisted.map((message) => this.conversations.publishMessage(message)));
    for (const message of effects.messages) if (message.kind === 'question') {
      await publishPendingQuestionEvent(this.execution.userId, this.execution.intentId, { id: message.questionId!, question: message.text, options: message.options });
    }
    return true;
  }

  /** Release this process's lease without erasing the saved conversation or pending question. */
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.renewal;
    await db.update(agentSessions).set({ leaseToken: null, leaseExpiresAt: null })
      .where(and(eq(agentSessions.userId, this.execution.userId), eq(agentSessions.intentId, this.execution.intentId), eq(agentSessions.leaseToken, this.execution.token)));
  }
}
