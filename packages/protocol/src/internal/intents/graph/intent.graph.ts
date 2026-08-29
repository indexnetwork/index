/**
 * Intent graph: prep → (query | inference → verification → reconciler → executor).
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link IntentGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { ExplicitIntentInferrer } from "../intent.inferrer.js";
import { SemanticVerifier } from "../intent.verifier.js";
import { IntentReconciler } from "../intent.reconciler.js";
import type { IntentGraphDatabase } from "../../../platform/database.js";
import type { EmbeddingGenerator } from "../../../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../../../platform/runtime/follow-up.js";
import { IntentGraphState } from "./intent.graph.state.js";
import { logger, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";
import { inferenceNode, prepNode } from "./intent.graph.infer.js";
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
      reconciler?: Pick<IntentReconciler, 'invoke'>;
    },
  ) {
    this.deps = {
      database,
      embedder,
      intentFollowUp,
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

      // The graph routes on the shape of its input (see intent.graph.state.ts):
      // - READ:      no content/target/proposal → prep → query → END (no LLM calls)
      // - CREATE:    inputContent only → prep → inference → verification → reconciler → executor → END
      // - UPDATE:    inputContent + targetIntentIds → same pipeline, bound to that one target
      // - ARCHIVE:   targetIntentIds + archive → prep → reconciler → executor → END (no LLM)
      // - TRANSITION: targetIntentIds + status → prep → reconciler → executor → END (no LLM)
      // - CONFIRM:   proposalId → prep → reconciler → executor → END (no LLM)
      // - dryRun:true on CREATE/UPDATE stops after verification (no reconciliation/execution, no writes)
      .addEdge(START, "prep")

      // After prep: read → query; archive/status/proposal → reconciler directly; else content path → inference
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
     * After prep: an invalid input shape or a failed precondition ends the
     * graph; a fully-empty input is a read; archive/status/proposalId skip
     * straight to the reconciler (no LLM); otherwise the content path infers.
     */
export function afterPrepRoute(state: IntentState): string {
  if (state.error) {
    logger.warn('Prep failed with error, short-circuiting to END', { error: state.error });
    return '__end__';
  }
  const hasContent = state.inputContent !== undefined;
  const hasArchive = state.archive === true;
  const hasStatus = state.status !== undefined;
  const hasProposal = state.proposalId !== undefined;

  if (!hasContent && !hasArchive && !hasStatus && !hasProposal) {
    logger.verbose('No content/target/proposal - routing to query (read fast path)');
    return 'query';
  }
  if (hasArchive || hasStatus || hasProposal) {
    logger.verbose('Deterministic route (archive/status/confirm) - skipping inference');
    return 'reconciler';
  }
  logger.verbose('Content path - running inference');
  return 'inference';
}

    /**
     * Determines if verification should run. Skipped when inference produced
     * no candidates: a dry run ends there; otherwise the (empty) reconciler
     * pass still runs so the graph reports "nothing to do" consistently.
     */
export function shouldRunVerification(state: IntentState): string {
  if (state.inferredIntents.length === 0) {
    if (state.dryRun) {
      logger.verbose('Dry run with no inferred intents - exiting early');
      return '__end__';
    }
    logger.verbose('No intents to verify - skipping verification, routing to reconciliation');
    return 'reconciler';
  }
  return 'verification';
}

/** After verification: a dry run exits early; otherwise continue to reconciliation. */
export function routeAfterVerification(state: IntentState): string {
  if (state.dryRun) {
    logger.verbose('Dry run - stopping after verification, skipping reconciliation');
    return '__end__';
  }
  return 'reconciler';
}
