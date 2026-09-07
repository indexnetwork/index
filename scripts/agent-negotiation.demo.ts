import { EventEmitter } from 'node:events';

import { NegotiationAgent, type NegotiationAction as Action, type Negotiation, type NegotiationClient, type NegotiationHost, type NegotiationTurn as TurnInput } from '@indexnetwork/agent';

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
  channel: 'private' | 'shared';
  ownerId: string;
  kind: 'question' | 'answer' | 'message' | 'turn';
  text: string;
  action?: Action;
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

/** A disposable negotiation record and UI observer; the agent library owns execution. */
export class NegotiationDemo extends EventEmitter {
  readonly transcript: TranscriptEntry[] = [];
  phase: 'ready' | 'running' | 'question' | 'settled' | 'error' | 'stopped' = 'ready';
  status = 'Ready';
  pending: { ownerId: string; question: string; options?: string[] } | null = null;
  private readonly controller = new AbortController();
  private answerReady: ((answer: string | null) => void) | undefined;
  private readonly turns: Negotiation['turns'] = [];
  private awaitingUserId: string | null;
  private outcome: string | null = null;
  private settledAt: string | null = null;

  constructor(readonly principals: readonly [DemoPrincipal, DemoPrincipal], readonly opportunityId: string) {
    super();
    this.awaitingUserId = principals[0].id;
  }

  private update(status: string): void {
    this.status = status;
    this.emit('change');
  }

  private progress(status: string): void {
    if (this.pending || this.phase === 'settled' || this.phase === 'error' || this.phase === 'stopped') return;
    this.phase = 'running';
    this.update(status);
  }

  private append(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.emit('change');
  }

  private read(ownerId: string): Negotiation {
    const other = this.principals.find((principal) => principal.id !== ownerId)!;
    return structuredClone({
      opportunityId: this.opportunityId,
      intentId: `intent-${ownerId}`,
      awaitingUserId: this.awaitingUserId,
      outcome: this.outcome,
      settledAt: this.settledAt,
      turnCount: this.turns.length,
      counterparty: { userId: other.id, name: other.name, statement: other.intent },
      turns: this.turns,
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
        this.controller.signal.throwIfAborted();
        if (this.settledAt) throw new Error('This negotiation is already settled.');
        if (this.awaitingUserId !== ownerId) throw new Error('It is not your turn.');
        if (turn.action === 'propose' && this.turns.length !== 0) throw new Error('propose is only valid as the opening turn.');
        if (turn.action === 'counter' && this.turns.length === 0) throw new Error('counter needs a standing offer.');
        if (turn.action === 'accept' && (!this.turns.length || this.turns.at(-1)!.seatUserId === ownerId)) throw new Error('accept needs an offer from the other principal.');
        this.turns.push({ turnIndex: this.turns.length, seatUserId: ownerId, ...turn });
        if (turn.action === 'accept' || turn.action === 'decline') {
          this.outcome = turn.action === 'accept' ? 'agreed' : 'declined';
          this.settledAt = new Date().toISOString();
          this.awaitingUserId = null;
        } else {
          this.awaitingUserId = this.principals.find((principal) => principal.id !== ownerId)!.id;
        }
        return this.read(ownerId);
      },
    };
  }

  /** @returns Per-match observers and a human reply channel for the library runtime. */
  get host(): NegotiationHost {
    return {
      status: (message) => this.progress(message),
      turn: (owner, input) => {
        this.append({ channel: 'shared', ownerId: owner.id, kind: 'turn', text: input.message, action: input.action });
        this.emit('negotiation.updated');
      },
      retry: (owner, attempt, reason) => this.progress(`${owner.name}: model retry ${attempt} — ${reason}`),
      step: (owner, step) => {
        if (step.kind === 'tool') this.progress(`${owner.name}: ${step.name} ${step.error ? `— ${step.error}` : 'completed'}`);
      },
      ask: (owner, question) => {
        if (this.controller.signal.aborted) return Promise.resolve(null);
        this.phase = 'question';
        this.pending = { ownerId: owner.id, ...question };
        this.status = `Needs ${owner.name}'s answer`;
        const waiting = new Promise<string | null>((resolve) => { this.answerReady = resolve; });
        this.append({
          channel: 'private', ownerId: owner.id, kind: 'question',
          text: question.question + (question.options?.length ? '\n\n' + question.options.map((option) => `• ${option}`).join('\n') : ''),
        });
        return waiting;
      },
      output: (owner, result) => {
        if (result.output.trim()) this.append({ channel: 'private', ownerId: owner.id, kind: 'message', text: result.output });
      },
      end: (record) => {
        if (this.phase === 'error') return;
        this.phase = record.settledAt ? 'settled' : 'stopped';
        this.update(`${record.outcome ?? 'Stopped without settlement'} · ${record.turnCount} A2A turns`);
      },
      error: (_owner, reason) => {
        if (this.phase === 'error') return;
        this.phase = 'error';
        this.update(reason);
        this.stop();
      },
    };
  }

