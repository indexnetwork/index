/**
 * Bilateral negotiation graph: init → screen → turn* → finalize.
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link NegotiationGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph } from "@langchain/langgraph";

import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { NegotiationTimeoutQueue } from "../../shared/interfaces/negotiation-events.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState } from "../domain/negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { blocksNegotiationBeforeFirstTurn, NegotiationScreener } from "./negotiation.screen.js";
import { configuredScreenMode } from "../domain/negotiation.screen.contracts.js";
import { isTerminalAction } from "../domain/negotiation.protocol.js";
import { isNegotiationTurnCapReached } from "../domain/negotiation.turn-cap.js";
import type { QuestionerEnqueueFn } from "../../questions/index.js";
import type { ReflectEnqueueFn } from "./negotiation.reflect.js";
import type { NegotiatorMemoryRetrieveFn } from "../domain/negotiation.memory.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";
import { initNode } from "./negotiation.graph.init.js";
import { screenNode } from "./negotiation.graph.screen.js";
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
    timeoutQueue?: NegotiationTimeoutQueue,
    questionerEnqueue?: QuestionerEnqueueFn,
    reflectEnqueue?: ReflectEnqueueFn,
    memoryRetrieve?: NegotiatorMemoryRetrieveFn,
  ) {
    this.deps = {
      database,
      dispatcher,
      timeoutQueue,
      questionerEnqueue,
      reflectEnqueue,
      memoryRetrieve,
      systemAgent: new IndexNegotiator(),
      screener: new NegotiationScreener(),
    };
  }

  createGraph() {
    const deps = this.deps;

    return new StateGraph(NegotiationGraphState)
      .addNode("init", (state: NegotiationState) => initNode(state, deps))
      .addNode("screen", (state: NegotiationState) => screenNode(state, deps))
      .addNode("turn", (state: NegotiationState) => turnNode(state, deps))
      .addNode("finalize", (state: NegotiationState) => finalizeNode(state, deps))
      .addConditionalEdges("turn", routeAfterTurn, {
        turn: "turn",
        finalize: "finalize",
      })
      .addConditionalEdges("init", routeAfterInit, { screen: "screen", turn: "turn", finalize: "finalize" })
      // P2.2: enforce-mode pass → finalize (screened_out); everything else → turn.
      .addConditionalEdges("screen", routeAfterScreen, { turn: "turn", finalize: "finalize" })
      .addEdge("__start__", "init")
      .addEdge("finalize", "__end__")
      .compile();
  }
}

/** After init: fail closed, run the outreach gate, or go straight to the first turn. */
export function routeAfterInit(state: NegotiationState): string {
  if (state.error) return "finalize";
  // Screen gate: fresh negotiations only (continuations already passed
  // the gate when the dialogue opened); off disables the node entirely.
  // IND-563: regular continuations (new opportunity, existing dm_pair)
  // also run through the screen gate so stale matches are caught before
  // re-engaging the counterparty. Exact ask_user resumes
  // (continuationExecution) are mid-flight and must never be re-screened.
  if (configuredScreenMode() !== "off" && !state.continuationExecution) return "screen";
  return "turn";
}

/** After the outreach gate: an enforced pass ends the negotiation before any turn. */
export function routeAfterScreen(state: NegotiationState): string {
  return blocksNegotiationBeforeFirstTurn(state.screenDecision, state.turnCount) ? "finalize" : "turn";
}

/** After a turn: keep going, or settle. */
export function routeAfterTurn(state: NegotiationState): string {
  if (state.status === 'waiting_for_agent') return "finalize";
  if (state.status === 'input_required') return "finalize";
  if (state.error) return "finalize";
  if (!state.lastTurn) return "finalize";
  // Terminal actions: accept (v1+v2), reject (v1), withdraw/decline (v2)
  if (isTerminalAction(state.lastTurn.action)) return "finalize";
  // question routes same as counter — next turn
  if (isNegotiationTurnCapReached(state.turnCount, state.maxTurns)) return "finalize";
  return "turn";
}
