import type { Decision, Intent } from "../agents/shared/agent.context.js";
import type { Execute } from "../agents/shared/reasoning/reasoning.execution.js";

import { AgentExecution, type NegotiationRunResult } from "./agent.execution.js";
import type { AgentHost } from "./agent.host.js";
import { readConversation, readStandingContext } from "./conversation.codec.js";
import type { IntentMembership } from "./runner.context.js";

/**
 * Negotiations this principal runs at once. Set above a normal discovery burst:
 * measured latency does not grow with burst position, so queueing ordinary work
 * only delays it. This bounds pathological fan-out, nothing else.
 */
const NEGOTIATION_CONCURRENCY = 24;
/** Retries for one negotiation run, so a single lost turn does not wait for the next wake. */
const NEGOTIATION_RETRIES = 1;

/** Dependencies for one principal's runner, without transport ownership. */
export interface AgentRunnerOptions {
  /** Host access already scoped to the principal this runner represents. */
  host: AgentHost;
  /** Runs a complete reasoning/tool loop, directly or through a native executor. */
  execute: Execute;
  /** Optional prompt-preparation clock, not the clock for persistence timestamps. */
  now?: () => Date;
  /** Reports agent work as individual log lines. */
  log?: (line: string) => void;
  /** Reports background failures; reconciliation failures reject its own promise. */
  onError?: (error: unknown) => void;
  /**
   * Reports whether this runner is reasoning about an intent. A silent wake is
   * still a wake, so this is the only account of that work a principal can be
   * shown. Coalesced wakes stay active throughout rather than reporting idle
   * between them.
   */
  onWake?: (intentId: string, active: boolean) => void;
}

/** Principal-scoped runner with in-memory scheduling for both agent layers and one-way cancellation. */
export class AgentRunner {
  private readonly options: AgentRunnerOptions;
  private readonly abortController = new AbortController();
  private readonly membership: IntentMembership = { active: new Set() };
  private readonly execution: AgentExecution;
  private adoptedIntents = false;
  private reconciliation: Promise<void> = Promise.resolve();
  private readonly activeWakes = new Set<string>();
  private readonly pendingWakes = new Set<string>();
  private readonly activeNegotiations = new Map<string, string>();
  /** Scheduled negotiations waiting for a slot, oldest first. */
  private readonly queuedNegotiations = new Map<string, string>();
  private readonly heldNegotiations = new Map<string, string>();
  private readonly pendingPrincipalWork = new Map<string, string>();

  /**
   * Retains dependencies without reading host state, subscribing, or starting work.
   * @param options - Principal-scoped host access, reasoning execution, and optional callbacks.
   */
  constructor(options: AgentRunnerOptions) {
    this.options = { ...options };
    this.execution = new AgentExecution({
      host: options.host,
      execute: options.execute,
      abortSignal: this.abortController.signal,
      membership: this.membership,
      now: options.now,
      log: options.log,
      scheduleNegotiation: (intentId, opportunityId, decision) => this.scheduleNegotiation(intentId, opportunityId, decision),
    });
  }

  /**
   * Adopts active intents and recovers every turn this principal owes, using the
   * normal schedulers. Repeating it is the sweep that recovers a turn lost to a
   * failed run, so it covers negotiations already under way, not only first turns.
   * Persisted unresolved stalls remain held until the principal answers them.
   * The first refresh does not wake existing intents; later refreshes wake newly active ones.
   * @returns After serialized host reads, membership refresh, and scheduling, not reasoning completion.
   * @throws If a reconciliation read fails or cancellation is observed; scheduled work is not undone.
   */
  async reconcile(): Promise<void> {
    const abortSignal = this.abortController.signal;
    abortSignal.throwIfAborted();
    const reconciliation = this.reconciliation.then(async () => {
      abortSignal.throwIfAborted();
      let membership: Set<string>;
      let intents: Intent[];
      do {
        membership = this.membership.active;
        intents = await this.options.host.listIntents();
        abortSignal.throwIfAborted();
      } while (membership !== this.membership.active);
      const active = new Set(intents.filter((intent) => intent.status === "ACTIVE").map((intent) => intent.id));
      const newlyActive = this.adoptedIntents ? [...active].filter((id) => !this.membership.active.has(id)) : [];
      this.membership.active = active;
      this.adoptedIntents = true;
      for (const intentId of newlyActive) {
        abortSignal.throwIfAborted();
        this.scheduleWake(intentId);
      }

      const [profile, negotiations] = await Promise.all([this.options.host.getProfile(), this.options.host.listNegotiations()]);
      abortSignal.throwIfAborted();
      const activeNegotiations = negotiations.filter((negotiation) => this.membership.active.has(negotiation.intentId));
      const standingByIntent = new Map(await Promise.all([...new Set(activeNegotiations.map((negotiation) => negotiation.intentId))]
        .map(async (intentId) => {
          const { messages } = await this.options.host.getConversation(intentId);
          return [intentId, readStandingContext(readConversation(messages))] as const;
        })));
      abortSignal.throwIfAborted();
      for (const negotiation of activeNegotiations) {
        if (negotiation.awaitingUserId !== profile.id) continue;
        const standing = standingByIntent.get(negotiation.intentId)?.get(negotiation.opportunityId);
        if (standing?.stall && !standing.answered) {
          this.heldNegotiations.set(negotiation.opportunityId, negotiation.intentId);
          continue;
        }
        this.heldNegotiations.delete(negotiation.opportunityId);
        abortSignal.throwIfAborted();
        this.scheduleNegotiation(negotiation.intentId, negotiation.opportunityId);
      }
      abortSignal.throwIfAborted();
    });
    this.reconciliation = reconciliation.catch(() => {});
    await reconciliation;
  }

