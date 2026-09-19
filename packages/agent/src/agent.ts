import { ModelLoop, type ModelLoopOptions } from './core/model.loop.ts';
import type { Step } from './core/types.ts';
import { WakeTiming } from './core/timing.ts';
import type { AgentDomainEvent, PrincipalActivation } from './negotiation/agent.events.ts';
import type { DiscoveryClient } from './negotiation/discovery.types.ts';
import type { NegotiationSpeaker } from './negotiation/negotiation.speaker.ts';
import { NegotiationSubagents } from './negotiation/negotiation.subagent.ts';
import type { Negotiation, NegotiationClient, NegotiationEvent, TurnInput, User } from './negotiation/negotiation.types.ts';
import { PrincipalInbox, type AgentInput, type PrincipalMessage, type PrincipalQuestion, type PrincipalToolCall } from './negotiation/principal.inbox.ts';
import type { PrincipalRecords, PrincipalRecordsView } from './negotiation/principal.records.ts';
import { buildNegotiationSystemPrompt } from './prompts/agent.prompt.ts';

export type { AgentInput } from './negotiation/principal.inbox.ts';

/** The human and intent represented by this agent, with host-owned protocol access. */
export interface AgentParticipant {
  owner: User;
  intentId: string;
  guidance: string;
  client: NegotiationClient;
}

/** Host observations and transport for internal subagents, not additional H2A commands. */
export interface AgentHost {
  /** Register A2A notifications synchronously; return an unsubscribe function. Delivery waits for readiness. */
  subscribe(receive: (event: NegotiationEvent) => Promise<void>): () => void;
  event?(event: AgentDomainEvent): void;
  status(opportunityId: string, message: string, phase: 'running' | 'paused'): void;
  turn?(owner: User, input: TurnInput, record: Negotiation): void;
  retry(owner: User, attempt: number, reason: string): void;
  step(opportunityId: string, owner: User, step: Step): void;
  /** Read the agent's conversation and activity snapshots when this fires. */
  conversation(): void;
  end(record: Negotiation): void;
  /** A null match ID means H2A failed and the agent is shutting down. */
  error(opportunityId: string | null, owner: User, reason: string): void;
}

/** Dependencies and lifetime supplied by the host; construction never calls the model. */
export interface AgentOptions extends Pick<ModelLoopOptions, 'model' | 'now'> {
  records: PrincipalRecords;
  signal: AbortSignal;
  discovery?: DiscoveryClient;
  speaker?: NegotiationSpeaker;
}

/**
 * The human-facing agent for one principal/intent. Its only commands are
 * receiveInput() and wake(); negotiations are private, brief-bound subagents.
 * Construction is synchronous. Readiness restores records, never model work.
 */
export class Agent {
  /** Host ownership and history restoration, with no H2A review or A2A turn. */
  readonly ready: Promise<void>;
  /** Resolves after cancellation drains all work and releases record ownership. */
  readonly closed: Promise<void>;
  private readonly inbox: PrincipalInbox;
  private readonly subagents: NegotiationSubagents;
  private readonly controller = new AbortController();
  private readonly unsubscribe: () => void;
  private readonly abort = () => this.controller.abort();

  constructor(
    private readonly participant: AgentParticipant,
    private readonly host: AgentHost,
    private readonly options: AgentOptions,
  ) {
    this.subagents = new NegotiationSubagents(participant, host, { ...options, signal: this.controller.signal });
    this.inbox = new PrincipalInbox((records) => this.createLoop(records), options.records, participant.client, {
      changed: () => host.conversation(),
      event: (event) => host.event?.(event),
      input: () => this.subagents.invalidate(),
      paused: () => this.subagents.paused,
      delegated: (ids) => this.subagents.delegate(ids),
      error: (reason) => {
        host.error(null, participant.owner, 'Principal communication failed: ' + reason);
        this.abort();
      },
    }, options.discovery);
    this.ready = Promise.resolve().then(async () => {
      if (this.stopped) return;
      await options.records.start();
      if (this.stopped) return;
      const records = await this.inbox.refresh();
      if (!this.stopped) await this.subagents.restore(records);
    });
    this.unsubscribe = host.subscribe(async (event) => {
      await this.ready;
      await this.subagents.receive(event);
    });
    this.closed = new Promise<void>((resolve, reject) => {
      this.controller.signal.addEventListener('abort', () => {
        void this.close().then(resolve, reject);
      }, { once: true });
    });
    options.signal.addEventListener('abort', this.abort, { once: true });
    if (options.signal.aborted) this.abort();
    void this.ready.catch(this.abort);
    // Hosts may observe an internal failure before they await resource cleanup.
    void this.closed.catch(() => {});
  }

