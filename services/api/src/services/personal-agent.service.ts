import type { Model, PrincipalQuestion } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter } from '../adapters/agent-session.database.adapter';
import { createRedisClient } from '../adapters/cache.adapter';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { ApiNegotiationHost, type ApiPrincipal } from '../lib/agent/negotiation.host';
import { log } from '../lib/log';
import { publishUserInvalidation, userEventChannel } from '../lib/user-events';

const logger = log.service.from('PersonalAgentService');

/** An owner-facing input failure; no agent work is acknowledged by this error. */
export class PersonalAgentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

export interface PersonalAgentState {
  status: 'running' | 'starting' | 'paused' | 'external' | 'unavailable';
  pending: PrincipalQuestion | null;
  queuedQuestions: number;
}

interface Session {
  principal: ApiPrincipal;
  host: ApiNegotiationHost;
  ready: Promise<void>;
  active: boolean;
  stopping?: Promise<void>;
}

/** Owns the API process's personal agents independently of HTTP requests and browser connections. */
export class PersonalAgentService {
  private readonly sessions = new Map<string, Session>();
  private readonly intents = new IntentDatabaseAdapter();
  private readonly registry = new AgentDatabaseAdapter();
  private readonly errors = new Map<string, string>();
  private readonly principals = new Map<string, ApiPrincipal>();
  private readonly desired = new Map<string, ApiPrincipal>();
  private readonly pendingOwners = new Set<string | undefined>();
  private running = false;
  private checking?: Promise<void>;
  private subscriber?: ReturnType<typeof createRedisClient>;

  constructor(private readonly model: Model) {}

  /** Subscribe before boot discovery, then reconcile only owners whose intent or executor configuration changes. */
  async start(): Promise<void> {
    this.running = true;
    this.subscriber = createRedisClient();
    this.subscriber.on('pmessage', (_pattern, channel: string, raw: string) => {
      try {
        const { type } = JSON.parse(raw);
        if (!['intent.lifecycle', 'intent.updated', 'agent.configuration'].includes(type)) return;
      } catch { return; }
      void this.reconcile(channel.slice(userEventChannel('').length));
    });
    await this.subscriber.psubscribe(userEventChannel('*'));
    this.subscriber.on('ready', () => { void this.reconcile(); });
    if (this.running) await this.reconcile();
  }