  /**
   * Deliver a human reply only to the principal whose question is pending.
   * @param ownerId - The side the operator is acting as.
   * @param text - That principal's answer; never a public negotiation turn.
   * @returns Whether the answer was accepted. Rejects empty, wrong-side, and duplicate replies.
   */
  answer(ownerId: string, text: string): boolean {
    if (this.pending?.ownerId !== ownerId || !this.answerReady || !text.trim()) return false;
    const resolve = this.answerReady;
    this.answerReady = undefined;
    this.pending = null;
    this.phase = 'running';
    this.status = `Resuming ${this.principals.find((principal) => principal.id === ownerId)!.name}'s agent…`;
    this.append({ channel: 'private', ownerId, kind: 'answer', text: text.trim() });
    resolve(text.trim());
    return true;
  }

  /** Cancel outstanding model work and release an unanswered question when the TUI closes. */
  stop(): void {
    this.controller.abort();
    this.answerReady?.(null);
    this.answerReady = undefined;
    this.pending = null;
    if (this.phase !== 'settled' && this.phase !== 'error') {
      this.phase = 'stopped';
      this.update('Stopped by operator');
    }
  }

  /** @returns The chronological transcript of both private conversations and shared turns. */
  markdown(): string {
    const names = new Map(this.principals.map((principal) => [principal.id, principal.name]));
    const entries = this.transcript.map((entry, index) => {
      const name = names.get(entry.ownerId);
      const label = entry.channel === 'shared'
        ? `A2A · ${name}'s agent · ${entry.action}`
        : entry.kind === 'answer' ? `H2A · ${name} → their agent` : `A2H · ${name}'s agent → ${name} · ${entry.kind}`;
      return `## ${index + 1}. ${label}\n\n${entry.text}`;
    });
    return `# ${this.principals.map(({ name }) => name).join(' ↔ ')}\n\n${entries.join('\n\n')}\n\n## Status\n\n${this.status}\n`;
  }
}

/** A post-match simulation with one parallel negotiation for every distinct user pair. */
export class NegotiationLab extends EventEmitter {
  readonly users: DemoPrincipal[];
  readonly negotiations = new Map<string, NegotiationDemo>();
  readonly agents = new Map<string, NegotiationAgent>();
  private selection: [DemoPrincipal, DemoPrincipal];

  constructor(scenario: DemoScenario) {
    super();
    this.users = scenario.users;
    this.selection = [this.users[0], this.users[1]];
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
      const clientFor = (id: string) => this.negotiations.get(id)!.client(user.id);
      this.agents.set(user.id, new NegotiationAgent({
        owner: { id: user.id, name: user.name }, instructions: user.instructions,
        client: {
          readNegotiation: (id) => clientFor(id).readNegotiation(id),
          submitTurn: (id, turn) => clientFor(id).submitTurn(id, turn),
        },
      }, (id) => this.negotiations.get(id)!.host));
    }
  }

  /** @returns The users displayed on the left and right, in that order. */
  get selectedUsers(): readonly [DemoPrincipal, DemoPrincipal] { return this.selection; }

  /** @returns The selected pair's existing session without changing its execution. */
  get active(): NegotiationDemo {
    const id = `local:${this.selection.map(({ id }) => id).sort().map(encodeURIComponent).join(':')}`;
    return this.negotiations.get(id)!;
  }

  /** Deliver simulated matches to the always-on agents, which own their negotiation lifecycles. */
  matchAll(): void {
    for (const demo of this.negotiations.values()) {
      for (const principal of demo.principals) {
        void this.agents.get(principal.id)!.receive({
          kind: 'opportunity.matched', opportunityId: demo.opportunityId,
          intent: { id: `intent-${principal.id}`, payload: principal.intent },
        });
      }
    }
  }

  /**
   * Change the displayed user without starting or restarting any negotiation.
   * @param side - The left or right user selector.
   * @param userId - A user in this scenario, distinct from the opposite side.
   * @throws When the user is unknown or already selected on the opposite side.
   */
  selectUser(side: 'left' | 'right', userId: string): void {
    const user = this.users.find(({ id }) => id === userId);
    if (!user) throw new Error(`Unknown user: ${userId}`);
    const index = side === 'left' ? 0 : 1;
    if (this.selection[1 - index].id === userId) throw new Error('Select two different users.');
    this.selection[index] = user;
    this.emit('change');
  }

  /** Cancel every pair, release pending questions, and await outstanding model work. */
  async stop(): Promise<void> {
    for (const demo of this.negotiations.values()) demo.stop();
    await Promise.all([...this.agents.values()].map((agent) => agent.stop()));
  }

  /** @returns Every pair's shared turns and private conversations, grouped by pair. */
  markdown(): string {
    return '# Local negotiation lab transcript\n\nReal agents, simulated negotiations. Includes all pairs’ private conversations. No live Index records changed.\n\n'
      + [...this.negotiations.values()].map((demo) => demo.markdown()).join('\n---\n\n');
  }
}
