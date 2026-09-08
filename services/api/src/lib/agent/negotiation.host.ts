import { EventEmitter } from 'node:events';

import { NegotiationAgent, type Model, type Negotiation, type NegotiationHost } from '@indexnetwork/agent';
import type { NegotiationTuiHost, TuiNegotiation, TuiPrincipal } from '@indexnetwork/agent-tui';
import { NEGOTIATION_GUIDANCE } from '@indexnetwork/protocol';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter } from '../../adapters/agent-session.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { IntentDatabaseAdapter } from '../../adapters/intent.database.adapter';
import { negotiationService, type NegotiationDetail } from '../../services/negotiation.service';
import { userEventChannel } from '../user-events';

/** Local API composition: persistence and protocol operations are injected into independent personal agents. */
export class ApiNegotiationHost extends EventEmitter implements NegotiationTuiHost {
  readonly title = 'NEGOTIATION LAB · API database';
  readonly agents = new Map<string, NegotiationAgent>();
  readonly negotiations = new Map<string, TuiNegotiation>();
  agentStatus = '';
  private subscriber?: ReturnType<typeof createRedisClient>;
  private refresh?: ReturnType<typeof setInterval>;
  private scanning?: Promise<void>;
  private rescan = false;
  private stopped = false;
  private readonly versions = new Map<string, string>();

  constructor(readonly users: readonly TuiPrincipal[], model: Model) {
    super();
    for (const principal of users) {
      const store = new AgentSessionDatabaseAdapter(principal.userId, principal.intentId);
      const read = async (id: string) => {
        const record = await negotiationService.read(id, principal.userId);
        if (!record || record.intentId !== principal.intentId) throw new Error('Negotiation is outside this principal/intent session.');
        this.observe(principal, record);
        return this.record(record);
      };
      const host: NegotiationHost = {
        status: (id, status, phase) => { const match = this.negotiations.get(id); if (match) Object.assign(match, { status, phase }); this.emit('change'); },
        conversation: () => this.emit('change'),
        retry: (_owner, attempt, reason) => { this.agentStatus = `${principal.name}: retry ${attempt} · ${reason}`; this.emit('change'); },
        step: () => { this.agentStatus = ''; },
        end: (record) => { const match = this.negotiations.get(record.opportunityId); if (match) Object.assign(match, { phase: record.settledAt ? 'settled' : 'blocked', status: record.outcome ?? record.protocol.blockedReason ?? 'Paused' }); this.emit('change'); },
        error: (id, _owner, reason) => { const match = id ? this.negotiations.get(id) : undefined; if (match) Object.assign(match, { phase: 'error', status: reason }); this.agentStatus = `${principal.name}: ${reason}`; this.emit('change'); },
      };
      this.agents.set(principal.id, new NegotiationAgent({
        owner: { id: principal.userId, name: principal.name }, intent: { id: principal.intentId, payload: principal.intent },
        principalContext: principal.principalContext, guidance: NEGOTIATION_GUIDANCE,
        client: { readNegotiation: read, submitTurn: async (id, turn) => {
          const result = await negotiationService.submitTurn(id, principal.userId, turn, store.execution);
          if ('rejection' in result) throw new Error(result.rejection);
          this.observe(principal, result);
          void this.scan();
          return this.record(result);
        } },
      }, host, { model, store }));
    }
  }

  /** @returns Existing active intents and confirmed profile context; no profile synthesis or scenario seeding. */
  static async principals(): Promise<TuiPrincipal[]> {
    return (await new IntentDatabaseAdapter().listAgentPrincipals()).map((row) => ({
      id: row.intentId, userId: row.userId, intentId: row.intentId, name: row.name, intent: row.intent,
      principalContext: row.confirmedProfile ? JSON.stringify({ confirmedProfile: row.confirmedProfile }) : 'No confirmed profile is available. Ask for missing personal facts.',
    }));
  }