  private reconcile(userId?: string): Promise<void> {
    if (!this.running) return Promise.resolve();
    this.pendingOwners.add(userId);
    if (this.checking) return this.checking;
    this.checking = (async () => {
      while (this.running && this.pendingOwners.size) {
        const ownerId = this.pendingOwners.has(undefined) ? undefined : this.pendingOwners.values().next().value;
        if (ownerId === undefined) this.pendingOwners.clear();
        else this.pendingOwners.delete(ownerId);
        const principals = await ApiNegotiationHost.principals(ownerId);
        const externalOwners = new Set(await this.registry.listSelectedNegotiatorOwners(ownerId));
        if (!this.running) return;
        for (const [id, principal] of this.principals) {
          if (ownerId !== undefined && principal.userId !== ownerId) continue;
          this.principals.delete(id);
          this.desired.delete(id);
        }
        for (const principal of principals) {
          this.principals.set(principal.id, principal);
          if (!externalOwners.has(principal.userId)) this.desired.set(principal.id, principal);
        }
        for (const [id, session] of this.sessions) {
          if (ownerId !== undefined && session.principal.userId !== ownerId) continue;
          if (!session.stopping && JSON.stringify(this.desired.get(id)) === JSON.stringify(session.principal)
            && !session.host.agents.get(id)?.stopped) continue;
          // Replacement waits only on this intent's lease release, never on the reconciliation loop.
          void this.stopSession(session).then(() => {
            const principal = this.desired.get(id);
            if (principal) this.startSession(principal);
          }, () => {});
        }
        for (const principal of principals) {
          if (this.desired.has(principal.id)) this.startSession(principal);
        }
      }
    })().catch((error: unknown) => {
      logger.error('Personal-agent reconciliation failed', { error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      this.checking = undefined;
      if (this.pendingOwners.size && this.running) void this.reconcile(this.pendingOwners.values().next().value);
    });
    return this.checking;
  }

  private startSession(principal: ApiPrincipal): void {
    if (!this.running || this.sessions.has(principal.id)) return;
    const host = new ApiNegotiationHost([principal], this.model);
    const session: Session = { principal, host, active: false, ready: Promise.resolve() };
    this.sessions.set(principal.id, session);
    session.ready = host.start().then(() => {
      if (!this.running || session.stopping || this.sessions.get(principal.id) !== session) return;
      session.active = true;
      this.errors.delete(principal.id);
      void publishUserInvalidation(principal.userId, 'agent.status', principal.intentId);
    });
    void session.ready.catch((error: unknown) => {
      if (session.stopping || this.sessions.get(principal.id) !== session) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (this.errors.get(principal.id) !== reason) logger.warn('Personal agent could not start', { intentId: principal.intentId, error: reason });
      this.errors.set(principal.id, reason);
      void this.stopSession(session);
    });
  }

  /** Keep an intent reserved until its previous host has finished releasing its lease. */
  private stopSession(session: Session): Promise<void> {
    if (session.stopping) return session.stopping;
    session.active = false;
    session.stopping = session.host.stop().then(() => {
      if (this.sessions.get(session.principal.id) === session) this.sessions.delete(session.principal.id);
      if (this.running) void publishUserInvalidation(session.principal.userId, 'agent.status', session.principal.intentId);
    });
    void session.stopping.catch((error: unknown) => {
      logger.error('Personal agent could not stop', { intentId: session.principal.intentId, error: error instanceof Error ? error.message : String(error) });
    });
    return session.stopping;
  }

  /** @param userId - Authenticated owner. @param intentId - Intent conversation being read. @returns Persisted question and current runtime availability. @throws When the caller does not own the intent. */
  async state(userId: string, intentId: string): Promise<PersonalAgentState> {
    const [owned, external, saved] = await Promise.all([
      this.intents.isOwnedByUser(intentId, userId), this.registry.getSelectedNegotiator(userId),
      AgentSessionDatabaseAdapter.readSession(userId, intentId),
    ]);
    if (!owned) throw new PersonalAgentError('Intent not found.', 404);
    if (external) return { status: 'external', pending: null, queuedQuestions: 0 };
    const session = this.sessions.get(intentId);
    const agent = session?.host.agents.get(intentId);
    const status = session?.stopping || agent?.stopped ? 'unavailable' : session?.active ? 'running' : session ? 'starting'
      : this.principals.has(intentId) ? 'unavailable' : 'paused';
    return { status, pending: status === 'running' ? saved?.state?.inbox.question ?? null : null,
      queuedQuestions: agent?.queuedQuestions ?? 0 };
  }

  /**
   * Route principal input through the same agent inbox used by the TUI.
   * @param input - Authenticated owner, intent, canonical DM, and the exact displayed question (or null for a direct message).
   * @returns The atomically persisted message, or null when an external executor owns this conversation.
   * @throws When ownership, availability, or the displayed question changed.
   */
  async send(input: { userId: string; intentId: string; conversationId: string; text: string; questionId: string | null }) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new PersonalAgentError('Intent not found.', 404);
    if (await this.registry.getSelectedNegotiator(input.userId)) return null;
    if (!this.running) throw new PersonalAgentError('Your personal agent is unavailable.', 503);
    if (!this.sessions.has(input.intentId) || this.sessions.get(input.intentId)?.host.agents.get(input.intentId)?.stopped) await this.reconcile(input.userId);
    const session = this.sessions.get(input.intentId);
    if (!session || session.principal.userId !== input.userId) throw new PersonalAgentError('Your personal agent is unavailable. The intent must be active and its session must be free.', 409);
    if (session.stopping) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    try { await session.ready; }
    catch { throw new PersonalAgentError('Your personal agent could not start. Please try again.', 503); }
    if (!this.running || session.stopping || this.sessions.get(input.intentId) !== session) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    const saved = await AgentSessionDatabaseAdapter.readSession(input.userId, input.intentId);
    if (saved?.conversationId !== input.conversationId) throw new PersonalAgentError('Agent conversation not found.', 404);
    const agent = session.host.agents.get(input.intentId)!;
    if (agent.stopped) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    const receipt = input.questionId ? await agent.answer(input.questionId, input.text) : await agent.message(input.text);
    if (!receipt) throw new PersonalAgentError('The question changed. Refresh the conversation and try again; your message was not sent.', 409);
    return AgentSessionDatabaseAdapter.readMessage(receipt.id);
  }

  /** Flush every session and release its lease during API shutdown. */
  async stop(): Promise<void> {
    this.running = false;
    this.subscriber?.disconnect();
    this.pendingOwners.clear();
    await this.checking;
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)));
    this.sessions.clear();
  }
}
