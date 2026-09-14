/**
 * Intent graph: prepare/create, or explicitly read, update, archive, and transition.
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link IntentGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { ExplicitIntentInferrer } from "../intent.inferrer.js";
import { SemanticVerifier } from "../intent.verifier.js";
import { IntentClarifier } from "../intent.clarifier.js";
import type { IntentGraphDatabase } from "../../../platform/database.js";
import type { EmbeddingGenerator } from "../../../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../../../platform/runtime/follow-up.js";
import { IntentGraphState } from "./intent.graph.state.js";
import { logger, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";
import { inferenceNode, preparationNode, prepNode } from "./intent.graph.infer.js";
import { reconciliationNode, verificationNode } from "./intent.graph.reconcile.js";
import { executorNode, queryNode } from "./intent.graph.execute.js";

export { buildExplicitUpdateActions, enforceIntentActionBoundary, isExplicitUpdateRequest } from "./intent.graph.shared.js";
export type { IntentGraphDeps, IntentState } from "./intent.graph.shared.js";

export class IntentGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: IntentGraphDeps;

  constructor(
    database: IntentGraphDatabase,
    embedder?: EmbeddingGenerator,
    intentFollowUp?: IntentFollowUp,
    agents?: {
      inferrer?: Pick<ExplicitIntentInferrer, 'invoke'>;
      verifier?: Pick<SemanticVerifier, 'invoke'>;
    },
  ) {
    this.deps = {
      database,
      embedder,
      intentFollowUp,
      inferrer: agents?.inferrer ?? new ExplicitIntentInferrer(),
      verifier: agents?.verifier ?? new SemanticVerifier(),
      clarifier: new IntentClarifier(agents?.verifier),
    };
  }

  public createGraph() {
    const deps = this.deps;

    return new StateGraph(IntentGraphState)
      .addNode("prep", (state: IntentState) => prepNode(state, deps))
      .addNode("prepareCreation", (state: IntentState) => preparationNode(state, deps))
      .addNode("query", (state: IntentState) => queryNode(state, deps))
      .addNode("inference", (state: IntentState) => inferenceNode(state, deps))
      .addNode("verification", (state: IntentState) => verificationNode(state, deps))
      .addNode("reconciler", (state: IntentState) => reconciliationNode(state))
      .addNode("executor", (state: IntentState) => executorNode(state, deps))

      // The graph routes on the shape of its input (see intent.graph.state.ts):
      // - READ:      no content/target → prep → query → END (no LLM calls)
      // - CREATE:    inputContent only → prep → preparation → executor → END
      // - UPDATE:    inputContent + targetIntentIds → prep → inference → verification → reconciler → executor
      // - ARCHIVE:   targetIntentIds + archive → prep → reconciler → executor → END (no LLM)
      // - TRANSITION: targetIntentIds + status → prep → reconciler → executor → END (no LLM)
      .addEdge(START, "prep")

      // Create prepares once; update infers; read/archive/status need no models.
      .addConditionalEdges("prep", afterPrepRoute, {
        query: "query",
        inference: "inference",
        prepareCreation: "prepareCreation",
        reconciler: "reconciler",
        __end__: END,
      })

      // Query (read mode) always ends
      .addEdge("query", END)
      .addEdge("prepareCreation", "executor")

      // After inference: decide if we need verification (skip if no intents)
      .addConditionalEdges("inference", shouldRunVerification, {
        verification: "verification",
        reconciler: "reconciler",
      })

      // Verification always continues to reconciliation
      .addEdge("verification", "reconciler")

      // Reconciliation always goes to executor
      .addEdge("reconciler", "executor")

      // Executor is always the end
      .addEdge("executor", END)
      .compile();
  }
}

    /**
     * After prep: an invalid input shape or a failed precondition ends the
     * graph; a fully-empty input is a read; archive/status skip straight to
     * the reconciler (no LLM); otherwise the content path infers.
     */
export function afterPrepRoute(state: IntentState): string {
  if (state.error) {
    logger.warn('Prep failed with error, short-circuiting to END', { error: state.error });
    return '__end__';
  }
  const hasContent = state.inputContent !== undefined;
  const hasArchive = state.archive === true;
  const hasStatus = state.status !== undefined;

  if (!hasContent && !hasArchive && !hasStatus) {
    logger.verbose('No content/target - routing to query (read fast path)');
    return 'query';
  }
  if (hasArchive || hasStatus) {
    logger.verbose('Deterministic route (archive/status) - skipping inference');
    return 'reconciler';
  }
  if (!state.targetIntentIds?.length) return 'prepareCreation';
  logger.verbose('Explicit update - running inference');
  return 'inference';
}

    /**
     * Determines if verification should run. Skipped when inference produced
     * no candidates: the (empty) reconciler pass still runs so the graph
     * reports "nothing to do" consistently.
     */
export function shouldRunVerification(state: IntentState): string {
  if (state.inferredIntents.length === 0) {
    logger.verbose('No intents to verify - skipping verification, routing to reconciliation');
    return 'reconciler';
  }
  return 'verification';
}