  /** Restore sessions and relay existing/new match observations independently of TUI selection. @throws When a selected principal has an external negotiation executor. */
  async start(): Promise<void> {
    const registry = new AgentDatabaseAdapter();
    for (const userId of new Set(this.users.map((user) => user.userId))) {
      if ((await registry.listAgentsForUser(userId)).some((agent) => agent.ownerId === userId && agent.type === 'external' && agent.handleNegotiations)) throw new Error('A selected principal already has an external negotiation executor. Disable that binding before running its local agent.');
    }
    await Promise.all([...this.agents.values()].map((agent) => agent.start()));
    this.subscriber = createRedisClient();
    this.subscriber.on('message', (_channel, raw: string) => {
      try {
        const { type } = JSON.parse(raw);
        if (type === 'intent.lifecycle') this.versions.clear();
        else if (!['negotiation.turn', 'negotiation.settled', 'negotiation.opened'].includes(type)) return;
      } catch { return; }
      void this.scan();
    });
    this.subscriber.on('ready', () => { this.versions.clear(); void this.scan(); });
    await this.subscriber.subscribe(...[...new Set(this.users.map(({ userId }) => userEventChannel(userId)))]);
    await this.scan();
    // Pub/sub is a wake-up hint; rescan persisted rows to recover missed notifications.
    this.refresh = setInterval(() => { void this.scan(); }, 5_000);
  }

  private record(record: NegotiationDetail): Negotiation {
    return { ...record, settledAt: record.settledAt?.toISOString() ?? null };
  }

  private observe(principal: TuiPrincipal, record: NegotiationDetail): void {
    const other = this.users.find((user) => user.userId === record.counterparty.userId && user.intentId === record.counterparty.intentId)
      ?? { id: record.counterparty.intentId, userId: record.counterparty.userId, intentId: record.counterparty.intentId, name: record.counterparty.name ?? record.counterparty.userId, intent: record.counterparty.statement, principalContext: '' };
    const previous = this.negotiations.get(record.opportunityId);
    this.negotiations.set(record.opportunityId, { opportunityId: record.opportunityId, principals: [principal, other],
      transcript: record.turns.map((turn) => ({ ownerId: turn.seatUserId, text: turn.message, action: turn.action })),
      phase: previous?.phase ?? (record.settledAt ? 'settled' : 'ready'),
      status: record.outcome ?? previous?.status ?? 'Ready',
    });
    this.emit('change');
  }

  private scan(): Promise<void> {
    this.rescan = true;
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      do {
        this.rescan = false;
        if (this.stopped) return;
        await Promise.all(this.users.map(async (principal) => {
          const records = await negotiationService.list(principal.userId, { intentId: principal.intentId });
          await Promise.all(records.map(async (record) => {
            const key = `${principal.id}:${record.opportunityId}`;
            if (record.settledAt && this.versions.get(key) === record.updatedAt.toISOString()) return;
            const detail = await negotiationService.read(record.opportunityId, principal.userId);
            if (!detail || this.stopped) return;
            const version = detail.updatedAt.toISOString() + (detail.settledAt ? '' : ':' + detail.protocol.blockedReason);
            if (this.versions.get(key) === version) return;
            this.observe(principal, detail);
            this.versions.set(key, version);
            void this.agents.get(principal.id)!.receive({ kind: 'opportunity.matched', opportunityId: record.opportunityId })
              .catch((error: unknown) => { this.agentStatus = String(error); this.emit('change'); });
          }));
        }));
      } while (this.rescan && !this.stopped);
    })().catch((error: unknown) => { this.agentStatus = 'Could not refresh matches: ' + String(error); this.emit('change'); })
      .finally(() => { this.scanning = undefined; });
    return this.scanning;
  }

  /** Stop the local runtime and release its leases; conversations and matches remain in the database. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.refresh);
    await this.scanning;
    await Promise.allSettled([...this.agents.values()].map((agent) => agent.stop()));
    this.subscriber?.disconnect();
  }
}
