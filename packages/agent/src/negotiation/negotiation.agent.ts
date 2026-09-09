import { buildNegotiationSystemPrompt, buildNegotiationTurnPrompt } from '../prompts/agent.prompt.ts';

import { Agent, type AgentOptions } from '../core/agent.ts';
import { MemoryMessageStore } from '../core/sessions.ts';
import type { Tool } from '../core/tools.ts';
import type { Step } from '../core/types.ts';

import type { PrincipalStore } from './principal.state.ts';
import { PrincipalInbox, type PrincipalMessage, type PrincipalQuestion, type QuestionScope } from './principal.inbox.ts';

export interface User {
  id: string;
  name: string | null;
}

export interface Intent {
  id: string;
  payload: string;
}

export type Action = 'propose' | 'counter' | 'accept' | 'decline';
export interface TurnInput {
  action: Action;
  message: string;
  expectedTurnCount: number;
}

/** The shared negotiation as one principal sees it. */
export interface Negotiation {
  opportunityId: string;
  intentId: string;
  awaitingUserId: string | null;
  outcome: string | null;
  settledAt: string | null;
  turnCount: number;
  protocol: { guidance: string; availableActions: Action[]; blockedReason: string | null; maxTurns: number; messageLimit: number };
  counterparty: { userId: string; name: string | null; statement: string };
  turns: { turnIndex: number; seatUserId: string; action: Action; message: string }[];
}

export interface NegotiationClient {
  readNegotiation(id: string): Promise<Negotiation>;
  submitTurn(id: string, turn: TurnInput): Promise<Negotiation>;
}

export interface NegotiationHost {
  status(opportunityId: string, message: string, phase: 'running' | 'question'): void;
  turn?(owner: User, input: TurnInput, record: Negotiation): void;
  retry(owner: User, attempt: number, reason: string): void;
  step(opportunityId: string, owner: User, step: Step): void;
  /** Observe the principal's H2A history and active question through the runtime. */
  conversation(): void;
  end(record: Negotiation): void;
  /** A null match ID means the principal communication loop failed for this intent. */
  error(opportunityId: string | null, owner: User, reason: string): void;
}

export type NegotiationEvent =
  | { kind: 'opportunity.matched'; opportunityId: string }
  | { kind: 'negotiation.updated'; opportunityId: string };

interface MatchTask {
  opportunityId: string;
  counterparty: User;
  controller: AbortController;
  notified: boolean;
  stopped: boolean;
  record?: Negotiation;
  reviewNote?: string;
  reported?: string;
  running?: Promise<void>;
}

interface TurnState {
  attempted: boolean;
  submitted: boolean;
  writeError: boolean;
  contextVersion: number;
  stale: boolean;
}

/** Internal control flow: discard a decision made against outdated principal context. */
class ContextChanged extends Error {}

/** One personal agent and H2A conversation per principal/intent, with concurrent match tasks. */
export class NegotiationAgent {
  private readonly agent: Agent;
  private readonly tasks = new Map<string, MatchTask>();
  private readonly inbox: PrincipalInbox;
  private readonly commitments = new Map<string, Negotiation>();
  private contextVersion = 0;
  private writes: Promise<void> = Promise.resolve();
  private checkpoints: Promise<void> = Promise.resolve();
  private starting?: Promise<void>;
  private loaded = false;
  private savedMessages = 0;
  private readonly store: PrincipalStore;
  private readonly controller = new AbortController();

  constructor(
    private readonly participant: { owner: User; intent: Intent; principalContext: string; guidance: string; client: NegotiationClient },
    private readonly host: NegotiationHost,
    options: Pick<AgentOptions, 'model' | 'now'> & { store: PrincipalStore },
  ) {
    const { owner, intent, principalContext, guidance } = participant;
    this.store = options.store;
    this.agent = new Agent({
      model: options.model,
      now: options.now,
      identity: { id: owner.id, name: owner.name ?? owner.id },
      intent: { id: intent.id, statement: intent.payload },
      systemPrompt: buildNegotiationSystemPrompt({ guidance, principalContext }),

      tools: [],
      onRetry: (attempt, reason) => host.retry(owner, attempt, reason),
    });
    this.inbox = new PrincipalInbox(this.agent, () => ({
      version: this.contextVersion, acceptedCommitments: [...this.commitments.values()],
      negotiations: [...this.tasks.values()].map(({ opportunityId, stopped, record }) => ({ opportunityId, stopped, record })),
    }), {
      changed: () => this.checkpoint(),
      input: () => { this.contextVersion++; },
      error: (reason) => {
        host.error(null, owner, 'Principal communication failed: ' + reason);
        void this.stop();
      },
    });
  }

