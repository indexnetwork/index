/**
 * Bilateral negotiation graph: init → screen → turn* → finalize.
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link NegotiationGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph } from "@langchain/langgraph";

import type { NegotiationGraphDatabase } from "../shared/interfaces/database.interface.js";
import type { NegotiationTimeoutQueue } from "../shared/interfaces/negotiation-events.interface.js";
import type { AgentDispatcher } from "../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState } from "./negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { NegotiationStallGapAuthor } from "./negotiation.stall-gap.js";
import { blocksNegotiationBeforeFirstTurn, NegotiationScreener } from "./negotiation.screen.js";
import { configuredScreenMode, negotiationHasMadeContact } from "./negotiation.screen.contracts.js";
import { isTerminalAction } from "./negotiation.protocol.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import type { QuestionerEnqueueFn } from "../questions/question.module.js";
import type { ReflectEnqueueFn } from "./negotiation.reflect.js";
import type { NegotiatorMemoryRetrieveFn } from "./negotiation.memory.js";
import type { NegotiatorClientDmRetrieveFn } from "./negotiation.client-dm.js";
import { turnsFromMessages } from "./negotiation.graph.shared.js";
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
    clientDmRetrieve?: NegotiatorClientDmRetrieveFn,
  ) {
    this.deps = {
      database,
      dispatcher,
      timeoutQueue,
      questionerEnqueue,
      reflectEnqueue,
      memoryRetrieve,
      clientDmRetrieve,
      systemAgent: new IndexNegotiator(),
      stallGapAuthor: new NegotiationStallGapAuthor(),
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
  // Screen gate: PRE-CONTACT runs only; off disables the node entirely.
  //
  // IND-563: a new opportunity reusing an existing dm_pair still runs the gate
  // — it has sent nothing of its own, so stale matches are caught before the
  // counterparty is re-engaged. Its scope is what makes that safe: init seeds
  // `messages` from THIS negotiation's turns, so the pair's earlier matches do
  // not read as contact here.
  //
  // Exact ask_user resumes (continuationExecution) are mid-flight and must
  // never be re-screened.
  //
  // A negotiation that has already spoken is not screened at all. The gate
  // decides whether to make first contact; once contact exists the question is
  // settled, and asking it again lets an infrastructure recovery
  // (`negotiation-run-existing` on an error-stalled run) end a live negotiation
  // as `screened_out` — the counterparty never answering an outreach it had
  // already received.
  if (
    configuredScreenMode() !== "off"
    && !state.continuationExecution
    && !negotiationHasMadeContact(turnsFromMessages(state.messages))
  ) return "screen";
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
  // Terminal actions: accept (v1+v2), reject (v1), withdraw/decline (v2)
  if (isTerminalAction(state.lastTurn.action)) return "finalize";
  // question routes same as counter — next turn
  if (isNegotiationTurnCapReached(state.turnCount, state.maxTurns)) return "finalize";
  return "turn";
}
