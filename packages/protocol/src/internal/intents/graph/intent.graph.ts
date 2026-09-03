/**
 * Intent graph: prep → (query | inference → verification → reconciler → executor).
 *
 * Every node is a top-level function in a sibling module, taking the graph
 * state and an explicit {@link IntentGraphDeps}. This file composes the
 * dependency bag and wires the edges — nothing else.
 */

import { ExplicitIntentInferrer } from "../intent.inferrer.js";
import { SemanticVerifier } from "../intent.verifier.js";
import { IntentReconciler } from "../intent.reconciler.js";
import type { IntentGraphDatabase } from "../../../platform/database.js";
import type { EmbeddingGenerator } from "../../../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../../../platform/runtime/follow-up.js";
import { intentDefaults } from "./intent.graph.state.js";
import { mergeGraphState } from "../../shared/graph.state.js";
import { logger, type IntentGraphDeps, type IntentInput, type IntentState } from "./intent.graph.shared.js";
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

    // The graph routes on the shape of its input (see intent.graph.state.ts):
    // - READ:      no content/target/proposal → prep → query (no LLM calls)
    // - CREATE:    inputContent only → prep → inference → verification → reconciler → executor
    // - UPDATE:    inputContent + targetIntentIds → same pipeline, bound to that one target
    // - ARCHIVE:   targetIntentIds + archive → prep → reconciler → executor (no LLM)
    // - TRANSITION: targetIntentIds + status → prep → reconciler → executor (no LLM)
    // - CONFIRM:   proposalId → prep → reconciler → executor (no LLM)
    // - dryRun:true on CREATE/UPDATE stops after verification (no reconciliation/execution, no writes)
    return {
      /** Runs the lifecycle and returns the full state, defaults included. */
      async invoke(input: IntentInput): Promise<IntentState> {
        let state: IntentState = { ...intentDefaults(), ...input };
        state = mergeGraphState(state, await prepNode(state, deps));

        // After prep: read → query; archive/status/proposal → reconciler
        // directly; else the content path infers.
        switch (afterPrepRoute(state)) {
          case '__end__':
            return state;
          case 'query':
            return mergeGraphState(state, await queryNode(state, deps));
          case 'reconciler':
            break;
          default: {
            state = mergeGraphState(state, await inferenceNode(state, deps));
            // Verification is skipped when inference produced no candidates.
            const afterInference = shouldRunVerification(state);
            if (afterInference === '__end__') return state;
            if (afterInference === 'verification') {
              state = mergeGraphState(state, await verificationNode(state, deps));
              // A dry run stops here: no reconciliation, no writes.
              if (routeAfterVerification(state) === '__end__') return state;
            }
            break;
          }
        }

        state = mergeGraphState(state, await reconciliationNode(state, deps));
        return mergeGraphState(state, await executorNode(state, deps));
      },
    };
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
