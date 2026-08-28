import type { ActionSpec, Negotiator } from "../../core/negotiator.ts";
import type { NegotiationDecision, NegotiationParty, NegotiationState } from "../../core/types.ts";
import { decisionToMessage, historyFromMessages } from "../wire/history.ts";
import { defaultStrategy, type DecisionStrategy, type EvaluateHook } from "../wire/strategy.ts";
import type { A2AArtifact, A2ATask, A2ATaskState } from "../wire/types.ts";
import type { A2ACredentials } from "./transport.ts";
import { sendA2AMessage } from "./transport.ts";

export interface A2ANegotiationClientOptions<A extends string> {
  negotiator: Negotiator;
  party: NegotiationParty;
  allowedActions: ActionSpec<A>[];
  /** Customize how a turn is decided. Defaults to a plain `negotiator.decide()` call. */
  strategy?: DecisionStrategy<A>;
  /** Runs after each turn's decision, on this side only — the resulting
   * Artifact isn't sent to the counterparty or attached to their Task (this
   * client doesn't own it); it's returned on `A2ATurnResult` for the caller
   * to use however it likes. */
  evaluate?: EvaluateHook<A>;
  /** Fires as soon as this side's own decision is made, before it's sent
   * over the network — useful for logging/streaming a turn the moment it
   * happens instead of only after the counterparty's reply comes back too. */
  onDecision?: (decision: NegotiationDecision<A>) => void;
  /** Attaches auth headers (e.g. a bearer token) to every `message/send`
   * call this client makes. See `bearerCredentials()` for a minimal
   * example, or write a custom one for token refresh/mTLS/etc. */
  credentials?: A2ACredentials;
}

export interface A2ATurnResult<A extends string = string> {
  task: A2ATask;
  /** What the negotiation actually is now, copied from the server-stamped
   * `task.status.state`. The A2A spec makes the server the single authority
   * on task state, so this — not `decision.action` — is the outcome. */
  outcome: A2ATaskState;
  /** This side's own move. An *input* to the outcome, not a verdict on it:
   * the counterparty may have rejected in the same round trip, so a
   * `decision.action` of "accept" can sit on a task whose `outcome` is
   * "rejected". Read `outcome` to know what happened, and
   * `verifyAgreement(task)` to know what was agreed. */
  decision: NegotiationDecision<A>;
  artifact?: A2AArtifact;
}

/**
 * The client half of an A2A negotiation: decides this side's next move with
 * `Negotiator.decide()`, then sends it to another agent's A2A endpoint as a
 * `message/send` call. Use `initiate()` to start a new negotiation and
 * `continue()` to keep responding to an in-progress one.
 */
export class A2ANegotiationClient<A extends string> {
  private readonly strategy: DecisionStrategy<A>;

  constructor(private readonly options: A2ANegotiationClientOptions<A>) {
    this.strategy = options.strategy ?? (defaultStrategy as unknown as DecisionStrategy<A>);
  }

  async initiate(url: string): Promise<A2ATurnResult<A>> {
    return this.sendTurn(url, [], {});
  }

  async continue(url: string, task: A2ATask): Promise<A2ATurnResult<A>> {
    const history = historyFromMessages(task.history, "client");
    return this.sendTurn(url, history, { taskId: task.id, contextId: task.contextId });
  }

  private async sendTurn(
    url: string,
    history: NegotiationState["history"],
    refs: { taskId?: string; contextId?: string },
  ): Promise<A2ATurnResult<A>> {
    const decision = await this.strategy(
      this.options.negotiator,
      { party: this.options.party, history },
      this.options.allowedActions,
    );
    this.options.onDecision?.(decision);
    const message = decisionToMessage(decision, "user", refs);
    const task = await sendA2AMessage(url, message, this.options.credentials);
    const artifact = (await this.options.evaluate?.(task, decision)) ?? undefined;
    return { task, outcome: task.status.state, decision, artifact };
  }
}
