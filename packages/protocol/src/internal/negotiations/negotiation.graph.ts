/**
 * Bilateral negotiation graph: init → turn* → finalize.
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link NegotiationGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph } from "@langchain/langgraph";

import type { NegotiationGraphDatabase } from "../../platform/database.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState } from "./negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { NegotiationStallGapAuthor } from "./negotiation.stall-gap.js";
import { isTerminalAction } from "./negotiation.protocol.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import type { ReflectEnqueueFn } from "./negotiation.reflect.js";
import type { NegotiatorMemoryRetrieveFn } from "./negotiation.memory.js";
import type { NegotiatorClientDmRetrieveFn } from "./negotiation.client-dm.js";
import type { InChatNegotiationQuestionDelivery } from "../../platform/chat/ports.js";
import type { QuestionerEnqueueFn } from "../../protocol/question-input.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";
import { initNode } from "./negotiation.graph.init.js";
import { turnNode } from "./negotiation.graph.turn.js";
import { finalizeNode } from "./negotiation.graph.finalize.js";

export type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";
export { negotiateCandidates } from "./negotiation.candidates.js";
export type { NegotiationCandidate, NegotiationResult, OnNegotiationResolved } from "./negotiation.candidates.js";

/**
 * Factory for the bilateral negotiation LangGraph state machine.
 * @remarks Accepts an AgentDispatcher for per-turn agent resolution.
 */
export class NegotiationGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: NegotiationGraphDeps;

  constructor(
    database: NegotiationGraphDatabase,
    dispatcher: AgentDispatcher,
    timeoutQueue?: import("../../platform/negotiation/events.js").NegotiationTimeoutQueue,
    questionerEnqueue?: QuestionerEnqueueFn,
    reflectEnqueue?: ReflectEnqueueFn,
    memoryRetrieve?: NegotiatorMemoryRetrieveFn,
    clientDmRetrieve?: NegotiatorClientDmRetrieveFn,
    inChatQuestionDelivery?: InChatNegotiationQuestionDelivery,
  ) {
    this.deps = {
      database,
      dispatcher,
      timeoutQueue,
      questionerEnqueue,
      reflectEnqueue,
      memoryRetrieve,
      clientDmRetrieve,
      inChatQuestionDelivery,
      systemAgent: new IndexNegotiator(),
      stallGapAuthor: new NegotiationStallGapAuthor(),
    };
  }

  createGraph() {
    const deps = this.deps;

    return new StateGraph(NegotiationGraphState)
      .addNode("init", (state: NegotiationState) => initNode(state, deps))
      .addNode("turn", (state: NegotiationState) => turnNode(state, deps))
      .addNode("finalize", (state: NegotiationState) => finalizeNode(state, deps))
      .addConditionalEdges("turn", routeAfterTurn, {
        turn: "turn",
        finalize: "finalize",
      })
      .addConditionalEdges("init", routeAfterInit, { turn: "turn", finalize: "finalize" })
      .addEdge("__start__", "init")
      .addEdge("finalize", "__end__")
      .compile();
  }
}

/** After init: fail closed, or take the first turn. */
export function routeAfterInit(state: NegotiationState): string {
  return state.error ? "finalize" : "turn";
}

/** After a turn: keep going, or settle. */
export function routeAfterTurn(state: NegotiationState): string {
  if (state.status === 'waiting_for_agent') return "finalize";
  if (state.status === 'input_required') return "finalize";
  if (state.error) return "finalize";
  // The copy-loop guard ended the run: an agent repeated a message already on
  // the record and repeated it again when re-issued. Nothing was persisted and
  // the turn count did not move, so there is nothing to route back to — and
  // unlike a failed turn this is not retryable, because the same seat facing
  // the same record produces the same copy.
  if (state.repetitionStalled) return "finalize";
  // A failed turn the turn node judged retryable: the same seat tries again on
  // an unchanged turn count. Checked BEFORE `lastTurn`, which is either null
  // (the opening turn failed) or a stale turn from an earlier exchange —
  // neither says anything about the turn that just failed. This edge cannot
  // loop: a failure the turn node will not retry — the consecutive-failure
  // bound, or a turn that failed after its message was persisted — sets
  // `state.error`, which the check above routes to finalize.
  if (state.consecutiveTurnFailures > 0) return "turn";
  if (!state.lastTurn) return "finalize";
  // Terminal actions: accept, withdraw, or decline.
  if (isTerminalAction(state.lastTurn.action)) return "finalize";
  // question routes same as counter — next turn
  if (isNegotiationTurnCapReached(state.turnCount, state.maxTurns)) return "finalize";
  return "turn";
}
