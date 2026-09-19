import { createHash } from 'node:crypto';

import { briefExecutionVersion, pendingPrincipalQuestions, validPrincipalEffects, validStandingBrief, acceptedPrincipalMessages, latestPrincipalInput, openingDelegation, openingRequestKey, type NegotiationOpeningRequest, type OpenNegotiationResult, type PrincipalDelegation, type PrincipalMessage, type PrincipalQuestion, type PrincipalRecords, type PrincipalRecordsView, type PrincipalEffects, type PrincipalStandingBrief } from '@indexnetwork/agent';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { RuntimeConflictError } from '../lib/agent/runtime-errors';
import db from '../lib/drizzle/drizzle';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { publishUserEvent, publishUserInvalidation } from '../lib/user-events';
import { agents, conversations, intents, intentNetworks, networkMembers, networks, negotiations, opportunities, negotiationTurns, users, messages, type Message } from '../schemas/database.schema';

import { agentDatabaseAdapter } from './agent.database.adapter';
import { getRedisClient } from './cache.adapter';
import { ConversationDatabaseAdapter } from './conversation.database.adapter';
import { SYSTEM_AGENT_ID, activeIntentLifecycleWhere } from './database.shared';

export interface PrincipalExecution { userId: string; intentId: string; token: string }

/** External agents own their question policy; their explicit withdrawals are durable inbox records. */
export type ExternalPrincipalMessage = Omit<PrincipalMessage, 'kind'> & { kind: 'question' | 'answer' | 'user' | 'message' | 'expire' };

/** Reject an effect based on records superseded during model work. */
class PrincipalContextChanged extends Error {
  constructor() { super('Principal context changed; discard this decision.'); }
}
interface PrincipalMetadata {
  principalMessage?: Omit<PrincipalMessage, 'id' | 'createdAt' | 'text'>;
  principalStandingBrief?: Omit<PrincipalStandingBrief, 'id' | 'createdAt'>;
  principalDelegation?: Omit<PrincipalDelegation, 'id' | 'createdAt'>;
  retiredQuestionId?: string;
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const OWNERSHIP_TTL_MS = 60_000;
const OWNERSHIP_RENEWAL_MS = 20_000;
const QUESTION_HEADLINE = 'Question from your agent';

function ownershipKey(userId: string, intentId: string): string {
  return `protocol:personal-agent:owner:${userId}:${intentId}`;
}
const QUESTION_BODY_MAX_CHARS = 140;

/** Startup cannot continue until the intent or executor configuration changes. */
export class PrincipalRuntimeIneligibleError extends Error {}

/** A competing runtime owns this principal/intent until its Redis ownership expires. */
export class PrincipalRuntimeConflict extends Error {
  readonly retryAt: number;

  constructor(retryAfterMs: number) {
    super('This principal/intent already has an active personal-agent runtime.');
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
      batchId: question.batchId,
    },
  });
}

/** Reconstruct principal records and fence hosted execution without persisted runtime state. */
export class PrincipalRecordsDatabaseAdapter implements PrincipalRecords {
  readonly execution: PrincipalExecution;
  private conversationId = '';
  private heartbeat?: ReturnType<typeof setInterval>;
  private renewal: Promise<void> = Promise.resolve();
  private failure?: Error;
  private readonly conversations = new ConversationDatabaseAdapter();

  constructor(userId: string, intentId: string) {
    this.execution = { userId, intentId, token: crypto.randomUUID() };
  }