  /**
   * Routes a notification for information already persisted by the principal-scoped host.
   * @param event - The change kind and routing IDs, without a context snapshot.
   * @returns Immediately after scheduling or coalescing, not after completion or durable queuing.
   */
  handle(event: AgentEvent): void {
    if (this.abortController.signal.aborted) return;
    switch (event.type) {
      case "principal.input":
        for (const [opportunityId, intentId] of this.heldNegotiations) {
          if (intentId === event.intentId) this.heldNegotiations.delete(opportunityId);
        }
        this.scheduleWake(event.intentId);
        return;
      case "intent.created":
      case "intent.updated":
      case "intent.lifecycle":
      case "agent.wake":
        this.scheduleWake(event.intentId);
        return;
      case "negotiation.turn":
        this.scheduleNegotiation(event.intentId, event.opportunityId);
        return;
    }
  }

  /**
   * Requests fresh H2A reasoning through the normal coalescing scheduler.
   * @param intentId - The intent to read through this principal's host.
   * @returns Immediately after scheduling or coalescing; background failures go to onError.
   */
  wake(intentId: string): void {
    this.scheduleWake(intentId);
  }

  /**
   * Drops pending principal work and permanently requests cancellation; repeated calls are harmless.
   * @returns Immediately, without draining active I/O or rolling back persisted effects.
   */
  stop(): void {
    this.pendingWakes.clear();
    this.pendingPrincipalWork.clear();
    this.queuedNegotiations.clear();
    this.abortController.abort();
  }

  private scheduleWake(intentId: string): void {
    if (this.abortController.signal.aborted) return;
    if (this.activeWakes.has(intentId)) {
      this.pendingWakes.add(intentId);
      return;
    }
    this.activeWakes.add(intentId);
    this.options.onWake?.(intentId, true);
    for (const [opportunityId, pendingIntentId] of this.pendingPrincipalWork) {
      if (pendingIntentId === intentId) this.pendingPrincipalWork.delete(opportunityId);
    }
    void this.execution.runWake(intentId)
      .catch((error) => this.options.onError?.(error))
      .finally(() => {
        this.activeWakes.delete(intentId);
        // The follow-up is the same stretch of work from the principal's side,
        // so idle is reported only once nothing is left to run.
        if (this.pendingWakes.delete(intentId)) this.scheduleWake(intentId);
        else this.options.onWake?.(intentId, false);
      });
  }

  private scheduleNegotiation(intentId: string, opportunityId: string, decision?: Decision): void {
    if (this.abortController.signal.aborted) return;
    if (this.activeNegotiations.has(opportunityId) || this.queuedNegotiations.has(opportunityId)) return;
    if (decision === "accept" || decision === "decline") this.heldNegotiations.delete(opportunityId);
    if (this.heldNegotiations.has(opportunityId)) return;

    this.queuedNegotiations.set(opportunityId, intentId);
    this.startNegotiations();
  }

  /** Starts queued negotiations, oldest first, up to the concurrency limit. */
  private startNegotiations(): void {
    for (const [opportunityId, intentId] of this.queuedNegotiations) {
      if (this.activeNegotiations.size >= NEGOTIATION_CONCURRENCY) return;
      this.queuedNegotiations.delete(opportunityId);
      this.activeNegotiations.set(opportunityId, intentId);
      void this.attemptNegotiation(intentId, opportunityId)
        .finally(() => {
          this.activeNegotiations.delete(opportunityId);
          if (this.abortController.signal.aborted) return;
          this.startNegotiations();
          if (this.negotiating(intentId)) return;
          if ([...this.pendingPrincipalWork.values()].includes(intentId)) this.scheduleWake(intentId);
        });
    }
  }

  /**
   * Runs one negotiation and retries it. A model, publication or submission
   * failure otherwise loses the turn until something unrelated schedules the
   * opportunity again, which is indistinguishable from the counterpart being slow.
   */
  private async attemptNegotiation(intentId: string, opportunityId: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.recordNegotiationResult(intentId, opportunityId, await this.execution.runNegotiation(intentId, opportunityId));
        return;
      } catch (error: unknown) {
        this.options.onError?.(error);
        if (attempt >= NEGOTIATION_RETRIES || this.abortController.signal.aborted) return;
        this.options.log?.(`retrying ${opportunityId}`);
      }
    }
  }

  /** @param intentId - Intent to test. @returns Whether it still has a negotiation running or waiting. */
  private negotiating(intentId: string): boolean {
    for (const active of this.activeNegotiations.values()) if (active === intentId) return true;
    for (const queued of this.queuedNegotiations.values()) if (queued === intentId) return true;
    return false;
  }

  private recordNegotiationResult(intentId: string, opportunityId: string, result: NegotiationRunResult): void {
    if (this.abortController.signal.aborted || !result) return;
    if ("turn" in result) {
      this.heldNegotiations.delete(opportunityId);
      this.pendingPrincipalWork.delete(opportunityId);
      this.options.log?.(`turn ${result.turn.action} on ${opportunityId}`);
      return;
    }
    this.heldNegotiations.set(opportunityId, intentId);
    this.pendingPrincipalWork.set(opportunityId, intentId);
    this.options.log?.("stall" in result ? `stall on ${opportunityId}: ${result.stall.reason}` : `unbriefed opportunity ${opportunityId}`);
  }
}

/**
 * Notification referencing a change already persisted by the principal-scoped host.
 * The runner reads current records rather than receiving context snapshots.
 */
export type AgentEvent =
  | { type: "principal.input"; intentId: string }
  | { type: "intent.created"; intentId: string }
  | { type: "intent.updated"; intentId: string }
  | { type: "intent.lifecycle"; intentId: string }
  | { type: "agent.wake"; intentId: string }
  | { type: "negotiation.turn"; intentId: string; opportunityId: string };
