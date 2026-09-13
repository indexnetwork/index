import { setTimeout as sleep } from 'node:timers/promises';

import type { IntentActivation, Model, PrincipalQuestion, PrincipalAnswer, PrincipalMessage } from '@indexnetwork/agent';

import { AgentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { PrincipalRecordsDatabaseAdapter, PrincipalRuntimeIneligibleError, PrincipalRuntimeConflict } from '../adapters/principal-records.database.adapter';
import { createRedisClient } from '../adapters/cache.adapter';
import { IntentDatabaseAdapter } from '../adapters/intent.database.adapter';
import { ApiNegotiationHost, type ApiPrincipal } from '../lib/agent/negotiation.host';
import { log } from '../lib/log';
import { publishUserInvalidation, readUserEvents, scanUserEventStreams, type UserEventRecord } from '../lib/user-events';

const logger = log.service.from('PersonalAgentService');
const MAX_STARTUP_RETRIES = 3;
const STREAM_BLOCK_MS = 15_000;

/** An owner-facing input failure; no agent work is acknowledged by this error. */
export class PersonalAgentError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 503) { super(message); }
}

export interface PersonalAgentState {
  status: 'running' | 'starting' | 'paused' | 'external' | 'unavailable';
  pending: readonly PrincipalQuestion[];
}

interface Session {
  principal: ApiPrincipal;
  host: ApiNegotiationHost;
  ready: Promise<void>;
  active: boolean;
  stopping?: Promise<void>;
}

interface StartupRetry {
  principal: ApiPrincipal;
  attempts: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** Owns the API process's personal agents independently of HTTP requests and browser connections. */
export class PersonalAgentService {
  private readonly sessions = new Map<string, Session>();
  private readonly intents = new IntentDatabaseAdapter();
  private readonly registry = new AgentDatabaseAdapter();
  private readonly errors = new Map<string, string>();
  private readonly principals = new Map<string, ApiPrincipal>();
  private readonly desired = new Map<string, ApiPrincipal>();
  private readonly retries = new Map<string, StartupRetry>();
  private readonly pendingOwners = new Set<string | undefined>();
  private running = false;
  private checking?: Promise<void>;
  private subscriber?: ReturnType<typeof createRedisClient>;

  constructor(private readonly model: Model) {}

  /** Reconstruct active seats and follow retained events without treating transport replay as a new activation. */
  async start(): Promise<void> {
    this.running = true;
    this.subscriber = createRedisClient();
    await this.subscriber.ping();
    await this.reconcile();
    void this.follow(this.subscriber);
  }

  private async follow(reader: ReturnType<typeof createRedisClient>): Promise<void> {
    // Each API process must observe activations: a shared consumer group can
    // deliver to a process that does not own this intent's runtime. SQL receipts
    // deduplicate accepted activation IDs; the existing lease fences ownership.
    const cursors = new Map<string, string>();
    while (this.running) {
      try {
        for (const userId of await scanUserEventStreams()) {
          if (!cursors.has(userId)) cursors.set(userId, '0-0');
        }
        if (!cursors.size) {
          await sleep(STREAM_BLOCK_MS);
          continue;
        }
        const records = await readUserEvents(reader, cursors, STREAM_BLOCK_MS);
        for (const record of records) {
          if (!this.running) return;
          await this.dispatch(record);
          // Advancing delivery is not evidence that asynchronous model work completed.
          cursors.set(record.userId, record.id);
        }
      } catch (error: unknown) {
        if (!this.running) return;
        logger.error('Personal-agent stream read failed', { error: String(error) });
        await sleep(STREAM_BLOCK_MS);
      }
    }
  }

