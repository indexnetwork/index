import type { Model, PrincipalQuestion } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter } from '../adapters/agent-session.database.adapter';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { ApiNegotiationHost, type ApiPrincipal } from '../lib/agent/negotiation.host';
import { log } from '../lib/log';

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
}

/** Owns the API process's personal agents independently of HTTP requests and browser connections. */
export class PersonalAgentService {
  private readonly sessions = new Map<string, Session>();
  private readonly intents = new IntentDatabaseAdapter();
  private readonly registry = new AgentDatabaseAdapter();
  private readonly errors = new Map<string, string>();
  private principals = new Map<string, ApiPrincipal>();
  private running = false;
  private checking?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly model: Model) {}

  /** Restore eligible sessions at boot and reconcile new/changed intents and executor bindings in the background. */
  async start(): Promise<void> {
    this.running = true;
    this.timer = setInterval(() => { void this.reconcile(); }, 5_000);
    await this.reconcile();
  }

  private reconcile(): Promise<void> {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const principals = await ApiNegotiationHost.principals();
      const externalOwners = new Set((await Promise.all([...new Set(principals.map(({ userId }) => userId))]
        .map(async (userId) => await this.registry.getSelectedNegotiator(userId) ? userId : null))).filter((id) => id !== null));
      this.principals = new Map(principals.map((principal) => [principal.id, principal]));
      const desired = new Map(principals.filter(({ userId }) => !externalOwners.has(userId)).map((principal) => [principal.id, principal]));
      await Promise.all([...this.sessions].map(async ([id, session]) => {
        if (JSON.stringify(desired.get(id)) === JSON.stringify(session.principal) && !session.host.agents.get(id)?.stopped) return;
        this.sessions.delete(id);
        await session.host.stop();
      }));
      if (!this.running) return;
      await Promise.all([...desired.values()].map(async (principal) => {
        if (this.sessions.has(principal.id) || !this.running) return;
        const host = new ApiNegotiationHost([principal], this.model);
        const session: Session = { principal, host, active: false, ready: Promise.resolve() };
        this.sessions.set(principal.id, session);
        session.ready = host.start().then(() => {
          session.active = true;
          this.errors.delete(principal.id);
        });
        try { await session.ready; }
        catch (error) {
          this.sessions.delete(principal.id);
          await host.stop();
          const reason = error instanceof Error ? error.message : String(error);
          if (this.errors.get(principal.id) !== reason) logger.warn('Personal agent could not start', { intentId: principal.intentId, error: reason });
          this.errors.set(principal.id, reason);
        }
      }));
    })().catch((error: unknown) => {
      logger.error('Personal-agent reconciliation failed', { error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { this.checking = undefined; });
    return this.checking;
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
    const status = agent?.stopped ? 'unavailable' : session?.active ? 'running' : session ? 'starting'
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
    if (!this.sessions.has(input.intentId)) await this.reconcile();
    const session = this.sessions.get(input.intentId);
    if (!session || session.principal.userId !== input.userId) throw new PersonalAgentError('Your personal agent is unavailable. The intent must be active and its session must be free.', 409);
    try { await session.ready; }
    catch { throw new PersonalAgentError('Your personal agent could not start. Please try again.', 503); }
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
    clearInterval(this.timer);
    await this.checking;
    await Promise.all([...this.sessions.values()].map(({ host }) => host.stop()));
    this.sessions.clear();
  }
}
