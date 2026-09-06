import { EventEmitter } from 'node:events';

import { createSeat, runNegotiation, type Action, type Negotiation, type NegotiationClient, type NegotiationHost, type TurnInput } from './agent-negotiation.session';

export interface DemoPrincipal {
  name: string;
  intent: string;
  instructions: string;
}

export interface DemoScenario {
  left: DemoPrincipal;
  right: DemoPrincipal;
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
 * @param value - Parsed JSON, with one principal per side.
 * @returns The two principals' names, intents, and private instructions.
 * @throws When either principal is missing a nonempty field.
 */
export function parseScenario(value: unknown): DemoScenario {
  if (!value || typeof value !== 'object') throw new Error('Scenario must contain left and right principals.');
  const principals = {} as DemoScenario;
  for (const side of ['left', 'right'] as const) {
    const raw = (value as Record<string, unknown>)[side];
    if (!raw || typeof raw !== 'object') throw new Error(`Scenario.${side} must contain name, intent, and instructions.`);
    const principal = {} as DemoPrincipal;
    for (const field of ['name', 'intent', 'instructions'] as const) {
      const text = (raw as Record<string, unknown>)[field];
      if (typeof text !== 'string' || !text.trim()) throw new Error(`Scenario.${side}.${field} must be a nonempty string.`);
      principal[field] = text.trim();
    }
    principals[side] = principal;
  }
  return principals;
}

const OPPORTUNITY_ID = 'local-negotiation';

/** A disposable host: real personal agents, private Q&A, and an in-memory turn log. */
export class NegotiationDemo extends EventEmitter {
  readonly principals: (DemoPrincipal & { id: string })[];
  readonly transcript: TranscriptEntry[] = [];
  phase: 'ready' | 'running' | 'question' | 'settled' | 'error' | 'stopped' = 'ready';
  status = 'Ready';
  pending: { ownerId: string; question: string; options?: string[] } | null = null;
  private readonly controller = new AbortController();
  private answerReady: ((answer: string | null) => void) | undefined;
  private readonly turns: Negotiation['turns'] = [];
  private awaitingUserId: string | null = 'user-1';
  private outcome: string | null = null;
  private settledAt: string | null = null;

  constructor(scenario: DemoScenario) {
    super();
    this.principals = [{ ...scenario.left, id: 'user-1' }, { ...scenario.right, id: 'user-2' }];
  }

  private update(status: string): void {
    this.status = status;
    this.emit('change');
  }

  private append(entry: TranscriptEntry): void {
    this.transcript.push(entry);
    this.emit('change');
  }

  private read(ownerId: string): Negotiation {
    const other = this.principals.find((principal) => principal.id !== ownerId)!;
    return structuredClone({
      opportunityId: OPPORTUNITY_ID,
      intentId: `intent-${ownerId}`,
      awaitingUserId: this.awaitingUserId,
      outcome: this.outcome,
      settledAt: this.settledAt,
      turnCount: this.turns.length,
      counterparty: { userId: other.id, name: other.name, statement: other.intent },
      turns: this.turns,
    });
  }

  private client(ownerId: string): NegotiationClient {
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

  /**
   * Run until settlement, failure, or cancellation; principal questions await answer().
   * @returns When the session ends. Failures remain visible in phase/status.
   */
  async run(): Promise<void> {
    if (this.phase !== 'ready') throw new Error('Start a new demo to run another scenario.');
    this.phase = 'running';
    const host: NegotiationHost = {
      status: (message) => { this.phase = 'running'; this.update(message); },
      turn: (owner, input) => this.append({ channel: 'shared', ownerId: owner.id, kind: 'turn', text: input.message, action: input.action }),
      retry: (owner, attempt, reason) => this.update(`${owner.name}: model retry ${attempt} — ${reason}`),
      step: (owner, step) => {
        if (step.kind === 'tool') this.update(`${owner.name}: ${step.name} ${step.error ? `— ${step.error}` : 'completed'}`);
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
    };
    try {
      const seats = this.principals.map((principal) => createSeat({
        owner: { id: principal.id, name: principal.name },
        intent: { id: `intent-${principal.id}`, payload: principal.intent },
        instructions: principal.instructions,
        client: this.client(principal.id),
      }, OPPORTUNITY_ID, host));
      const record = await runNegotiation(seats, OPPORTUNITY_ID, host, this.controller.signal);
      if (this.controller.signal.aborted) return;
      this.phase = record.settledAt ? 'settled' : 'stopped';
      this.update(`${record.outcome ?? 'Stopped without settlement'} · ${record.turnCount} A2A turns`);
    } catch (error) {
      if (this.controller.signal.aborted) return;
      this.phase = 'error';
      this.update(error instanceof Error ? error.message : String(error));
    }
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
    return `# Local negotiation transcript\n\nReal agents, simulated negotiation. Includes both principals' private conversations. No live Index records changed.\n\n${entries.join('\n\n')}\n\n## Status\n\n${this.status}\n`;
  }
}
