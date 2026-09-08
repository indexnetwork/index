import type { PrincipalMessage, PrincipalState, PrincipalStore } from '@indexnetwork/agent';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { agentSessions, agents, intents, messages, type Message } from '../schemas/database.schema';

import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { SYSTEM_AGENT_ID } from './database.shared';

export interface AgentExecution { userId: string; intentId: string; token: string }
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const LEASE_SECONDS = 60;

/** Fence checkpoints and A2A writes against the same exclusively owned runtime session. */
export class AgentSessionDatabaseAdapter implements PrincipalStore {
  readonly execution: AgentExecution;
  private revision = 0;
  private conversationId = '';
  private heartbeat?: ReturnType<typeof setInterval>;
  private renewal: Promise<void> = Promise.resolve();
  private failure?: Error;
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

  /** @param tx - The caller's transaction. @param execution - Its session fence. @throws When ownership expired or moved to another process. */
  static async assertOwner(tx: Transaction, execution: AgentExecution): Promise<void> {
    const [row] = await tx.select({ token: agentSessions.leaseToken }).from(agentSessions).where(and(
      eq(agentSessions.userId, execution.userId), eq(agentSessions.intentId, execution.intentId),
      eq(agentSessions.leaseToken, execution.token), sql`${agentSessions.leaseExpiresAt} > now()`,
    )).for('update');
    if (!row) throw new Error('This personal-agent session is no longer owned by this process.');
  }

  /** Acquire the session and read its canonical intent conversation. @returns The checkpoint and H2A history. @throws If another process owns it or the intent is not the principal's. */
  async load(): Promise<{ state: PrincipalState | null; messages: PrincipalMessage[] }> {
    const { userId, intentId, token } = this.execution;
    const [intent] = await db.select({ id: intents.id }).from(intents).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
    if (!intent) throw new Error('The selected intent does not belong to this principal.');
    const conversation = await this.conversations.getOrCreateAgentDm(userId);
    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${userId}`}, 0))`);
      const [external] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.ownerId, userId), eq(agents.type, 'external'), eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
      )).limit(1);
      if (external) throw new Error('This principal has selected an external negotiation executor.');
      await tx.insert(agentSessions).values({ userId, intentId, conversationId: conversation.id }).onConflictDoNothing();
      const [acquired] = await tx.update(agentSessions).set({
        leaseToken: token, leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'`, updatedAt: new Date(),
      }).where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId),
        or(isNull(agentSessions.leaseToken), sql`${agentSessions.leaseExpiresAt} <= now()`))).returning();
      if (!acquired) throw new Error('This principal/intent already has an active personal-agent session.');
      return acquired;
    });
    this.revision = row.revision;
    this.conversationId = row.conversationId;
    this.heartbeat = setInterval(() => {
      this.renewal = this.renewal.then(async () => {
        const renewed = await db.update(agentSessions).set({ leaseExpiresAt: sql`now() + ${LEASE_SECONDS} * interval '1 second'` })
          .where(and(eq(agentSessions.userId, userId), eq(agentSessions.intentId, intentId), eq(agentSessions.leaseToken, token), sql`${agentSessions.leaseExpiresAt} > now()`)).returning({ token: agentSessions.leaseToken });
        if (!renewed.length) throw new Error('Personal-agent execution lease expired.');
      }).catch((error: unknown) => { this.failure = error instanceof Error ? error : new Error(String(error)); });
    }, 20_000);
    this.heartbeat.unref();
    const history = await db.select().from(messages).where(and(eq(messages.conversationId, row.conversationId), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return { state: row.state as PrincipalState | null, messages: history.map((message) => {
      const metadata = message.metadata as { principalMessage?: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'> } | null;
      const stored = metadata?.principalMessage;
      return { ...stored, id: message.id, createdAt: message.createdAt.toISOString(),
        kind: stored?.kind ?? (message.role === 'user' ? 'user' : 'message'), matches: stored?.matches ?? [],
        text: (message.parts as { kind: string; text?: string }[]).filter((part) => part && part.kind === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') };
    }) };
  }

  /** @param state - Opaque agent checkpoint. @param entries - H2A messages published by that checkpoint. @throws On a stale revision, lost lease, or failed transaction. */
  async save(state: PrincipalState, entries: readonly PrincipalMessage[]): Promise<void> {
    if (this.failure) throw this.failure;
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
  }

  /** Release this process's lease without erasing the saved conversation or pending question. */
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.renewal;
    await db.update(agentSessions).set({ leaseToken: null, leaseExpiresAt: null })
      .where(and(eq(agentSessions.userId, this.execution.userId), eq(agentSessions.intentId, this.execution.intentId), eq(agentSessions.leaseToken, this.execution.token)));
  }
}