  private async dispatch(record: UserEventRecord): Promise<void> {
    let frame;
    try { frame = JSON.parse(record.data); }
    catch { return; }
    const { id, type, data } = frame;
    if (type === 'intent.created' || type === 'intent.broadcast') {
      if (typeof id !== 'string' || typeof data?.intentId !== 'string'
        || type === 'intent.broadcast' && typeof data.networkId !== 'string') return;
      // The published activation ID is persisted by accept(); a redelivery cannot
      // mint fresh authority or repeat an already accepted H2A activation.
      await this.activate(record.userId, data.intentId, type === 'intent.created' ? { id, type } : { id, type, networkId: data.networkId });
      return;
    }
    if (!['intent.lifecycle', 'intent.updated', 'agent.configuration'].includes(type)) return;
    if (type === 'intent.lifecycle' && ['PAUSED', 'ARCHIVED'].includes(data?.status)
      && this.retries.get(data.intentId)?.principal.userId === record.userId) this.cancelRetry(data.intentId);
    await this.reconcile(record.userId);
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
        for (const [id, retry] of this.retries) {
          if (ownerId !== undefined && retry.principal.userId !== ownerId) continue;
          if (JSON.stringify(this.desired.get(id)) !== JSON.stringify(retry.principal)) this.cancelRetry(id);
        }
        for (const [id, session] of this.sessions) {
          if (ownerId !== undefined && session.principal.userId !== ownerId) continue;
          if (!session.stopping && JSON.stringify(this.desired.get(id)) === JSON.stringify(session.principal)
            && !session.host.agents.get(id)?.stopped) continue;
          // Replacement waits only on this intent's runtime shutdown, never on the reconciliation loop.
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

  private async activate(userId: string, intentId: string, activation: IntentActivation): Promise<void> {
    if (!this.running) return;
    try {
      if (!await this.intents.isOwnedByUser(intentId, userId)) return;
      await this.reconcile(userId);
      const session = this.sessions.get(intentId);
      if (!session || session.principal.userId !== userId) return;
      await session.ready;
      if (!this.running || session.stopping || this.sessions.get(intentId) !== session || !session.active) return;
      await session.host.agents.get(intentId)!.activate(activation);
    } catch (error) {
      logger.error('Intent activation was not accepted; no automatic replay', { intentId, eventId: activation.id, error: String(error) });
    }
  }

  private startSession(principal: ApiPrincipal, retry?: StartupRetry): void {
    if (!this.running || this.sessions.has(principal.id)) return;
    if (this.retries.has(principal.id) && this.retries.get(principal.id) !== retry) return;
    const host = new ApiNegotiationHost([principal], this.model);
    const session: Session = { principal, host, active: false, ready: Promise.resolve() };
    this.sessions.set(principal.id, session);
    session.ready = host.start().then(() => {
      if (!this.running || session.stopping || this.sessions.get(principal.id) !== session) return;
      session.active = true;
      this.errors.delete(principal.id);
      this.cancelRetry(principal.id);
      void publishUserInvalidation(principal.userId, 'agent.status', principal.intentId);
    });
    void session.ready.catch((error: unknown) => {
      if (session.stopping || this.sessions.get(principal.id) !== session) return;
      const reason = error instanceof Error ? error.message : String(error);
      if (this.errors.get(principal.id) !== reason) logger.warn('Personal agent could not start', { intentId: principal.intentId, error: reason });
      this.errors.set(principal.id, reason);
      const retry = this.retries.get(principal.id) ?? { principal, attempts: 0 };
      this.retries.set(principal.id, retry);
      void this.stopSession(session).then(() => this.retrySession(session, retry, error), () => {});
    });
  }

  /** Retry only a failed intent after its previous host has released runtime ownership. */
  private retrySession(session: Session, retry: StartupRetry, error: unknown): void {
    const { id } = session.principal;
    if (!this.running || this.retries.get(id) !== retry) return;
    if (!this.desired.has(id) || error instanceof PrincipalRuntimeIneligibleError) {
      this.cancelRetry(id);
      if (this.desired.get(id) === session.principal) {
        this.desired.delete(id);
        this.principals.delete(id);
      }
      return;
    }
    if (retry.attempts === MAX_STARTUP_RETRIES) return;
    const delay = error instanceof PrincipalRuntimeConflict
      ? Math.max(0, error.retryAt - Date.now()) + 250
      : 1_000 * 2 ** retry.attempts;
    retry.attempts++;
    retry.timer = setTimeout(() => {
      retry.timer = undefined;
      const principal = this.desired.get(id);
      if (this.running && this.retries.get(id) === retry && principal) this.startSession(principal, retry);
    }, delay);
    retry.timer.unref();
  }

  private cancelRetry(intentId: string): void {
    clearTimeout(this.retries.get(intentId)?.timer);
    this.retries.delete(intentId);
  }

  /** Keep an intent reserved until its previous host has finished releasing runtime ownership. */
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
      PrincipalRecordsDatabaseAdapter.readConversation(userId, intentId),
    ]);
    if (!owned) throw new PersonalAgentError('Intent not found.', 404);
    if (external) return { status: 'external', pending: [] };
    const session = this.sessions.get(intentId);
    const agent = session?.host.agents.get(intentId);
    const status = session?.stopping || agent?.stopped ? 'unavailable' : session?.active ? 'running' : session ? 'starting'
      : this.principals.has(intentId) ? 'unavailable' : 'paused';
    return { status, pending: status === 'running' ? saved?.pending ?? [] : [] };
  }