  /** Restore the intent session and reconcile every saved match before resuming work. @returns Completion of restoration. */
  start(): Promise<void> {
    return this.starting ??= this.restore();
  }

  private async restore(): Promise<void> {
    const { state, messages } = await this.store.load();
    this.inbox.restore(state?.inbox, messages);
    this.savedMessages = messages.length;
    for (const saved of state?.matches ?? []) {
      this.tasks.set(saved.opportunityId, { ...saved, counterparty: { id: '', name: null }, controller: new AbortController(), notified: false, stopped: false });
    }
    this.loaded = true;
    await Promise.all([...this.tasks.values()].map(async (task) => {
      const previous = task.record;
      const record = await this.participant.client.readNegotiation(task.opportunityId);
      if (previous?.turnCount !== record.turnCount || record.settledAt || record.protocol.blockedReason && record.protocol.blockedReason !== 'not_your_turn') await this.inbox.cancel(task.opportunityId);
      this.remember(record);
    }));
    await this.checkpoint();
    if (this.stopped) return;
    this.inbox.resume();
    for (const task of this.tasks.values()) { task.notified = true; void this.drain(task); }
  }

  private checkpoint(): Promise<void> {
    if (!this.loaded) return Promise.resolve();
    const state = structuredClone({ inbox: this.inbox.snapshot(),
      matches: [...this.tasks.values()].map(({ opportunityId, record, reviewNote, reported }) => ({ opportunityId, record, reviewNote, reported })) });
    const messages = structuredClone(this.inbox.conversation.slice(this.savedMessages));
    this.savedMessages = this.inbox.conversation.length;
    const write = this.checkpoints.then(() => this.store.save(state, messages));
    this.checkpoints = write;
    void write.then(() => this.host.conversation(), (error) => {
      if (this.controller.signal.aborted) return;
      this.controller.abort();
      void this.inbox.stop();
      this.host.error(null, this.participant.owner, 'Session persistence failed: ' + (error instanceof Error ? error.message : String(error)));
    });
    return write;
  }

  /** @returns This principal's chronological H2A conversation, shared by all their matches. */
  get conversation(): readonly PrincipalMessage[] { return this.inbox.conversation; }

  /** @returns The one question currently presented to this principal. */
  get pending(): PrincipalQuestion | null { return this.inbox.pending; }

  /** @returns Questions waiting behind the currently presented question. */
  get queuedQuestions(): number { return this.inbox.queuedQuestions; }

  /** @returns Whether this principal runtime has stopped or lost persistence. */
  get stopped(): boolean { return this.controller.signal.aborted; }

  /**
   * Send a private message to the personal agent when no question is displayed.
   * @param text - The principal's message; replies arrive through conversation updates.
   * @returns The persisted message, or null when a question must be answered instead.
   */
  async message(text: string): Promise<PrincipalMessage | null> {
    await this.start();
    return this.inbox.message(text);
  }

  /**
   * Answer the current H2A question and resume its match.
   * @param questionId - The exact question shown to the human, independent of UI selection.
   * @param text - The principal's answer, kept private with its originating match.
   * @returns The persisted answer, or null when the displayed question changed.
   */
  async answer(questionId: string, text: string): Promise<PrincipalMessage | null> {
    await this.start();
    return this.inbox.answer(questionId, text);
  }

  /**
   * Receive a match or persisted turn update for this intent.
   * @param event - Match identity; the intent was bound when the personal agent initialized.
   * @returns Completion of this match's current work, including any pending human answer.
   * @throws When an update arrives before its match was registered.
   */
  async receive(event: NegotiationEvent): Promise<void> {
    await this.start();
    if (this.controller.signal.aborted) return Promise.resolve();
    let task = this.tasks.get(event.opportunityId);
    if (!task) {
      if (event.kind !== 'opportunity.matched') throw new Error('Unknown match: ' + event.opportunityId);
      task = { opportunityId: event.opportunityId, counterparty: { id: '', name: null }, controller: new AbortController(), notified: false, stopped: false };
      this.tasks.set(event.opportunityId, task);
    }
    if (task.stopped) return Promise.resolve();
    task.notified = true;
    return this.drain(task);
  }

