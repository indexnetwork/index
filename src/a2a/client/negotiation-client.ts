import type { ActionSpec, Negotiator } from "../../core/negotiator.ts";
import type { NegotiationDecision, NegotiationParty } from "../../core/types.ts";
import { decisionToMessage, historyFromMessages } from "../wire/history.ts";
import type { A2ATask } from "../wire/types.ts";
import { sendA2AMessage } from "./transport.ts";

export interface A2ANegotiationClientOptions<A extends string> {
  negotiator: Negotiator;
  party: NegotiationParty;
  allowedActions: ActionSpec<A>[];
}

export interface A2ATurnResult {
  task: A2ATask;
  decision: NegotiationDecision;
}

/**
 * The client half of an A2A negotiation: decides this side's next move with
 * `Negotiator.decide()`, then sends it to another agent's A2A endpoint as a
 * `message/send` call. Use `initiate()` to start a new negotiation and
 * `continue()` to keep responding to an in-progress one.
 */
export class A2ANegotiationClient<A extends string> {
  constructor(private readonly options: A2ANegotiationClientOptions<A>) {}

  async initiate(url: string): Promise<A2ATurnResult> {
    const decision = await this.decide([]);
    const message = decisionToMessage(decision, "user");
    const task = await sendA2AMessage(url, message);
    return { task, decision };
  }

  async continue(url: string, task: A2ATask): Promise<A2ATurnResult> {
    const history = historyFromMessages(task.history, "client");
    const decision = await this.decide(history);
    const message = decisionToMessage(decision, "user", {
      taskId: task.id,
      contextId: task.contextId,
    });
    const updatedTask = await sendA2AMessage(url, message);
    return { task: updatedTask, decision };
  }

  private decide(history: Parameters<Negotiator["decide"]>[0]["history"]) {
    return this.options.negotiator.decide(
      { party: this.options.party, history },
      { allowedActions: this.options.allowedActions },
    );
  }
}