  /**
   * Route principal input through the same agent inbox used by the TUI.
   * @param input - Authenticated owner, intent, canonical DM, and either a direct message or the complete answer batch.
   * @returns The atomically persisted messages, or null when the selected external executor owns the inbox.
   * @throws When ownership, availability, or the displayed batch changed.
   */
  async send(input: { userId: string; intentId: string; conversationId: string } & ({ text: string; answers?: never } | { answers: readonly PrincipalAnswer[]; text?: never })) {
    if (!await this.intents.isOwnedByUser(input.intentId, input.userId)) throw new PersonalAgentError('Intent not found.', 404);
    if (await this.registry.getSelectedNegotiator(input.userId)) return null;
    if (!this.running) throw new PersonalAgentError('Your personal agent is unavailable.', 503);
    if (!this.sessions.has(input.intentId) || this.sessions.get(input.intentId)?.host.agents.get(input.intentId)?.stopped) {
      this.cancelRetry(input.intentId);
      await this.reconcile(input.userId);
    }
    const session = this.sessions.get(input.intentId);
    if (!session || session.principal.userId !== input.userId) throw new PersonalAgentError('Your personal agent is unavailable. The intent must be active and its session must be free.', 409);
    if (session.stopping) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    try { await session.ready; }
    catch { throw new PersonalAgentError('Your personal agent could not start. Please try again.', 503); }
    if (!this.running || session.stopping || this.sessions.get(input.intentId) !== session) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    const saved = await PrincipalRecordsDatabaseAdapter.readConversation(input.userId, input.intentId);
    if (saved?.conversationId !== input.conversationId) throw new PersonalAgentError('Agent conversation not found.', 404);
    const agent = session.host.agents.get(input.intentId)!;
    if (agent.stopped) throw new PersonalAgentError('Your personal agent is restarting. Please try again.', 503);
    let receipts: readonly PrincipalMessage[] | null;
    if (input.answers) receipts = await agent.answer(input.answers);
    else {
      const message = await agent.message(input.text);
      receipts = message ? [message] : null;
    }
    if (!receipts) throw new PersonalAgentError('The input was not accepted. For answers, refresh and submit the complete current batch; nothing was sent.', 409);
    return Promise.all(receipts.map((receipt) => PrincipalRecordsDatabaseAdapter.readMessage(receipt.id)));
  }

  /** Flush every runtime and release its ownership during API shutdown. */
  async stop(): Promise<void> {
    this.running = false;
    this.subscriber?.disconnect();
    this.pendingOwners.clear();
    for (const id of this.retries.keys()) this.cancelRetry(id);
    await this.checking;
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)));
    this.sessions.clear();
  }
}
