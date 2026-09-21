import { EventEmitter } from 'node:events';

import { AgentRunner, type AgentHost, type AgentRunnerOptions, type Intent, type NegotiationAction as Action, type NegotiationDetail } from '@indexnetwork/agent';
import { decideNegotiationOpening, decideNegotiationTurn, observeNegotiation, type NegotiationState } from '@indexnetwork/protocol';

import { ConversationStore } from './conversation.store.js';
import type { NegotiationTuiHost, TuiMessage, TuiPrincipal } from './negotiation.tui.js';
import { ReasoningObserver } from './reasoning.observer.js';

export interface DemoPrincipal {
  id: string;
  name: string;
  intents: { id: string; intent: string }[];
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
 * @returns Users with stable IDs, names, and intents.
 * @throws When fewer than two users are supplied, a user has no intents, a field is empty, or IDs repeat within a roster.
 */
export function parseScenario(value: unknown): DemoScenario {
  const users = value && typeof value === 'object' ? (value as Record<string, unknown>).users : undefined;
  if (!Array.isArray(users) || users.length < 2) throw new Error('Scenario.users must contain at least two users.');
  const ids = new Set<string>();
  return { users: users.map((raw: unknown, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`Scenario.users[${index}] must contain id, name, and intents.`);
    const principal = {} as DemoPrincipal;
    for (const field of ['id', 'name'] as const) {
      const text = (raw as Record<string, unknown>)[field];
      if (typeof text !== 'string' || !text.trim()) throw new Error(`Scenario.users[${index}].${field} must be a nonempty string.`);
      principal[field] = text.trim();
    }
    if (ids.has(principal.id)) throw new Error(`Duplicate user ID: ${principal.id}`);
    ids.add(principal.id);
    const intents = (raw as Record<string, unknown>).intents;
    if (!Array.isArray(intents) || !intents.length) throw new Error(`Scenario.users[${index}].intents must contain at least one intent.`);
    const intentIds = new Set<string>();
    principal.intents = intents.map((rawIntent: unknown, intentIndex) => {
      const path = `Scenario.users[${index}].intents[${intentIndex}]`;
      if (!rawIntent || typeof rawIntent !== 'object') throw new Error(`${path} must contain id and intent.`);
      const intent = {} as DemoPrincipal['intents'][number];
      for (const field of ['id', 'intent'] as const) {
        const text = (rawIntent as Record<string, unknown>)[field];
        if (typeof text !== 'string' || !text.trim()) throw new Error(`${path}.${field} must be a nonempty string.`);
        intent[field] = text.trim();
      }
      if (intentIds.has(intent.id)) throw new Error(`Duplicate intent ID for ${principal.id}: ${intent.id}`);
      intentIds.add(intent.id);
      return intent;
    });
    return principal;
  }) };
}

