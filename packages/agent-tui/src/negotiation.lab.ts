import { EventEmitter } from 'node:events';

import { MemoryPrincipalStore, NegotiationAgent, type Model, type NegotiationAction as Action, type Negotiation, type NegotiationClient, type NegotiationHost, type NegotiationTurn as TurnInput } from '@indexnetwork/agent';

import { NEGOTIATION_GUIDANCE, Negotiations, decideNegotiationOpening, type NegotiationState } from '@indexnetwork/protocol';

import type { TuiPrincipal } from './negotiation.tui';

export interface DemoPrincipal {
  id: string;
  name: string;
  intent: string;
  instructions: string;
}

export interface DemoScenario {
  users: DemoPrincipal[];
}

export interface TranscriptEntry {
  ownerId: string;
  text: string;
  action: Action;
}

/**
 * Validate a user-editable local scenario before starting model work.
 * @param value - Parsed JSON containing the selectable user roster.
 * @returns Users with stable IDs, names, intents, and private instructions.
 * @throws When fewer than two users are supplied, a field is empty, or IDs repeat.
 */
export function parseScenario(value: unknown): DemoScenario {
  const users = value && typeof value === 'object' ? (value as Record<string, unknown>).users : undefined;
  if (!Array.isArray(users) || users.length < 2) throw new Error('Scenario.users must contain at least two users.');
  const ids = new Set<string>();
  return { users: users.map((raw: unknown, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Scenario.users[${index}] must contain id, name, intent, and instructions.`);
    const principal = {} as DemoPrincipal;
    for (const field of ['id', 'name', 'intent', 'instructions'] as const) {
      const text = (raw as Record<string, unknown>)[field];
      if (typeof text !== 'string' || !text.trim()) throw new Error(`Scenario.users[${index}].${field} must be a nonempty string.`);
      principal[field] = text.trim();
    }
    if (ids.has(principal.id)) throw new Error(`Duplicate user ID: ${principal.id}`);
    ids.add(principal.id);
    return principal;
  }) };
}

/** A disposable A2A record. Principal conversations belong to the agent runtimes. */
export class NegotiationDemo extends EventEmitter {
  readonly transcript: TranscriptEntry[] = [];
  phase: 'ready' | 'running' | 'question' | 'settled' | 'error' | 'stopped' = 'ready';
  status = 'Ready';
  private readonly controller = new AbortController();
  private readonly turns: Negotiation['turns'] = [];
  private awaitingUserId: string | null;
  private outcome: string | null = null;
  private settledAt: string | null = null;

  constructor(readonly principals: readonly [TuiPrincipal, TuiPrincipal], readonly opportunityId: string) {
    super();
    const decision = decideNegotiationOpening({ userA: principals[0].userId, userB: principals[1].userId, intentA: principals[0].intentId, intentB: principals[1].intentId, eligible: true });
    if (!decision) throw new Error('This pair is not eligible to negotiate.');
    this.awaitingUserId = decision.awaitingUserId;
  }

  /** @param status - The library's progress for this match. @param phase - Whether it is running or awaiting its principal. */
  progress(status: string, phase?: 'running' | 'question'): void {
    if (this.phase === 'settled' || this.phase === 'error' || this.phase === 'stopped' || (this.phase === 'question' && !phase)) return;
    this.phase = phase ?? 'running';
    this.status = status;
    this.emit('change');
  }

  private async read(ownerId: string): Promise<Negotiation> {
    const other = this.principals.find((principal) => principal.userId !== ownerId)!;
    return structuredClone({
      opportunityId: this.opportunityId,
      intentId: this.principals.find((principal) => principal.userId === ownerId)!.intentId,
      awaitingUserId: this.awaitingUserId,
      outcome: this.outcome,
      settledAt: this.settledAt,
      turnCount: this.turns.length,
      protocol: (await this.protocol().observe(this.opportunityId, ownerId))!,
      counterparty: { userId: other.userId, name: other.name, statement: other.intent },
      turns: this.turns,
    });
  }

  private state(): NegotiationState {
    return { initiatorUserId: this.principals[0].userId, responderUserId: this.principals[1].userId,
      awaitingUserId: this.awaitingUserId, outcome: this.outcome as NegotiationState['outcome'],
      settled: this.settledAt !== null, eligible: true, turns: this.turns };
  }

  private protocol(): Negotiations {
    return new Negotiations({
      readNegotiationState: async () => this.state(),
      commitNegotiationTurn: async (_id, ownerId, turn, decide) => {
        this.controller.signal.throwIfAborted();
        const decision = decide(this.state());
        if (!decision.ok) return decision;
        this.turns.push({ turnIndex: decision.turnIndex, seatUserId: ownerId, action: turn.action, message: turn.message });
        this.outcome = decision.outcome;
        this.settledAt = decision.outcome ? new Date().toISOString() : null;
        this.awaitingUserId = decision.awaitingUserId;
        this.transcript.push({ ownerId, text: turn.message, action: turn.action });
        this.emit('change');
        this.emit('negotiation.updated');
        return decision;
      },
    });
  }

  /**
   * Bind the in-memory transport to one of this match's principals.
   * @param ownerId - The user whose agent reads and submits turns.
   * @returns Tools' transport with authoritative turn order and settlement checks.
   */
  client(ownerId: string): NegotiationClient {
    return {
      readNegotiation: async () => this.read(ownerId),
      submitTurn: async (_id: string, turn: TurnInput) => {
        const decision = await this.protocol().execute(this.opportunityId, ownerId, turn);
        if (!decision.ok) throw new Error(decision.rejection);
        const record = await this.read(ownerId);
        return record;
      },
    };
  }

  /** @param record - The final authoritative state observed by an agent. */
  end(record: Negotiation): void {
    if (this.phase === 'error') return;
    this.phase = record.settledAt ? 'settled' : 'stopped';
    this.status = (record.outcome ?? record.protocol.blockedReason ?? 'Stopped without settlement') + ' · ' + record.turnCount + ' A2A turns';
    this.emit('change');
  }

  /** @param reason - Why this match stopped. */
  error(reason: string): void {
    this.phase = 'error';
    this.status = reason;
    this.stop();
  }

  /** Stop writes to this match when the lab closes. */
  stop(): void {
    this.controller.abort();
    if (this.phase !== 'settled' && this.phase !== 'error') {
      this.phase = 'stopped';
      this.status = 'Stopped by operator';
    }
    this.emit('change');
  }

  /** @returns Only this match's public A2A turns. */
  markdown(): string {
    const names = new Map(this.principals.map((principal) => [principal.userId, principal.name]));
    return '# A2A · ' + this.principals.map(({ name }) => name).join(' ↔ ') + '\n\n'
      + this.transcript.map((entry, index) => '## ' + (index + 1) + '. ' + names.get(entry.ownerId) + ' · ' + entry.action + '\n\n' + entry.text).join('\n\n')
      + '\n\n## Status\n\n' + this.status + '\n';
  }
}

/** One H2A conversation per user/intent, with one parallel A2A record per match. */
export class NegotiationLab extends EventEmitter {
  readonly title = 'NEGOTIATION LAB · local simulation';
  readonly users: TuiPrincipal[];
  readonly negotiations = new Map<string, NegotiationDemo>();
  readonly agents = new Map<string, NegotiationAgent>();
  agentStatus = '';

  constructor(scenario: DemoScenario, options: { model: Model }) {
    super();
    this.users = scenario.users.map((user) => ({ id: 'intent-' + user.id, userId: user.id, name: user.name, intentId: 'intent-' + user.id, intent: user.intent, principalContext: user.instructions }));
    for (let index = 0; index < this.users.length; index++) {
      for (const other of this.users.slice(index + 1)) {
        const principals = [this.users[index], other] as const;
        const id = `local:${principals.map(({ id }) => id).sort().map(encodeURIComponent).join(':')}`;
        const demo = new NegotiationDemo(principals, id);
        demo.on('change', () => this.emit('change'));
        demo.on('negotiation.updated', () => {
          for (const principal of principals) void this.agents.get(principal.id)!.receive({ kind: 'negotiation.updated', opportunityId: id });
        });
        this.negotiations.set(id, demo);
      }
    }
    for (const user of this.users) {
      const clientFor = (id: string) => this.negotiations.get(id)!.client(user.userId);
      const host: NegotiationHost = {
        status: (id, message, phase) => this.negotiations.get(id)!.progress(message, phase),
        retry: (owner, attempt, reason) => {
          this.agentStatus = (owner.name ?? owner.id) + ': model retry ' + attempt + ' · ' + reason;
          this.emit('change');
        },
        step: (id, _owner, step) => {
          this.agentStatus = '';
          if (step.kind === 'tool') this.negotiations.get(id)!.progress(step.name + ' ' + (step.error ?? 'completed'));
        },
        conversation: () => this.emit('change'),
        end: (record) => this.negotiations.get(record.opportunityId)!.end(record),
        error: (id, owner, reason) => {
          const affected = id === null
            ? [...this.negotiations.values()].filter((demo) => demo.phase !== 'settled' && demo.principals.some((principal) => principal.userId === owner.id))
            : [this.negotiations.get(id)!];
          for (const demo of affected) {
            demo.error(reason);
            for (const principal of demo.principals) void this.agents.get(principal.id)!.stop(demo.opportunityId);
          }
          if (id === null) { this.agentStatus = (owner.name ?? owner.id) + ': ' + reason; this.emit('change'); }
        },
      };
      this.agents.set(user.id, new NegotiationAgent({
        owner: { id: user.userId, name: user.name },
        intent: { id: user.intentId, payload: user.intent },
        principalContext: user.principalContext,
        guidance: NEGOTIATION_GUIDANCE,
        client: {
          readNegotiation: (id) => clientFor(id).readNegotiation(id),
          submitTurn: (id, turn) => clientFor(id).submitTurn(id, turn),
        },
      }, host, { ...options, store: new MemoryPrincipalStore() }));
    }
  }

  /** Deliver simulated matches to the always-on agents, which own their negotiation lifecycles. */
  matchAll(): void {
    for (const demo of this.negotiations.values()) {
      for (const principal of demo.principals) {
        void this.agents.get(principal.id)!.receive({ kind: 'opportunity.matched', opportunityId: demo.opportunityId });
      }
    }
  }

  /** Cancel model work, release human questions, and stop all match records. */
  async stop(): Promise<void> {
    await Promise.all([...this.agents.values()].map((agent) => agent.stop()));
    for (const demo of this.negotiations.values()) demo.stop();
  }

  /** @returns Each H2A conversation once, followed by the separate A2A match transcripts. */
  markdown(): string {
    const human = this.users.map((user) => {
      const entries = this.agents.get(user.id)!.conversation.map((entry, index) =>
        '## ' + (index + 1) + '. ' + (entry.kind === 'answer' || entry.kind === 'user' ? user.name : "Your agent") + ' · ' + entry.kind
        + (entry.scope === 'intent' ? ' · This intent' : entry.matches.length ? ' · ' + entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ') : '') + '\n\n' + entry.text
        + (entry.options ? '\n\n' + entry.options.map((option) => '- ' + option).join('\n') : ''),
      );
      return '# H2A · ' + user.name + '\n\nIntent: ' + user.intent + '\n\n' + entries.join('\n\n');
    });
    return '# Local negotiation lab transcript\n\nIncludes private principal conversations. No live Index records changed.\n\n'
      + [...human, ...[...this.negotiations.values()].map((demo) => demo.markdown())].join('\n\n---\n\n');
  }
}