  /** @param userId - Owner. @param intentId - Owned intent. @returns Canonical conversation and reconstructed question status without acquiring runtime ownership. */
  static async readConversation(userId: string, intentId: string) {
    // One statement gives a consistent question snapshot without rebuilding the
    // profile, network scope and executor fingerprints needed only for model work.
    const rows = await db.select({ conversationId: conversations.id, standingBriefId: intents.standingBriefId, message: messages })
      .from(conversations)
      .innerJoin(intents, and(eq(intents.id, intentId), eq(intents.userId, userId)))
      .leftJoin(messages, and(eq(messages.conversationId, conversations.id), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .where(eq(conversations.dmPair, `agent-dm:${userId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const conversation = rows[0];
    if (!conversation) return null;
    const records = this.readHistory(rows.flatMap(({ message }) => message ? [message] : []), conversation.standingBriefId);
    return { conversationId: conversation.conversationId, pending: pendingPrincipalQuestions(records) };
  }

  /** @param userId - Owner. @param intentId - Signal. @returns Visible external inbox records, without restoring a runtime checkpoint. */
  static async readTranscript(userId: string, intentId: string) {
    const conversation = await new ConversationDatabaseAdapter().getOrCreateAgentDm(userId);
    const history = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const entries: ExternalPrincipalMessage[] = [];
    const retired = new Set(history.map((message) => (message.metadata as PrincipalMetadata | null)?.retiredQuestionId).filter(Boolean));
    for (const message of history) {
      const metadata = message.metadata as PrincipalMetadata | null;
      if (metadata?.principalStandingBrief || metadata?.principalDelegation || metadata?.retiredQuestionId || metadata?.principalMessage?.kind === 'event') continue;
      const stored = metadata?.principalMessage as Omit<ExternalPrincipalMessage, 'id' | 'createdAt' | 'text'> | undefined;
      if (stored?.kind === 'question' && retired.has(stored.questionId)) continue;
      entries.push({ ...stored, id: message.id, createdAt: message.createdAt.toISOString(),
        kind: stored?.kind ?? (message.role === 'user' ? 'user' : 'message'), matches: stored?.matches ?? [],
        text: (message.parts as { kind: string; text?: string }[]).filter((part) => part && part.kind === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') });
    }
    return { conversationId: conversation.id, messages: entries };
  }

  /** @param input - Selected executor and its public inbox entries. @returns Newly inserted messages; exact entry IDs make replay idempotent. @throws When executor selection changed. */
  static async publishAgentEntries(input: { userId: string; intentId: string; executorId: string; entries: readonly ExternalPrincipalMessage[] }): Promise<Message[]> {
    const adapter = new ConversationDatabaseAdapter();
    const conversation = await adapter.getOrCreateAgentDm(input.userId);
    const persisted = await db.transaction(async (tx) => {
      await agentDatabaseAdapter.assertSelectedExecutor(tx, input.userId, input.executorId);
      const [intent] = await tx.select({ id: intents.id }).from(intents).where(and(eq(intents.id, input.intentId), eq(intents.userId, input.userId)));
      if (!intent) throw new PrincipalRuntimeIneligibleError('Intent not found.');
      const history = await tx.select({ id: messages.id }).from(messages).where(and(eq(messages.conversationId, conversation.id), sql`${messages.metadata}->>'intentId' = ${input.intentId}`));
      const known = new Set(history.map(({ id }) => id));
      const inserted: Message[] = [];
      for (const entry of input.entries) {
        if (known.has(entry.id)) continue;
        const { id, createdAt, text, ...principalMessage } = entry;
        if (entry.kind === 'question') principalMessage.batchId ??= entry.id;
        inserted.push(await adapter.insertMessageWithConversationSession(tx, {
          id, createdAt: new Date(createdAt), conversationId: conversation.id, senderId: SYSTEM_AGENT_ID, role: 'agent',
          parts: [{ kind: 'text', text }], metadata: { intentId: input.intentId, principalMessage }, extensions: null,
        }));
        known.add(id);
      }
      return inserted;
    });
    await Promise.all(persisted.map((message) => adapter.publishMessage(message)));
    return persisted;
  }

  /** @param input - Owner input for the selected external executor. @returns One committed human message. @throws If executor ownership moved back to the hosted runtime. */
  static async writeOwnerInput(input: { userId: string; intentId: string; conversationId: string; text: string; questionId: string | null; pending: { id: string; matches: PrincipalMessage['matches']; scope?: PrincipalMessage['scope'] } | null }): Promise<Message> {
    const [message] = await this.writeOwnerAnswers({ ...input, answers: [{ text: input.text, question: input.pending }] });
    return message!;
  }

  /** @param input - A batch addressed to an external executor, whose question policy is independent. @returns Messages committed together before any principal-input event. @throws If selection changed. */
  static async writeOwnerAnswers(input: { userId: string; intentId: string; conversationId: string; answers: readonly { text: string; question: { id: string; matches: PrincipalMessage['matches']; scope?: PrincipalMessage['scope'] } | null }[] }): Promise<Message[]> {
    const adapter = new ConversationDatabaseAdapter();
    const persisted = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${input.userId}`}, 0))`);
      const [selected] = await tx.select({ id: agents.id }).from(agents).where(and(eq(agents.ownerId, input.userId), eq(agents.type, 'external'), eq(agents.handleNegotiations, true), isNull(agents.deletedAt)));
      if (!selected) throw new RuntimeConflictError();
      const canonical = await this.conversationId(tx, input.userId);
      if (canonical !== input.conversationId) throw new PrincipalRuntimeIneligibleError('Agent conversation not found.');
      const [intent] = await tx.select({ id: intents.id }).from(intents).where(and(eq(intents.id, input.intentId), eq(intents.userId, input.userId))).for('update');
      if (!intent) throw new PrincipalRuntimeIneligibleError('Intent not found.');
      const [latest] = await tx.select({ createdAt: messages.createdAt }).from(messages)
        .where(and(eq(messages.conversationId, input.conversationId), sql`${messages.metadata}->>'intentId' = ${input.intentId}`))
        .orderBy(desc(messages.createdAt), desc(messages.id)).limit(1);
      let time = Math.max(Date.now(), latest ? latest.createdAt.getTime() + 1 : 0);
      const inserted: Message[] = [];
      for (const { text, question } of input.answers) {
        const principalMessage = question ? { kind: 'answer', questionId: question.id, matches: question.matches, scope: question.scope } : { kind: 'user', matches: [] };
        inserted.push(await adapter.insertMessageWithConversationSession(tx, { id: crypto.randomUUID(), createdAt: new Date(time++), conversationId: input.conversationId, senderId: input.userId, role: 'user',
          parts: [{ kind: 'text', text }], metadata: { intentId: input.intentId, principalMessage }, extensions: null }));
      }
      await tx.update(intents).set({ standingBriefId: null }).where(eq(intents.id, input.intentId));
      return inserted;
    });
    await Promise.all(persisted.map((message) => adapter.publishMessage(message)));
    return persisted;
  }

  /** @param id - Receipt returned after an atomic input write. @returns Its canonical conversation message. */
  static async readMessage(id: string): Promise<Message> {
    const [message] = await db.select().from(messages).where(eq(messages.id, id));
    if (!message) throw new Error('The personal-agent input was not persisted.');
    return message;
  }

  /** @param tx - The caller's effect transaction. @param execution - Hosted runtime identity. @throws When ownership expired or moved. */
  static async assertOwner(tx: Transaction, execution: PrincipalExecution): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${execution.userId}`}, 0))`);
    const token = await getRedisClient().get(ownershipKey(execution.userId, execution.intentId));
    if (token !== execution.token) throw new Error('This personal-agent runtime is no longer owned by this process.');
    const [external] = await tx.select({ id: agents.id }).from(agents).where(and(
      eq(agents.ownerId, execution.userId), eq(agents.type, 'external'), eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
    )).limit(1);
    if (external) throw new PrincipalRuntimeIneligibleError('This principal has selected an external negotiation executor.');
  }

  /** Acquire distributed runtime ownership without restoring model work. @throws When the intent is ineligible or another host owns it. */
  async start(): Promise<void> {
    const { userId, intentId, token } = this.execution;
    const conversation = await this.conversations.getOrCreateAgentDm(userId);
    let ownsRuntime = false;
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${userId}`}, 0))`);
        const [intent] = await tx.select({ id: intents.id, status: intents.status, archivedAt: intents.archivedAt })
          .from(intents).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
        if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') {
          throw new PrincipalRuntimeIneligibleError('The selected intent must be active and belong to this principal.');
        }
        const [external] = await tx.select({ id: agents.id }).from(agents).where(and(
          eq(agents.ownerId, userId), eq(agents.type, 'external'), eq(agents.handleNegotiations, true), isNull(agents.deletedAt),
        )).limit(1);
        if (external) throw new PrincipalRuntimeIneligibleError('This principal has selected an external negotiation executor.');
        const acquired = await getRedisClient().set(ownershipKey(userId, intentId), token, 'PX', OWNERSHIP_TTL_MS, 'NX');
        if (acquired !== 'OK') {
          const retryAfterMs = Math.max(0, await getRedisClient().pttl(ownershipKey(userId, intentId)));
          throw new PrincipalRuntimeConflict(retryAfterMs);
        }
        ownsRuntime = true;
      });
    } catch (error) {
      if (ownsRuntime) await getRedisClient().eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        ownershipKey(userId, intentId),
        token,
      ).catch(() => {});
      throw error;
    }
    this.conversationId = conversation.id;
    this.heartbeat = setInterval(() => {
      this.renewal = this.renewal.then(async () => {
        const renewed = await getRedisClient().eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
          1,
          ownershipKey(userId, intentId),
          token,
          OWNERSHIP_TTL_MS,
        );
        if (renewed !== 1) throw new Error('Personal-agent runtime ownership expired.');
      }).catch((error: unknown) => { this.failure = error instanceof Error ? error : new Error(String(error)); });
    }, OWNERSHIP_RENEWAL_MS);
    this.heartbeat.unref();
  }

  /** @returns Fresh intent, profile, messages, retirements and delegations; this read writes no checkpoint. */
  async read(): Promise<PrincipalRecordsView> {
    if (this.failure) throw this.failure;
    const token = await getRedisClient().get(ownershipKey(this.execution.userId, this.execution.intentId));
    if (token !== this.execution.token) throw new Error('This personal-agent runtime is no longer owned by this process.');
    return db.transaction((tx) => PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId), { isolationLevel: 'repeatable read' });
  }

  private static readHistory(history: Message[], standingBriefId: string | null) {
    const entries: PrincipalMessage[] = [];
    let standingBrief: PrincipalStandingBrief | null = null;
    const delegations: PrincipalDelegation[] = [];
    const retiredQuestionIds: string[] = [];
    for (const message of history) {
      const metadata = message.metadata as PrincipalMetadata | null;
      const internal = message.role === 'agent' && message.senderId === SYSTEM_AGENT_ID;
      if (internal && metadata?.principalStandingBrief) {
        if (message.id === standingBriefId) standingBrief = { ...metadata.principalStandingBrief, id: message.id, createdAt: message.createdAt.toISOString() };
      } else if (internal && metadata?.principalDelegation) {
        delegations.push({ ...metadata.principalDelegation, id: message.id, createdAt: message.createdAt.toISOString() });
      } else if (internal && metadata?.retiredQuestionId) {
        retiredQuestionIds.push(metadata.retiredQuestionId);
      } else if (internal && String(metadata?.principalMessage?.kind) === 'expire' && metadata?.principalMessage?.questionId) {
        retiredQuestionIds.push(metadata.principalMessage.questionId);
      } else {
        const stored = metadata?.principalMessage;
        entries.push({ ...stored, id: message.id, createdAt: message.createdAt.toISOString(),
          kind: stored?.kind ?? (message.role === 'user' ? 'user' : 'message'), matches: stored?.matches ?? [],
          text: (message.parts as { kind: string; text?: string }[]).filter((part) => part && part.kind === 'text' && typeof part.text === 'string').map((part) => part.text).join('\n') });
      }
    }
    return { messages: entries, retiredQuestionIds, standingBrief, delegations };
  }

  private static async readView(tx: Transaction, userId: string, intentId: string, conversationId: string): Promise<PrincipalRecordsView> {
    const [principal] = await tx.select({ intent: { id: intents.id, payload: intents.payload, status: intents.status, archivedAt: intents.archivedAt, updatedAt: intents.updatedAt, standingBriefId: intents.standingBriefId },
      name: users.name, intro: users.intro, location: users.location, confirmedAt: sql<string | null>`${users.onboarding}->>'profileConfirmedAt'` })
      .from(intents).innerJoin(users, eq(users.id, intents.userId)).where(and(eq(intents.id, intentId), eq(intents.userId, userId)));
    if (!principal) throw new PrincipalRuntimeIneligibleError('Intent not found.');
    const history = await tx.select().from(messages).where(and(eq(messages.conversationId, conversationId), sql`${messages.metadata}->>'intentId' = ${intentId}`))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    const scope = await tx.select({ assignment: intentNetworks, membership: networkMembers, network: networks }).from(intentNetworks)
      .innerJoin(networks, eq(networks.id, intentNetworks.networkId))
      .leftJoin(networkMembers, and(eq(networkMembers.networkId, intentNetworks.networkId), eq(networkMembers.userId, userId)))
      .where(eq(intentNetworks.intentId, intentId)).orderBy(asc(intentNetworks.networkId));
    const executors = await tx.select({ id: agents.id, type: agents.type, status: agents.status, selected: agents.handleNegotiations, deletedAt: agents.deletedAt })
      .from(agents).where(eq(agents.ownerId, userId)).orderBy(asc(agents.id));
    const records = this.readHistory(history, principal.intent.standingBriefId);
    return {
      intent: { id: intentId, payload: principal.intent.payload },
      principalContext: principal.confirmedAt
        ? JSON.stringify({ confirmedProfile: { name: principal.name, intro: principal.intro, location: principal.location } })
        : 'No confirmed profile is available. Ask for missing personal facts.',
      ...records,
      version: createHash('sha256').update(JSON.stringify({ principal, history, scope, executors })).digest('hex'),
      executionVersion: createHash('sha256').update(JSON.stringify({
        intent: {
          id: principal.intent.id,
          payload: principal.intent.payload,
          status: principal.intent.status,
          archivedAt: principal.intent.archivedAt,
          updatedAt: principal.intent.updatedAt,
        },
        inputs: records.messages.filter((entry) => entry.kind === 'user' || entry.kind === 'answer'),
        executors,
      })).digest('hex'),
    };
  }

  private static async conversationId(tx: Transaction, userId: string): Promise<string> {
    const [conversation] = await tx.select({ id: conversations.id }).from(conversations)
      .where(eq(conversations.dmPair, `agent-dm:${userId}`));
    if (!conversation) throw new PrincipalRuntimeIneligibleError('The principal conversation does not exist.');
    return conversation.id;
  }

  /** @param tx - Effect transaction holding the runtime fence. @param execution - Owner. @param expectedVersion - Context used by the model. @throws If principal evidence or execution eligibility changed. */
  static async assertContext(tx: Transaction, execution: PrincipalExecution, expectedVersion: string): Promise<void> {
    const [intent] = await tx.select().from(intents).where(and(eq(intents.id, execution.intentId), eq(intents.userId, execution.userId))).for('share');
    if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') throw new PrincipalRuntimeIneligibleError('The principal intent is no longer active.');
    await tx.select({ id: users.id }).from(users).where(eq(users.id, execution.userId)).for('share');
    await tx.select().from(intentNetworks).innerJoin(networks, eq(networks.id, intentNetworks.networkId))
      .where(eq(intentNetworks.intentId, execution.intentId)).for('share');
    await tx.select().from(networkMembers).where(eq(networkMembers.userId, execution.userId)).for('share');
    const current = await this.readView(tx, execution.userId, execution.intentId, await this.conversationId(tx, execution.userId));
    if (current.version !== expectedVersion) throw new PrincipalContextChanged();
  }

  /** @param tx - Turn transaction. @param execution - Hosted owner. @param opportunityId - Negotiation using the brief. @param expectedVersion - Brief-relevant context used by A2A. @throws If authority or execution eligibility changed. */
  static async assertExecutionContext(tx: Transaction, execution: PrincipalExecution, opportunityId: string, expectedVersion: string): Promise<void> {
    const [intent] = await tx.select({ status: intents.status, archivedAt: intents.archivedAt }).from(intents)
      .where(and(eq(intents.id, execution.intentId), eq(intents.userId, execution.userId))).for('share');
    if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') throw new PrincipalRuntimeIneligibleError('The principal intent is no longer active.');
    const current = await this.readView(tx, execution.userId, execution.intentId, await this.conversationId(tx, execution.userId));
    if (briefExecutionVersion(current, opportunityId) !== expectedVersion) throw new PrincipalContextChanged();
  }

  /** @param inputs - One direct input/event or the complete answer batch. @returns Inputs committed in one transaction, or null with no writes. */
  async accept(inputs: readonly PrincipalMessage[]): Promise<readonly PrincipalMessage[] | null> {
    if (this.failure) throw this.failure;
    const input = inputs[0];
    if (!input) return null;
    const result = await db.transaction(async (tx) => {
      await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
      const [intent] = await tx.select({ payload: intents.payload, summary: intents.summary, status: intents.status, archivedAt: intents.archivedAt, updatedAt: intents.updatedAt, standingBriefId: intents.standingBriefId }).from(intents)
        .where(and(eq(intents.id, this.execution.intentId), eq(intents.userId, this.execution.userId))).for('share');
      if (!intent || intent.archivedAt || intent.status !== null && intent.status !== 'ACTIVE') throw new PrincipalRuntimeIneligibleError('The principal intent is no longer active.');
      if (input.kind === 'event') {
        const activation = input.activation;
        if (activation?.type === 'intent.created') {
          if (activation.id !== `intent.created:${this.execution.intentId}`) return null;
        } else if (activation?.type === 'intent.broadcast') {
          const [link] = await tx.select({ version: sql<string>`${intentNetworks.createdAt}::text` }).from(intentNetworks)
            .innerJoin(networks, and(eq(networks.id, intentNetworks.networkId), isNull(networks.deletedAt)))
            .innerJoin(networkMembers, and(eq(networkMembers.networkId, intentNetworks.networkId), eq(networkMembers.userId, this.execution.userId), isNull(networkMembers.deletedAt), sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`))
            .where(and(eq(intentNetworks.intentId, this.execution.intentId), eq(intentNetworks.networkId, activation.networkId))).for('share');
          if (!link || activation.id !== `intent.broadcast:${this.execution.intentId}:${activation.networkId}:${link.version}`) return null;
        } else if (activation?.type === 'intent.revised') {
          if (activation.revisionVersionMs !== intent.updatedAt.getTime()
            || activation.fingerprint !== computeIntentFingerprint(intent.payload, intent.summary)
            || activation.id !== `intent.revised:${this.execution.intentId}:${activation.revisionVersionMs}:${activation.fingerprint}`) return null;
        } else if (activation?.type === 'intent.resumed') {
          if (activation.lifecycleVersionMs !== intent.updatedAt.getTime()
            || activation.id !== `intent.resumed:${this.execution.intentId}:${activation.lifecycleVersionMs}`) return null;
        } else if (activation?.type !== 'h2a.wake') return null;
      }
      const history = await tx.select().from(messages)
        .where(and(eq(messages.conversationId, this.conversationId), sql`${messages.metadata}->>'intentId' = ${this.execution.intentId}`))
        .orderBy(asc(messages.createdAt), asc(messages.id));
      const current = PrincipalRecordsDatabaseAdapter.readHistory(history, intent.standingBriefId);
      const accepted = acceptedPrincipalMessages(current, inputs);
      if (!accepted) return null;
      const persisted: Message[] = [];
      for (const entry of accepted) persisted.push(await this.insertMessage(tx, entry));
      if (input.kind !== 'event') await tx.update(intents).set({ standingBriefId: null }).where(eq(intents.id, this.execution.intentId));
      return { accepted, persisted };
    });
    if (!result) return null;
    if (input.kind !== 'event') await Promise.all(result.persisted.map((message) => this.conversations.publishMessage(message)));
    return result.accepted;
  }

  private async insertMessage(tx: Transaction, entry: PrincipalMessage): Promise<Message> {
    const { id, createdAt, text, ...principalMessage } = entry;
    const human = entry.kind === 'user' || entry.kind === 'answer';
    if (entry.kind === 'event') {
      const [message] = await tx.insert(messages).values({
        id, createdAt: new Date(createdAt), conversationId: this.conversationId, senderId: SYSTEM_AGENT_ID, role: 'agent',
        parts: [], metadata: { intentId: this.execution.intentId, principalMessage }, extensions: null,
      }).returning();
      return message!;
    }
    return this.conversations.insertMessageWithConversationSession(tx, {
      id, createdAt: new Date(createdAt), conversationId: this.conversationId,
      senderId: human ? this.execution.userId : SYSTEM_AGENT_ID, role: human ? 'user' : 'agent',
      parts: [{ kind: 'text', text }], metadata: { intentId: this.execution.intentId, principalMessage }, extensions: null,
    });
  }

  /** @param brief - Complete intent-wide mandate. @param expectedVersion - Source context. @returns False when the activation became stale. */
  async writeStandingBrief(brief: PrincipalStandingBrief, expectedVersion: string): Promise<boolean> {
    if (this.failure) throw this.failure;
    let committed = false;
    try {
      await db.transaction(async (tx) => {
        await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
        await PrincipalRecordsDatabaseAdapter.assertContext(tx, this.execution, expectedVersion);
        const current = await PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
        if (!validStandingBrief(current, brief)) throw new PrincipalContextChanged();
        const { id, createdAt, ...principalStandingBrief } = brief;
        await tx.insert(messages).values({ id, createdAt: new Date(createdAt), conversationId: this.conversationId, senderId: SYSTEM_AGENT_ID,
          role: 'agent', parts: [], metadata: { intentId: this.execution.intentId, principalStandingBrief } });
        const [updated] = await tx.update(intents).set({ standingBriefId: id })
          .where(and(eq(intents.id, this.execution.intentId), eq(intents.userId, this.execution.userId))).returning({ id: intents.id });
        if (!updated) throw new PrincipalContextChanged();
        committed = true;
      });
      return true;
    } catch (error) {
      if (error instanceof PrincipalContextChanged) return false;
      if (committed && (await this.read()).standingBrief?.id === brief.id) return true;
      throw error;
    }
  }

  /** @param effects - Explicit outputs only. @param expectedVersion - Source context. @returns False for stale or duplicate effects; notifications follow commit. */
  async write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean> {
    if (this.failure) throw this.failure;
    let persisted: Message[];
    try {
      persisted = await db.transaction(async (tx) => {
        await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
        await PrincipalRecordsDatabaseAdapter.assertContext(tx, this.execution, expectedVersion);
        const current = await PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
        if (!validPrincipalEffects(current, effects)) throw new PrincipalContextChanged();
        for (const expected of [...effects.negotiations].sort((a, b) => a.opportunityId.localeCompare(b.opportunityId))) {
          const [record] = await tx.select().from(negotiations).where(eq(negotiations.opportunityId, expected.opportunityId)).for('update');
          if (!record || !(record.initiatorUserId === this.execution.userId && record.initiatorIntentId === this.execution.intentId
            || record.responderUserId === this.execution.userId && record.responderIntentId === this.execution.intentId)) throw new Error('Negotiation belongs to another principal or intent.');
          // Hold the opportunity decision stable until these H2A effects commit.
          const [opportunity] = await tx.select({ status: opportunities.status }).from(opportunities)
            .where(eq(opportunities.id, expected.opportunityId)).for('share');
          if (!opportunity || opportunity.status !== expected.opportunityStatus) throw new PrincipalContextChanged();
          const [turns] = await tx.select({ count: sql<number>`count(*)::integer` }).from(negotiationTurns).where(eq(negotiationTurns.negotiationId, record.id));
          if (turns!.count !== expected.turnCount || record.outcome !== expected.outcome || record.awaitingUserId !== expected.awaitingUserId) throw new PrincipalContextChanged();
        }
        const inserted: Message[] = [];
        for (const entry of effects.messages) inserted.push(await this.insertMessage(tx, entry));
        for (const retiredQuestionId of effects.retiredQuestionIds) {
          await tx.insert(messages).values({ conversationId: this.conversationId, senderId: SYSTEM_AGENT_ID,
            role: 'agent', parts: [], metadata: { intentId: this.execution.intentId, retiredQuestionId } });
        }
        for (const delegation of effects.delegations) {
          if (!effects.negotiations.some((record) => record.opportunityId === delegation.opportunityId && !record.outcome && record.opportunityStatus === 'negotiating')) throw new Error('A delegation needs a current unsettled negotiation.');
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
    if (effects.retiredQuestionIds.length) await publishUserInvalidation(this.execution.userId, 'agent.status', this.execution.intentId);
    for (const message of effects.messages) if (message.kind === 'question') {
      await publishPendingQuestionEvent(this.execution.userId, this.execution.intentId, { id: message.questionId!, batchId: message.batchId!, question: message.text, options: message.options });
    }
    return true;
  }

  /** @returns Current owned intent and authorized active assignments. @throws When execution ownership is lost. */
  async discoveryScope(): Promise<{ version: string; networkIds: string[] } | null> {
    if (this.failure) throw this.failure;
    return db.transaction(async (tx) => {
      await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
      return this.readDiscoveryScope(tx);
    });
  }

  private async readDiscoveryScope(tx: Transaction): Promise<{ version: string; networkIds: string[] } | null> {
    const [external] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.ownerId, this.execution.userId),
          eq(agents.type, 'external'),
          eq(agents.handleNegotiations, true),
          isNull(agents.deletedAt),
        ),
      )
      .limit(1);

    if (external) {
      throw new PrincipalRuntimeIneligibleError('This principal has selected an external negotiation executor.');
    }

    const [intent] = await tx
      .select({ payload: intents.payload, updatedAt: intents.updatedAt })
      .from(intents)
      .where(
        and(
          eq(intents.id, this.execution.intentId),
          eq(intents.userId, this.execution.userId),
          isNull(intents.archivedAt),
          activeIntentLifecycleWhere(),
        ),
      );

    if (!intent) return null;

    const assignments = await tx
      .select({
        networkId: intentNetworks.networkId,
        assignedAt: intentNetworks.createdAt,
        membershipUpdatedAt: networkMembers.updatedAt,
      })
      .from(intentNetworks)
      .innerJoin(
        networkMembers,
        and(
          eq(networkMembers.networkId, intentNetworks.networkId),
          eq(networkMembers.userId, this.execution.userId),
          isNull(networkMembers.deletedAt),
        ),
      )
      .innerJoin(
        networks,
        and(
          eq(networks.id, intentNetworks.networkId),
          isNull(networks.deletedAt),
        ),
      )
      .where(eq(intentNetworks.intentId, this.execution.intentId))
      .orderBy(asc(intentNetworks.networkId));

    return {
      version: JSON.stringify({ intent, assignments }),
      networkIds: assignments.map((row) => row.networkId),
    };
  }

  /**
   * Commit a selected session and its first private delegation in the same transaction.
   * @param request - Runtime-bound selection, brief and source fences.
   * @param open - Pair operation using this transaction; null means ineligible.
   * @param signal - Cancels uncommitted work.
   * @returns The created, reused or replayed session and current context version, or unavailable.
   * @throws For stale context, lost ownership, infrastructure failures or an unconfirmed commit. Never retries the pair operation.
   */
  async openNegotiation(request: NegotiationOpeningRequest, open: (tx: Transaction) => Promise<{ opportunityId: string; created: boolean } | null>, signal: AbortSignal): Promise<OpenNegotiationResult> {
    if (this.failure) throw this.failure;
    signal.throwIfAborted();
    let committed: OpenNegotiationResult | undefined;
    try {
      return await db.transaction(async (tx) => {
        await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
        const replay = await this.readOpeningReplay(tx, request);
        if (replay) return replay;
        await PrincipalRecordsDatabaseAdapter.assertContext(tx, this.execution, request.contextVersion);
        const scope = await this.readDiscoveryScope(tx);
        if (!scope || scope.version !== request.scopeVersion || !scope.networkIds.includes(request.target.networkId)) throw new Error('Intent or search scope changed; discard this opening.');
        const records = await PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
        if (latestPrincipalInput(records.messages) !== request.sourceMessageId || !request.brief.trim() || !request.reasoning.trim() || request.reasoning.length > 2000) throw new Error('An opening needs current principal input, reasoning and a private brief.');
        signal.throwIfAborted();
        const result = await open(tx);
        if (!result) return { status: 'unavailable' };
        const { opportunityId } = result;
        let delegationId: string | undefined;
        if (result.created) {
          const { id, createdAt, ...principalDelegation } = openingDelegation(request, opportunityId, records);
          await tx.insert(messages).values({ id, createdAt: new Date(createdAt), conversationId: this.conversationId, senderId: SYSTEM_AGENT_ID,
            role: 'agent', parts: [], metadata: { intentId: this.execution.intentId, principalDelegation } });
          delegationId = id;
        }
        const current = await PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
        signal.throwIfAborted();
        committed = { status: 'opened', opportunityId, contextVersion: current.version, ...(delegationId ? { delegationId } : {}) };
        return committed;
      });
    } catch (error) {
      // A lost COMMIT response is not a rollback. Confirm the exact private output
      // and its original session; the write callback is never invoked a second time.
      if (committed?.status === 'opened' && !signal.aborted) {
        const replay = await db.transaction(async (tx) => {
          await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);
          return this.readOpeningReplay(tx, request);
        });
        if (replay) return replay;
      }
      throw error;
    }
  }

  /** Resolve only this principal's exact committed opening, even after context advancement or settlement. */
  private async readOpeningReplay(tx: Transaction, request: NegotiationOpeningRequest): Promise<OpenNegotiationResult | null> {
    const [session] = await tx.select().from(negotiations).where(eq(negotiations.openingRequestId, request.id));
    if (!session) return null;
    const records = await PrincipalRecordsDatabaseAdapter.readView(tx, this.execution.userId, this.execution.intentId, this.conversationId);
    const delegation = records.delegations.find((entry) => entry.id === request.id);
    if (session.initiatorUserId !== this.execution.userId || session.initiatorIntentId !== this.execution.intentId
      || session.responderUserId !== request.target.userId || session.responderIntentId !== request.target.intentId
      || delegation?.opportunityId !== session.opportunityId || delegation.opening?.requestKey !== openingRequestKey(request)) {
      throw new Error('Opening request identity was reused.');
    }
    return { status: 'opened', opportunityId: session.opportunityId, delegationId: delegation.id, contextVersion: records.version };
  }

  /**
   * Clear warming after a completed search while the source remains active and assigned.
   * @param networkIds - Authorized networks that the search actually covered.
   * @throws When runtime ownership has changed.
   */
  async markSearched(networkIds: string[]): Promise<void> {
    if (!networkIds.length) return;

    const updated = await db.transaction(async (tx) => {
      await PrincipalRecordsDatabaseAdapter.assertOwner(tx, this.execution);

      const networkIdConditions = sql.join(
        networkIds.map((id) => sql`${id}`),
        sql`, `,
      );

      return tx
        .update(intents)
        .set({ firstDiscoverySucceededAt: new Date() })
        .where(
          and(
            eq(intents.id, this.execution.intentId),
            eq(intents.userId, this.execution.userId),
            isNull(intents.archivedAt),
            activeIntentLifecycleWhere(),
            isNull(intents.firstDiscoverySucceededAt),
            sql`exists (
              select 1 from ${intentNetworks}
              join ${networkMembers} on ${networkMembers.networkId} = ${intentNetworks.networkId}
              join ${networks} on ${networks.id} = ${intentNetworks.networkId}
              where ${intentNetworks.intentId} = ${intents.id}
                and ${networkMembers.userId} = ${intents.userId}
                and ${networkMembers.deletedAt} is null
                and ${networks.deletedAt} is null
                and ${intentNetworks.networkId} in (${networkIdConditions})
            )`,
          ),
        )
        .returning({ id: intents.id });
    });

    if (updated.length) {
      await publishUserInvalidation(this.execution.userId, 'intent.updated', this.execution.intentId);
    }
  }

  /** Release this process's runtime ownership without erasing durable records. */
  async close(): Promise<void> {
    clearInterval(this.heartbeat);
    await this.renewal;
    await getRedisClient().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      ownershipKey(this.execution.userId, this.execution.intentId),
      this.execution.token,
    );
  }
}