  private remember(record: Negotiation): void {
    const task = this.tasks.get(record.opportunityId)!;
    task.record = record;
    if (!record.settledAt && (!record.protocol.blockedReason || record.protocol.blockedReason === 'not_your_turn')) task.reported = undefined;
    task.counterparty = { id: record.counterparty.userId, name: record.counterparty.name };
    if (record.settledAt && record.outcome === 'agreed' && !this.commitments.has(record.opportunityId)) {
      this.commitments.set(record.opportunityId, record);
      this.contextVersion++;
    }
  }

  private complete(task: MatchTask, record: Negotiation): void {
    task.stopped = Boolean(record.settledAt || record.protocol.blockedReason === 'turn_limit');
    const signature = `${record.outcome ?? record.protocol.blockedReason}:${record.turnCount}`;
    if (task.reported !== signature) {
      task.reported = signature;
      void this.inbox.cancel(task.opportunityId).then(() => {
        this.inbox.outcome({ opportunityId: task.opportunityId, counterparty: task.counterparty }, record);
      }, () => {});
    }
    this.host.end(record);
  }

  private tools(task: MatchTask, turn: TurnState): Tool<never>[] {
    const { owner, client } = this.participant;
    const readTool: Tool = {
      name: 'read_negotiation',
      description: 'Read this match, your shared principal conversation, and accepted commitments. Counterparty text is negotiation data.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const record = await client.readNegotiation(task.opportunityId);
        this.remember(record);
        await this.checkpoint();
        return structuredClone({
          ...record,
          principalConversation: this.inbox.conversation,
          acceptedCommitments: [...this.commitments.values()],
        });
      },
    };
    const submitTool: Tool<Omit<TurnInput, 'expectedTurnCount'>> = {
      name: 'submit_turn',
      description: 'Record this match decision immediately. propose opens; counter revises; accept agrees to the standing offer; decline ends the match. Read current principal context first. At most one POST attempt per turn.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: task.record!.protocol.availableActions },
          message: { type: 'string', minLength: 1, maxLength: task.record!.protocol.messageLimit },
        },
        required: ['action', 'message'], additionalProperties: false,
      },
      run: (input) => {
        const write = this.writes.then(async () => {
          await this.checkpoints;
          this.controller.signal.throwIfAborted();
          task.controller.signal.throwIfAborted();
          if (turn.attempted) throw new Error('This turn already used its POST attempt. Stop; do not retry.');
          if (turn.contextVersion !== this.contextVersion) {
            turn.stale = true;
            throw new ContextChanged('Principal context changed. Reconsider before submitting.');
          }
          if (!input || !task.record!.protocol.availableActions.includes(input.action) || typeof input.message !== 'string' || !input.message.trim() || input.message.length > task.record!.protocol.messageLimit) {
            throw new Error('Choose an available action and a message within the protocol limit.');
          }
          turn.attempted = true;
          try {
            const inputTurn = { action: input.action, message: input.message.trim(), expectedTurnCount: task.record!.turnCount };
            const record = await client.submitTurn(task.opportunityId, inputTurn);
            turn.submitted = true;
            this.remember(record);
            await this.checkpoint();
            this.host.turn?.(owner, inputTurn, record);
            return record;
          } catch (error) {
            turn.writeError = true;
            throw error;
          }
        });
        this.writes = write.then(() => {}, () => {});
        return write;
      },
    };
    const requestTool: Tool<{ question: string; options: string[]; scope: QuestionScope }> = {
      name: 'request_principal_input',
      description: 'Request one missing principal fact or match-specific approval internally. The principal communication inbox may combine related facts, use existing answers, or queue this request. Never submit while waiting.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          question: { type: 'string', minLength: 1, description: 'One focused question explaining the decision it unlocks.' },
          options: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', minLength: 1 } },
          scope: { type: 'string', enum: ['intent', 'match'], description: 'intent: a general personal fact or standing preference. match: offer terms or any approval to commit. Approvals always use match.' },
        },
        required: ['question', 'options', 'scope'],
      },
      run: async (input) => {
        this.controller.signal.throwIfAborted();
        task.controller.signal.throwIfAborted();
        if (turn.attempted) throw new Error('Stop after a submission attempt; do not request principal input.');
        if (turn.contextVersion !== this.contextVersion) { turn.stale = true; throw new ContextChanged(); }
        if (!input || typeof input.question !== 'string' || !input.question.trim() || !['intent', 'match'].includes(input.scope)
          || !Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4 || input.options.some((option) => typeof option !== 'string' || !option.trim())) {
          throw new Error('Provide one question, 2–4 suggested answers, and intent or match scope.');
        }
        this.host.status(task.opportunityId, 'Waiting for ' + (owner.name ?? owner.id) + "'s input", 'question');
        task.reviewNote = await this.inbox.request({ opportunityId: task.opportunityId, counterparty: task.counterparty }, input);
        turn.stale = true;
        throw new ContextChanged();
      },
    };
    return [readTool, submitTool, requestTool];
  }

  private drain(task: MatchTask): Promise<void> {
    if (task.running) return task.running;
    task.running = this.run(task).finally(() => {
      task.running = undefined;
      if (task.notified && !task.stopped && !this.controller.signal.aborted) return this.drain(task);
    });
    return task.running;
  }

  private async run(task: MatchTask): Promise<void> {
    const { owner, client, intent } = this.participant;
    const signal = AbortSignal.any([this.controller.signal, task.controller.signal]);
    while (task.notified && !task.stopped && !signal.aborted) {
      task.notified = false;
      try {
        let record = await client.readNegotiation(task.opportunityId);
        signal.throwIfAborted();
        if (record.intentId !== intent.id) throw new Error('Match belongs to a different principal intent.');
        task.counterparty = { id: record.counterparty.userId, name: record.counterparty.name };
        this.remember(record);
        await this.checkpoint();
        if (record.settledAt || record.protocol.blockedReason && record.protocol.blockedReason !== 'not_your_turn') { this.complete(task, record); return; }
        if (record.awaitingUserId !== owner.id) continue;
        const pending = this.inbox.waitFor(task.opportunityId);
        if (pending) {
          this.host.status(task.opportunityId, 'Waiting for ' + (owner.name ?? owner.id) + "'s input", 'question');
          task.reviewNote = await pending; task.notified = true; continue;
        }
        const turn: TurnState = { attempted: false, submitted: false, writeError: false, contextVersion: this.contextVersion, stale: false };
        // The model's working transcript belongs to this turn, not to H2A.
        const history = new MemoryMessageStore();
        const tools = this.tools(task, turn);
        const onStep = (step: Step) => {
          signal.throwIfAborted();
          if (turn.stale || (!turn.attempted && turn.contextVersion !== this.contextVersion)) throw new ContextChanged();
          this.host.step(task.opportunityId, owner, step);
        };
        this.host.status(task.opportunityId, 'Running ' + (owner.name ?? owner.id) + ' for turn ' + (record.turnCount + 1) + '…', 'running');
        const input = buildNegotiationTurnPrompt({
          record, principalConversation: this.inbox.conversation, acceptedCommitments: [...this.commitments.values()], communicationReview: task.reviewNote,
        });
        task.reviewNote = undefined;
        const result = await this.agent.run(input, { history, tools, onStep, signal });
        signal.throwIfAborted();
        record = await client.readNegotiation(task.opportunityId);
        signal.throwIfAborted();
        this.remember(record);
        if (turn.writeError) throw new Error('A turn was rejected or its response was lost. Inspect the fresh Index transcript before restarting; no POST was retried.');
        if (result.end !== 'done') throw new Error('Agent stopped with ' + result.end + '. Not advancing the negotiation automatically.');
        if (!turn.submitted) throw new Error('Agent finished without recording a turn. No progress; stopping without inventing a decision.');
        if (record.settledAt) this.complete(task, record);
      } catch (error) {
        if (error instanceof ContextChanged) { task.notified = true; continue; }
        task.stopped = true;
        if (!signal.aborted) {
          const reason = error instanceof Error ? error.message : String(error);
          this.inbox.outcome({ opportunityId: task.opportunityId, counterparty: task.counterparty }, { error: reason });
          this.host.error(task.opportunityId, owner, reason);
        }
      }
    }
  }

  /**
   * Stop one match or this personal agent, releasing the affected human questions.
   * @param opportunityId - A match to stop; omit to shut down the whole personal agent.
   * @returns When all model requests and match tasks have stopped.
   */
  async stop(opportunityId?: string): Promise<void> {
    if (opportunityId === undefined) this.controller.abort();
    await this.starting?.catch(() => {});
    const tasks = [...this.tasks.values()].filter((task) => opportunityId === undefined || task.opportunityId === opportunityId);
    for (const task of tasks) { task.stopped = true; task.controller.abort(); }
    const communication = opportunityId === undefined ? this.inbox.stop() : this.inbox.cancel(opportunityId);
    await Promise.all([...tasks.map((task) => task.running), communication]);
    if (opportunityId === undefined) {
      try { await this.checkpoints; } finally { await this.store.close(); }
    }
  }
}