function relevance(query: string, statement: string): number {
  const words = (text: string) => new Set(text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const queryWords = words(query);
  const statementWords = words(statement);
  if (!queryWords.size || !statementWords.size) return 0;
  let shared = 0;
  for (const word of queryWords) if (statementWords.has(word)) shared++;
  return shared / Math.sqrt(queryWords.size * statementWords.size);
}

/** A disposable host-owned A2A record, committed synchronously under the protocol rules. */
export class NegotiationDemo extends EventEmitter {
  readonly transcript: TranscriptEntry[] = [];
  phase: 'ready' | 'running' | 'question' | 'held' | 'settled' | 'blocked' | 'error' | 'stopped' = 'ready';
  status = 'Ready';
  private stopped = false;
  private readonly turns: NegotiationDetail['turns'] = [];
  private readonly createdAt = new Date().toISOString();
  private updatedAt = this.createdAt;
  private awaitingUserId: string | null;
  private outcome: NegotiationDetail['outcome'] = null;
  private settledAt: string | null = null;

  constructor(readonly principals: readonly [TuiPrincipal, TuiPrincipal], readonly opportunityId: string) {
    super();
    const decision = decideNegotiationOpening({ userA: principals[0].userId, userB: principals[1].userId, intentA: principals[0].intentId, intentB: principals[1].intentId, eligible: true });
    if (!decision) throw new Error('This pair is not eligible to negotiate.');
    this.awaitingUserId = decision.awaitingUserId;
  }

  /** @param status - Current work for this match. @param phase - Whether it is running, awaiting input, or held by an instruction. */
  progress(status: string, phase: 'running' | 'question' | 'held'): void {
    if (this.phase === 'settled' || this.phase === 'blocked' || this.phase === 'error' || this.phase === 'stopped') return;
    this.phase = phase;
    this.status = status;
    this.emit('change');
  }

  /**
   * @param ownerId - The principal reading its seat.
   * @returns A fresh authoritative snapshot and the actions available to that seat.
   * @throws If the principal does not participate in this negotiation.
   */
  read(ownerId: string): NegotiationDetail {
    const principal = this.principals.find((entry) => entry.userId === ownerId);
    if (!principal) throw new Error('Negotiation is outside this principal.');
    const other = this.principals.find((entry) => entry.userId !== ownerId)!;
    const protocol = observeNegotiation(this.state(), ownerId);
    return structuredClone({
      id: this.opportunityId,
      opportunityId: this.opportunityId,
      intentId: principal.intentId,
      awaitingUserId: this.awaitingUserId,
      outcome: this.outcome,
      settledAt: this.settledAt,
      turnCount: this.turns.length,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      protocol: {
        ...protocol,
        availableActions: this.stopped ? [] : protocol.availableActions.filter((action) => action !== 'accept' || ownerId === this.principals[1].userId),
        blockedReason: this.stopped ? this.phase === 'error' ? 'host_error' : 'stopped' : protocol.blockedReason,
      },
      counterparty: { intentId: other.intentId, userId: other.userId, name: other.name, avatar: null, statement: other.intent },
      turns: this.turns,
    });
  }

  private state(): NegotiationState {
    return { initiatorUserId: this.principals[0].userId, responderUserId: this.principals[1].userId,
      awaitingUserId: this.awaitingUserId, outcome: this.outcome,
      settled: this.settledAt !== null, eligible: true, turns: this.turns };
  }

  /**
   * @param ownerId - The principal submitting its next turn.
   * @param turn - The action and the turn count used to produce it.
   * @returns The committed negotiation, after notifying the other runner.
   * @throws If stopped, unauthorized, stale, or rejected by the protocol or fixed initiator role.
   */
  submitTurn(ownerId: string, turn: Parameters<AgentHost['submitTurn']>[1]): NegotiationDetail {
    if (this.stopped) throw new Error('Negotiation has stopped.');
    // The rewritten agent keeps the original initiator from accepting, even after a counteroffer.
    if (ownerId === this.principals[0].userId && turn.action === 'accept') throw new Error('Only the original responder can accept.');
    const decision = decideNegotiationTurn(this.state(), ownerId, turn);
    if (!decision.ok) throw new Error(decision.rejection);
    this.updatedAt = new Date().toISOString();
    this.turns.push({ turnIndex: decision.turnIndex, seatUserId: ownerId, action: turn.action, message: turn.message, createdAt: this.updatedAt });
    this.outcome = decision.outcome;
    this.settledAt = decision.outcome ? this.updatedAt : null;
    this.awaitingUserId = decision.awaitingUserId;
    this.transcript.push({ ownerId, text: turn.message, action: turn.action });
    this.phase = decision.outcome ? 'settled' : decision.blockedReason ? 'blocked' : 'running';
    this.status = (decision.outcome ?? decision.blockedReason ?? 'Awaiting ' + this.principals.find(({ userId }) => userId === this.awaitingUserId)!.name)
      + ' · ' + this.turns.length + ' A2A turns';
    this.emit('change');
    this.emit('negotiation.turn');
    return this.read(ownerId);
  }

  /** @param reason - Why this match stopped. */
  error(reason: string): void {
    this.phase = 'error';
    this.status = reason;
    this.stopped = true;
    this.emit('change');
  }

  /** Stop writes to this match when the lab closes, retaining terminal outcomes. */
  stop(): void {
    this.stopped = true;
    if (this.phase !== 'settled' && this.phase !== 'blocked' && this.phase !== 'error') {
      this.phase = 'stopped';
      this.status = 'Stopped by operator';
    }
    this.emit('change');
  }

  /** @returns Only this match's public A2A turns. */
  markdown(): string {
    const agents = new Map(this.principals.map((principal) => [principal.userId, principal.name + "'s agent"]));
    return '# A2A · ' + this.principals.map(({ name }) => name).join(' ↔ ') + '\n\n'
      + this.transcript.map((entry, index) => '## ' + (index + 1) + '. ' + agents.get(entry.ownerId) + ' · ' + entry.action + '\n\n' + entry.text).join('\n\n')
      + '\n\n## Status\n\n' + this.status + '\n';
  }
}

/** One runner per user, with host-owned H2A conversations per intent and A2A records per match. */
export class NegotiationLab extends EventEmitter implements NegotiationTuiHost {
  readonly title = 'NEGOTIATION LAB · local simulation';
  readonly users: TuiPrincipal[];
  readonly negotiations = new Map<string, NegotiationDemo>();
  readonly conversations = new Map<string, ConversationStore>();
  readonly activities = new Map<string, ReasoningObserver>();
  agentStatus = '';
  private readonly runners = new Map<string, AgentRunner>();
  private readonly errors: string[] = [];
  private announcedIntents = false;
  private stopped = false;

  constructor(scenario: DemoScenario, options: Pick<AgentRunnerOptions, 'execute' | 'decisions'>) {
    super();
    this.users = scenario.users.flatMap((user) => user.intents.map((intent) => {
      const id = [user.id, intent.id].map(encodeURIComponent).join(':');
      return { id, userId: user.id, name: user.name, intentId: id, intent: intent.intent };
    }));

    for (const user of scenario.users) {
      const principals = this.users.filter(({ userId }) => userId === user.id);
      const principalFor = (intentId: string): TuiPrincipal => {
        const principal = principals.find((entry) => entry.intentId === intentId);
        if (!principal) throw new Error('Intent is outside this principal.');
        return principal;
      };
      const conversationFor = (intentId: string): ConversationStore => this.conversations.get(principalFor(intentId).id)!;
      const negotiationFor = (opportunityId: string): NegotiationDemo => {
        const demo = this.negotiations.get(opportunityId);
        if (!demo?.principals.some(({ userId }) => userId === user.id)) throw new Error('Negotiation is outside this principal.');
        return demo;
      };
      const intentOf = (principal: TuiPrincipal): Intent => ({ id: principal.intentId, statement: principal.intent, status: 'ACTIVE' });
      for (const principal of principals) {
        const conversation = new ConversationStore(principal,
          () => this.runners.get(user.id)!.handle({ type: 'principal.input', intentId: principal.intentId }),
          () => this.emit('change'));
        this.conversations.set(principal.id, conversation);
        this.activities.set(principal.id, new ReasoningObserver(() => this.emit('change')));
      }
      const host: AgentHost = {
        getProfile: async () => ({ id: user.id, name: user.name, intro: null, location: null, timezone: null, profileConfirmed: true }),
        getIntent: async (intentId) => intentOf(principalFor(intentId)),
        listIntents: async () => principals.map(intentOf),
        getConversation: async (intentId) => conversationFor(intentId).read(),
        listNegotiations: async () => [...this.negotiations.values()]
          .filter((demo) => demo.principals.some(({ userId }) => userId === user.id))
          .map((demo) => demo.read(user.id)).filter((record) => record.settledAt === null),
        getNegotiation: async (id) => negotiationFor(id).read(user.id),
        findCounterparties: async (intentId, query, limit) => {
          const principal = principalFor(intentId);
          const existing = new Set<string>();
          for (const demo of this.negotiations.values()) {
            if (!demo.principals.some(({ id }) => id === principal.id)) continue;
            for (const other of demo.principals) if (other.id !== principal.id) existing.add(other.intentId);
          }
          return this.users
            .filter((candidate) => candidate.userId !== principal.userId && !existing.has(candidate.intentId))
            .map((candidate) => ({
              intentId: candidate.intentId,
              userId: candidate.userId,
              name: candidate.name,
              statement: candidate.intent,
              networkId: 'local',
              score: relevance(query, candidate.intent),
            }))
            .sort((left, right) => right.score - left.score || left.intentId.localeCompare(right.intentId))
            .slice(0, limit);
        },
        createOpportunities: async (intentId, picks) => {
          const principal = principalFor(intentId);
          const created: { opportunityId: string }[] = [];
          for (const pick of picks) {
            if (pick.networkId !== 'local') continue;
            const counterparty = this.users.find((candidate) => candidate.intentId === pick.intentId);
            if (!counterparty || counterparty.userId === principal.userId) continue;
            created.push({ opportunityId: this.openNegotiation([principal, counterparty]).opportunityId });
          }
          return created;
        },
        appendMessages: async (intentId, messages) => {
          conversationFor(intentId).append(messages);
          for (const message of messages) {
            if (message.kind !== 'message') continue;
            if (message.text.startsWith('Stall: ')) {
              for (const match of message.matches) negotiationFor(match.opportunityId).progress('Awaiting ' + user.name + "'s input", 'question');
            } else if (message.text === 'Decision: stop') {
              for (const match of message.matches) negotiationFor(match.opportunityId).progress('Paused by ' + user.name + "'s agent", 'held');
            }
          }
        },
        submitTurn: async (id, turn) => {
          const demo = negotiationFor(id);
          try {
            return demo.submitTurn(user.id, turn);
          } catch (error) {
            if (!this.stopped) demo.error(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
      };
      this.runners.set(user.id, new AgentRunner({
        host,
        decisions: options.decisions,
        execute: async (input) => {
          const demo = input.operation === 'wake' ? undefined : negotiationFor(input.opportunityId);
          demo?.progress((input.operation === 'brief' ? 'Briefing for ' : 'Negotiating for ') + user.name, 'running');
          try {
            const principal = principalFor(input.intentId);
            await this.activities.get(principal.id)!.run(input, options.execute);
            if (input.operation === 'brief') demo?.progress('Awaiting principal input', 'held');
          } catch (error) {
            if (!input.abortSignal.aborted) demo?.error(error instanceof Error ? error.message : String(error));
            throw error;
          }
        },
        onError: (error) => {
          if (this.stopped) return;
          this.agentStatus = user.name + ': ' + (error instanceof Error ? error.message : String(error));
          this.errors.push(this.agentStatus);
          this.emit('change');
        },
      }));
    }
  }

  private openNegotiation(principals: readonly [TuiPrincipal, TuiPrincipal]): NegotiationDemo {
    const id = `local:${principals.map(({ id }) => id).sort().map(encodeURIComponent).join(':')}`;
    const existing = this.negotiations.get(id);
    if (existing) return existing;
    const demo = new NegotiationDemo(principals, id);
    demo.on('change', () => this.emit('change'));
    demo.on('negotiation.turn', () => {
      if (demo.phase === 'settled') {
        for (const principal of principals) {
          const record = demo.read(principal.userId);
          const counterpart = record.counterparty;
          this.conversations.get(principal.id)!.append([{
            id: crypto.randomUUID(), createdAt: record.settledAt!, kind: 'message', source: 'host', scope: 'match',
            outcome: record.outcome!, counterpartyIntent: counterpart.statement,
            matches: [{ opportunityId: id, counterparty: { id: counterpart.userId, name: counterpart.name } }],
            text: 'Host result: A2A negotiation with ' + (counterpart.name ?? counterpart.userId)
              + (record.outcome === 'agreed' ? ' agreed to connect.' : ' ended as ' + record.outcome + '.')
              + '\nCounterparty intent: ' + counterpart.statement
              + (record.outcome === 'agreed' ? '\n\nAn A2A agreement is not human consent and does not authorize project scope, schedules, fees, ownership, or other commitments.' : ''),
          }]);
        }
      }
      for (const principal of principals) {
        this.runners.get(principal.userId)!.handle({ type: 'negotiation.turn', intentId: principal.intentId, opportunityId: id });
      }
    });
    this.negotiations.set(id, demo);
    this.emit('change');
    return demo;
  }

  /**
   * Reconcile first-turn work and announce each newly seeded intent once, without adding a second scheduler.
   * @returns After startup reads and scheduling, not after reasoning finishes.
   * @throws If a runner cannot reconcile or has stopped.
   */
  async start(): Promise<void> {
    await Promise.all([...this.runners.values()].map((runner) => runner.reconcile()));
    if (this.announcedIntents) return;
    this.announcedIntents = true;
    for (const principal of this.users) {
      this.runners.get(principal.userId)!.handle({ type: 'intent.created', intentId: principal.intentId });
    }
  }

  /**
   * Request a wake for one H2A session without saving human input or answering its questions.
   * @param principalId - The user–intent session ID shown by the board.
   * @returns After scheduling or coalescing, not after reasoning; stopped runners ignore the request.
   * @throws If the session does not belong to this lab.
   */
  wake(principalId: string): void {
    const principal = this.users.find(({ id }) => id === principalId);
    if (!principal) throw new Error('Unknown H2A session.');
    this.runners.get(principal.userId)!.wake(principal.intentId);
  }

  /** Cancel all reasoning and prevent further host writes without draining active model requests. */
  stop(): void {
    this.stopped = true;
    for (const runner of this.runners.values()) runner.stop();
    for (const conversation of this.conversations.values()) conversation.stop();
    for (const demo of this.negotiations.values()) demo.stop();
  }

  /** @returns Each H2A conversation once, followed by the separate A2A match transcripts. */
  markdown(): string {
    const human = this.users.map((user) => {
      const conversation = this.conversations.get(user.id)!.conversation;
      const format = (entry: TuiMessage, index: number) =>
        '### ' + (index + 1) + '. ' + (entry.source === 'host' ? 'Host result' : entry.kind === 'answer' || entry.kind === 'user' ? user.name : "Your agent") + ' · ' + entry.kind
        + (entry.scope === 'intent' ? ' · This intent' : entry.matches.length ? ' · ' + entry.matches.map(({ counterparty }) => counterparty.name ?? counterparty.id).join(', ') : '') + '\n\n' + entry.text
        + (entry.options ? '\n\n' + entry.options.map((option) => '- ' + option).join('\n') : '');
      const dialogue = conversation.filter((entry) => entry.source !== 'host').map(format);
      const outcomes = conversation.filter((entry) => entry.source === 'host').map(format);
      return '# H2A · ' + user.name + '\n\nIntent: ' + user.intent + '\n\n## Conversation\n\n' + dialogue.join('\n\n')
        + (outcomes.length ? '\n\n## Host outcomes\n\n' + outcomes.join('\n\n') : '');
    });
    return '# Local negotiation lab transcript\n\nIncludes private principal conversations. No live Index records changed.\n\n'
      + [...human, ...[...this.negotiations.values()].map((demo) => demo.markdown())].join('\n\n---\n\n')
      + (this.errors.length ? '\n\n# Agent errors\n\n' + this.errors.join('\n\n') + '\n' : '');
  }
}
