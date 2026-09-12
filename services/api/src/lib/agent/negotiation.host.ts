import { EventEmitter } from 'node:events';

import { NegotiationAgent, type Model, type Negotiation, type NegotiationHost } from '@indexnetwork/agent';
import { NEGOTIATION_GUIDANCE } from '@indexnetwork/protocol';

import { AgentDatabaseAdapter } from '../../adapters/agent.database.adapter';
import { AgentSessionDatabaseAdapter, AgentSessionIneligibleError } from '../../adapters/agent-session.database.adapter';
import { createRedisClient } from '../../adapters/cache.adapter';
import { IntentDatabaseAdapter } from '../../adapters/intent.database.adapter';
import { negotiationService, type NegotiationDetail } from '../../services/negotiation.service';
import { userEventChannel } from '../user-events';

const DATABASE_CONCURRENCY = 4;
let activeDatabaseOperations = 0;
const databaseQueue: (() => void)[] = [];

export interface ApiPrincipal {
  id: string; userId: string; name: string; intentId: string; intent: string; principalContext: string;
}
export interface ObservedNegotiation {
  opportunityId: string;
  principals: readonly [ApiPrincipal, ApiPrincipal];
  transcript: { ownerId: string; text: string; action: Negotiation['turns'][number]['action'] }[];
  phase: string;
  status: string;
}

/** API composition shared by the server and CLI; persistence and protocol operations are injected into independent agents. */
export class ApiNegotiationHost extends EventEmitter {
  readonly title = 'NEGOTIATION LAB · API database';
  readonly agents = new Map<string, NegotiationAgent>();
  readonly negotiations = new Map<string, ObservedNegotiation>();
  agentStatus = '';
  private subscriber?: ReturnType<typeof createRedisClient>;
  private scanning?: Promise<void>;
  private rescan = false;
  private stopped = false;
  private readonly versions = new Map<string, string>();

  constructor(readonly users: readonly ApiPrincipal[], model: Model) {
    super();
    for (const principal of users) {
      const store = new AgentSessionDatabaseAdapter(principal.userId, principal.intentId);
      const read = async (id: string) => {
        const record = await this.runDatabase(() => negotiationService.read(id, principal.userId));
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
          const result = await this.runDatabase(() => negotiationService.submitTurn(id, principal.userId, turn, store.execution));
          if ('rejection' in result) throw new Error(result.rejection);
          this.observe(principal, result);
          void this.scan();
          return this.record(result);
        } },
      }, host, { model, store }));
    }
  }

  /** @param userId - Owner whose context changed, or all owners at boot. @returns Active intents and confirmed profile context. */
  static async principals(userId?: string): Promise<ApiPrincipal[]> {
    return (await new IntentDatabaseAdapter().listAgentPrincipals(userId)).map((row) => ({
      id: row.intentId, userId: row.userId, intentId: row.intentId, name: row.name, intent: row.intent,
      principalContext: row.confirmedProfile ? JSON.stringify({ confirmedProfile: row.confirmedProfile }) : 'No confirmed profile is available. Ask for missing personal facts.',
    }));
  }

  /** Restore sessions and subscribe to background match observations independently of TUI selection. @throws When a selected principal has an external negotiation executor. */
  async start(): Promise<void> {
    const registry = new AgentDatabaseAdapter();
    for (const userId of new Set(this.users.map((user) => user.userId))) {
      if ((await registry.listAgentsForUser(userId)).some((agent) => agent.ownerId === userId && agent.type === 'external' && agent.handleNegotiations)) throw new AgentSessionIneligibleError('A selected principal already has an external negotiation executor. Disable that binding before running its local agent.');
    }
    if (this.stopped) return;
    await Promise.all([...this.agents.values()].map((agent) => agent.start()));
    if (this.stopped) return;
    this.subscriber = createRedisClient();
    this.subscriber.on('message', (_channel, raw: string) => {
      try {
        const { type, data } = JSON.parse(raw);
        if (!['negotiation.changed', 'negotiation.opened'].includes(type)) return;
        if (!this.users.some(({ intentId }) => intentId === data?.intentId)) return;
      } catch { return; }
      void this.scan();
    });
    this.subscriber.on('ready', () => { void this.scan(); });
    await this.subscriber.subscribe(...[...new Set(this.users.map(({ userId }) => userEventChannel(userId)))]);
    if (this.stopped) return;
    // Ongoing notifications can keep a scan alive indefinitely; discovery does not gate session readiness.
    void this.scan();
  }

  private record(record: NegotiationDetail): Negotiation {
    return { ...record, settledAt: record.settledAt?.toISOString() ?? null };
  }

  private observe(principal: ApiPrincipal, record: NegotiationDetail): void {
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

  /** Share capacity across hosts for one database operation, never a scan or agent task that may enqueue more work. */
  private async runDatabase<T>(operation: () => Promise<T>): Promise<T> {
    if (activeDatabaseOperations === DATABASE_CONCURRENCY) {
      await new Promise<void>((resolve) => databaseQueue.push(resolve));
    } else {
      activeDatabaseOperations++;
    }
    try {
      if (this.stopped) throw new Error('Negotiation host is stopped.');
      return await operation();
    } finally {
      // Transfer the slot directly to the oldest waiter so new work cannot jump the queue.
      const next = databaseQueue.shift();
      if (next) next();
      else activeDatabaseOperations--;
    }
  }

  private scan(): Promise<void> {
    this.rescan = true;
    if (this.scanning) return this.scanning;
    this.scanning = (async () => {
      do {
        this.rescan = false;
        if (this.stopped) return;
        for (const principal of this.users) {
          const records = await this.runDatabase(() => negotiationService.scan(principal.userId, principal.intentId));
          for (const record of records) {
            const key = `${principal.id}:${record.opportunityId}`;
            const version = `${record.version}:${record.eligible}`;
            if (this.versions.get(key) === version) continue;
            const detail = await this.runDatabase(() => negotiationService.read(record.opportunityId, principal.userId));
            if (this.stopped) return;
            if (!detail) continue;
            this.observe(principal, detail);
            this.versions.set(key, version);
            void this.agents.get(principal.id)!.receive({ kind: 'opportunity.matched', opportunityId: record.opportunityId })
              .catch((error: unknown) => { this.agentStatus = String(error); this.emit('change'); });
          }
        }
      } while (this.rescan && !this.stopped);
    })().catch((error: unknown) => { if (!this.stopped) { this.agentStatus = 'Could not refresh matches: ' + String(error); this.emit('change'); } })
      .finally(() => { this.scanning = undefined; });
    return this.scanning;
  }

  /** Stop the local runtime and release its leases; conversations and matches remain in the database. */
  async stop(): Promise<void> {
    this.stopped = true;
    await Promise.allSettled([this.scanning, ...[...this.agents.values()].map((agent) => agent.stop())]);
    this.subscriber?.disconnect();
  }
}