  /** @returns Committed private H2A history, excluding activation receipts. */
  get conversation(): readonly PrincipalMessage[] { return this.inbox.conversation; }
  /** @returns All unanswered, unretired questions in issuance order. */
  get pending(): readonly PrincipalQuestion[] { return this.inbox.pending; }
  /** @returns Whether the agent's lifetime has ended. Cleanup completes at closed. */
  get stopped(): boolean { return this.controller.signal.aborted; }
  /** @returns Whether H2A is reviewing its current context. */
  get reviewing(): boolean { return this.inbox.reviewing; }
  /** @returns Guidance when the latest review or automatic matching stopped early. */
  get reviewNotice(): string | undefined { return this.inbox.reviewNotice; }
  /** @returns Ephemeral H2A tool and automatic matching observations, separate from conversation history. */
  get toolCalls(): readonly PrincipalToolCall[] { return this.inbox.toolCalls; }
  /** @returns Opportunity IDs with active A2A subagent work, excluding cancelled work. */
  get negotiating(): readonly string[] { return this.subagents.negotiating; }

  /**
   * Persist human input and wake H2A once, only if the entire input is accepted.
   * @param input - A direct message or one answer for every displayed question.
   * @returns Committed entries without waiting for reasoning, or null on rejection.
   * @throws The initialization error or original H2A failure.
   */
  async receiveInput(input: AgentInput): Promise<readonly PrincipalMessage[] | null> {
    await this.ready;
    return this.inbox.receiveInput(input);
  }

  /**
   * Review existing context without adding human input or granting authority.
   * @param activation - A stable manual/lifecycle receipt; defaults to a new manual wake.
   * @param timing - Host-started timing covering acceptance through background completion.
   * @returns Its private receipt without waiting for reasoning, or null if stopped/duplicate.
   * @throws The initialization error or original H2A failure.
   */
  async wake(
    activation: PrincipalActivation = { id: crypto.randomUUID(), type: 'h2a.wake' },
    timing = new WakeTiming(activation.id, (event) => this.host.event?.(event), 'wake'),
  ): Promise<PrincipalMessage | null> {
    try {
      await timing.measure('agent.ready', () => this.ready, this.controller.signal);
      return await this.inbox.wake(activation, timing);
    } catch (error) {
      timing.finish(this.stopped ? 'cancelled' : 'error');
      throw error;
    }
  }

  private createLoop(records: PrincipalRecordsView): Pick<ModelLoop, 'run'> {
    const { owner, intentId, guidance } = this.participant;
    const loop = new ModelLoop({
      model: this.options.model, now: this.options.now,
      identity: { id: owner.id, name: owner.name ?? owner.id },
      intent: { id: records.intent.id, statement: records.intent.payload },
      systemPrompt: buildNegotiationSystemPrompt({ guidance, principalContext: records.principalContext }),
      tools: [], onRetry: (attempt, reason) => this.host.retry(owner, attempt, reason),
    });
    const speaker = this.options.speaker;
    if (!speaker) return loop;
    return {
      run: (prompt, options = {}) => speaker.run({
        kind: 'inbox', intentId,
        systemPrompt: loop.instructions(), prompt, tools: options.tools ?? [],
        context: { loop, signal: options.signal }, onStep: options.onStep, signal: options.signal,
      }),
    };
  }

  private async close(): Promise<void> {
    this.unsubscribe();
    this.options.signal.removeEventListener('abort', this.abort);
    const inboxStopped = this.inbox.stop();
    await this.ready.catch(() => {});
    try { await Promise.all([inboxStopped, this.subagents.stop()]); }
    finally { await this.options.records.close(); }
  }
}
