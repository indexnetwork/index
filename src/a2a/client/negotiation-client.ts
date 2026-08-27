import type { ActionSpec, Negotiator } from "../../core/negotiator.ts";
import type { NegotiationDecision, NegotiationParty, NegotiationState } from "../../core/types.ts";
import { decisionToMessage, historyFromMessages } from "../wire/history.ts";
import { defaultStrategy, type DecisionStrategy, type EvaluateHook } from "../wire/strategy.ts";
import type { A2AArtifact, A2ATask } from "../wire/types.ts";
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
}

export interface A2ATurnResult<A extends string = string> {
  task: A2ATask;
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
    const message = decisionToMessage(decision, "user", refs);
    const task = await sendA2AMessage(url, message);
    const artifact = (await this.options.evaluate?.(task, decision)) ?? undefined;
    return { task, decision, artifact };
  }
}
