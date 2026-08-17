/**
 * Intent graph: prep → (query | inference → verification → reconciler → executor).
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link IntentGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { ExplicitIntentInferrer } from "../inference/intent.inferrer.js";
import { SemanticVerifier } from "../verification/intent.verifier.js";
import { IntentReconciler } from "../inference/intent.reconciler.js";
import type { IntentGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { EmbeddingGenerator } from "../../shared/interfaces/embedder.interface.js";
import type { IntentGraphQueue } from "../../shared/interfaces/queue.interface.js";
import type { QuestionerEnqueueFn } from "../../questions/index.js";
import { IntentGraphState } from "./intent.graph.state.js";
import { logger, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";
import { inferenceNode, prepNode } from "./intent.graph.infer.js";
import { reconciliationNode, verificationNode } from "./intent.graph.reconcile.js";
import { executorNode, queryNode } from "./intent.graph.execute.js";

export { buildExplicitUpdateActions, enforceIntentActionBoundary } from "./intent.graph.shared.js";
export type { IntentGraphDeps, IntentState } from "./intent.graph.shared.js";

export class IntentGraphFactory {
  /** Resolved dependency bag shared by every node. */
  public readonly deps: IntentGraphDeps;

  constructor(
    database: IntentGraphDatabase,
    embedder?: EmbeddingGenerator,
    intentQueue?: IntentGraphQueue,
    questionerEnqueue?: QuestionerEnqueueFn,
    agents?: {
      inferrer?: Pick<ExplicitIntentInferrer, 'invoke'>;
      verifier?: Pick<SemanticVerifier, 'invoke'>;
      reconciler?: Pick<IntentReconciler, 'invoke'>;
    },
  ) {
    this.deps = {
      database,
      embedder,
      intentQueue,
      questionerEnqueue,
      inferrer: agents?.inferrer ?? new ExplicitIntentInferrer(),
      verifier: agents?.verifier ?? new SemanticVerifier(),
      reconciler: agents?.reconciler ?? new IntentReconciler(),
    };
  }

  public createGraph() {
    const deps = this.deps;

    return new StateGraph(IntentGraphState)
      .addNode("prep", (state: IntentState) => prepNode(state, deps))
      .addNode("query", (state: IntentState) => queryNode(state, deps))
      .addNode("inference", (state: IntentState) => inferenceNode(state, deps))
      .addNode("verification", (state: IntentState) => verificationNode(state, deps))
      .addNode("reconciler", (state: IntentState) => reconciliationNode(state, deps))
      .addNode("executor", (state: IntentState) => executorNode(state, deps))

      // Flow paths:
      // - READ:    prep → query → END (fast path, no LLM calls)
      // - CREATE:  prep → inference → verification → reconciler → executor → END
      // - UPDATE:  prep → inference → reconciliation → executor → END (skips verification if no new intents)
      // - DELETE:  prep → reconciliation → executor → END (skips inference and verification)
      // - PROPOSE: prep → inference → verification → END (no reconciliation/execution, no DB writes)
      .addEdge(START, "prep")

      // After prep: read mode → query; else inference or reconciler
      .addConditionalEdges("prep", afterPrepRoute, {
        query: "query",
        inference: "inference",
        reconciler: "reconciler",
        __end__: END,
      })

      // Query (read mode) always ends
      .addEdge("query", END)

      // After inference: decide if we need verification (skip if no intents)
      .addConditionalEdges("inference", shouldRunVerification, {
        verification: "verification",
        reconciler: "reconciler",
        __end__: END,
      })

      // After verification: propose mode exits early; others continue to reconciliation
      .addConditionalEdges("verification", routeAfterVerification, {
        reconciler: "reconciler",
        __end__: END,
      })

      // Reconciliation always goes to executor
      .addEdge("reconciler", "executor")

      // Executor is always the end
      .addEdge("executor", END)
      .compile();
  }
}

    /**
     * After prep: read mode → query; otherwise decide inference vs reconciler by operation mode.
     */
export function afterPrepRoute(state: IntentState): string {
  if (state.error) {
    logger.warn('Prep failed with error, short-circuiting to END', { error: state.error });
    return '__end__';
  }
  if (state.operationMode === 'read') {
    logger.verbose('Read mode - routing to query (fast path)');
    return 'query';
  }
  return shouldRunInference(state);
}


    /**
     * Determines if inference should run based on operation mode.
     * Delete operations skip inference entirely and go straight to reconciliation.
     */
export function shouldRunInference(state: IntentState): string {
  if (state.operationMode === 'delete') {
    logger.verbose('Delete mode - skipping inference, routing to reconciliation');
    return 'reconciler';
  }

  logger.verbose('Running inference', {
    operationMode: state.operationMode
  });
  return 'inference';
}

    /**
     * Determines if verification should run based on operation mode and inferred intents.
     * Skips verification for:
     * - Operations with no inferred intents
     * - Can be extended to skip for update operations with no new intents
     */
export function shouldRunVerification(state: IntentState): string {
  if (state.inferredIntents.length === 0) {
    if (state.operationMode === 'propose') {
      logger.verbose('Propose mode with no inferred intents - exiting early');
      return '__end__';
    }
    logger.verbose('No intents to verify - skipping verification, routing to reconciliation');
    return 'reconciler';
  }

  if (state.operationMode === 'update') {
    logger.verbose('Update mode with new intents - running verification');
    return 'verification';
  }

  if (state.operationMode === 'create') {
    logger.verbose('Create mode - running verification');
    return 'verification';
  }

  // Default to verification for safety
  logger.verbose('Default routing to verification');
  return 'verification';
}

/** After verification: propose mode exits early; others continue to reconciliation. */
export function routeAfterVerification(state: IntentState): string {
  if (state.operationMode === 'propose') {
    logger.verbose('Propose mode - stopping after verification, skipping reconciliation');
    return '__end__';
  }
  return 'reconciler';
}
