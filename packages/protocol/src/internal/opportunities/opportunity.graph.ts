/**
 * Opportunity Graph: Linear Multi-Step Workflow for Opportunity Discovery
 *
 * Architecture: Follows intent graph pattern with Annotation-based state.
 * Flow: Prep → Scope → Resolve → Discovery → Evaluation → Ranking → EmitCandidates → MatchesReady → END
 *
 * Key Constraints:
 * - Opportunities only between intents sharing the same index
 * - Both intents must have hyde documents for semantic matching
 * - Non-indexed intents cannot participate in discovery
 *
 * The graph is the discovery pipeline and nothing else. Read, update, delete,
 * are plain functions in `opportunity.graph.modes.ts` — they never needed a state
 * machine, and routing them through one hid nine single-node paths behind a
 * conditional edge. Every node below is a top-level function taking the state
 * and an explicit {@link OpportunityGraphDeps}.
 *
 * Constructor injects Database, Embedder, and compiled HyDE graph.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { OpportunityGraphState } from './opportunity.state.js';
import { MatchExplainer } from "./opportunity.match-explainer.js";
import type { MatchExplainerLike } from "./opportunity.match-explainer.js";
import type { OpportunityGraphDatabase } from '../../platform/database.js';
import type { Embedder } from '../../platform/discovery/embedder.js';
import type { MatchesReadyFn } from "./opportunity.graph.shared.js";
import type { AgentDispatcher } from '../shared/interfaces/agent-dispatcher.interface.js';
import { DISCOVERY_MIN_SIMILARITY, validateDiscoveryMinSimilarity } from './discovery.env.js';
import type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";
import { routingLog, withNodeTrace, type OpportunityGraphDeps, type OpportunityGraphThresholdOverrides, type OpportunityHydeGenerator, type OpportunityState } from "./opportunity.graph.shared.js";
import { prepNode, prepTraceSummary, resolveNode, resolveTraceSummary, scopeNode, scopeTraceSummary } from "./opportunity.graph.prep.js";
import { discoveryNode, discoveryTraceSummary } from "./opportunity.graph.discovery.js";
import { evaluationNode, rankingNode, rankingTraceSummary } from "./opportunity.graph.evaluation.js";
import { emitCandidatesNode, emitCandidatesTraceSummary } from "./opportunity.graph.emit-candidates.js";
import { matchesReadyNode } from "./opportunity.graph.matches-ready.js";

export type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";
export {
  buildDiscovererContext,
  safeOpportunityGraphError,
  type HydeGeneratorInvokeInput,
  type OpportunityGraphDeps,
  type OpportunityGraphThresholdOverrides,
} from "./opportunity.graph.shared.js";
import { deleteOpportunity, readOpportunities, updateOpportunityStatus } from "./opportunity.graph.modes.js";

export {
  deleteOpportunity,
  readOpportunities,
  updateOpportunityStatus,
  type OpportunityMutationOutcome,
  type OpportunityMutationRequest,
} from "./opportunity.graph.modes.js";

/**
 * Factory class to build and compile the Opportunity Graph.
 * Uses dependency injection for testability.
 *
 * `deps` is public so callers can invoke the non-discovery modes
 * (`readOpportunities`, `updateOpportunityStatus`, …) against the same wiring.
 */
export class OpportunityGraphFactory {
  /** Resolved dependency bag shared by the graph nodes and the standalone modes. */
  public readonly deps: OpportunityGraphDeps;

  constructor(
    database: OpportunityGraphDatabase,
    embedder: Embedder,
    hydeGenerator: OpportunityHydeGenerator,
    /** Optional test double for the discovery-path match explainer (positional slot kept for existing call sites). */
    optionalMatchExplainer?: MatchExplainerLike,
    queueNotification?: QueueOpportunityNotificationFn,
    matchesReady?: MatchesReadyFn,
    /**
     * Used on the chat path to decide whether to wait for the user's personal
     * agent (long timeout) or fall back to the system agent immediately
     * (short timeout). Without it, the chat path always uses a short timeout.
     */
    agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>,
    /** Eval/test-only overrides; production composition resolves from environment. */
    thresholdOverrides?: OpportunityGraphThresholdOverrides,
  ) {
    this.deps = {
      database,
      embedder,
      hydeGenerator,
      matchExplainer: optionalMatchExplainer ?? new MatchExplainer(),
      queueNotification,
      matchesReady,
      agentDispatcher,
      retrievalMinSimilarity: thresholdOverrides?.retrievalMinSimilarity === undefined
        ? DISCOVERY_MIN_SIMILARITY
        : validateDiscoveryMinSimilarity(thresholdOverrides.retrievalMinSimilarity),
    };
  }

  /** List the caller's opportunities. Delegates to {@link readOpportunities}. */
  public readOpportunities(request: Parameters<typeof readOpportunities>[1]) {
    return readOpportunities(this.deps, request);
  }

  /** Change an opportunity's status. Delegates to {@link updateOpportunityStatus}. */
  public updateOpportunityStatus(request: Parameters<typeof updateOpportunityStatus>[1]) {
    return updateOpportunityStatus(this.deps, request);
  }

  /** Expire an opportunity. Delegates to {@link deleteOpportunity}. */
  public deleteOpportunity(request: Parameters<typeof deleteOpportunity>[1]) {
    return deleteOpportunity(this.deps, request);
  }

  public createGraph() {
    const deps = this.deps;

    return new StateGraph(OpportunityGraphState)
      .addNode('prep', withNodeTrace("opportunity-prep", (s: OpportunityState) => prepNode(s, deps), prepTraceSummary))
      .addNode('scope', withNodeTrace("opportunity-scope", (s: OpportunityState) => scopeNode(s, deps), scopeTraceSummary))
      .addNode('resolve', withNodeTrace("opportunity-resolve", (s: OpportunityState) => resolveNode(s, deps), resolveTraceSummary))
      .addNode('discovery', withNodeTrace("opportunity-discovery", (s: OpportunityState) => discoveryNode(s, deps), discoveryTraceSummary))
      .addNode('evaluation', (s: OpportunityState) => evaluationNode(s, deps))
      .addNode('ranking', withNodeTrace("opportunity-ranking", (s: OpportunityState) => rankingNode(s), rankingTraceSummary))
      .addNode('emitCandidates', withNodeTrace("opportunity-emit-candidates", (s: OpportunityState) => emitCandidatesNode(s, deps), emitCandidatesTraceSummary))
      .addNode('matchesReady', (s: OpportunityState) => matchesReadyNode(s, deps))

      .addEdge(START, 'prep')

      // Conditional routing: early exit if no indexed intents
      .addConditionalEdges('prep', shouldContinueAfterPrep, {
        scope: 'scope',
        [END]: END,
      })

      // Conditional routing: early exit if no target indexes
      .addConditionalEdges('scope', shouldContinueAfterScope, {
        resolve: 'resolve',
        [END]: END,
      })
      .addEdge('resolve', 'discovery')

      .addConditionalEdges('discovery', shouldContinueAfterDiscovery, {
        evaluation: 'evaluation',
        [END]: END,
      })

      // Discovery → Ranking → EmitCandidates → matches_ready. The stage is
      // skipped only when no host callback is wired or the run recorded no
      // candidates (matchesReadyNode guards both cases too).
      //
      // Nothing here INSERTs an opportunity. That happens at kickoff, in
      // createAndOpen, when a principal's agent decides to reach out.
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'emitCandidates')
      .addConditionalEdges('emitCandidates', (state: OpportunityState) => {
        if (!deps.matchesReady) return END;
        if (!state.candidatesEmitted || state.candidatesEmitted.length === 0) return END;
        return 'matchesReady';
      }, {
        matchesReady: 'matchesReady',
        [END]: END,
      })
      .addEdge('matchesReady', END)
      .compile();
  }
}

/**
 * After prep: check if user has indexed intents.
 * Early exit if none (cannot find opportunities).
 */
function shouldContinueAfterPrep(state: OpportunityState): string {
  if (state.error) {
    routingLog.verbose('Error in prep - ending early');
    return END;
  }
  routingLog.verbose('Continuing to scope');
  return 'scope';
}

/**
 * After scope: check if we have target indexes.
 */
function shouldContinueAfterScope(state: OpportunityState): string {
  if (state.error || state.targetNetworks.length === 0) {
    routingLog.verbose('No target indexes - ending early');
    return END;
  }
  routingLog.verbose('Continuing to resolve');
  return 'resolve';
}

/**
 * After discovery: if create-intent signal was set, end so tool can return it; else continue to evaluation.
 */
function shouldContinueAfterDiscovery(state: OpportunityState): string {
  if (state.createIntentSuggested) {
    routingLog.verbose('Create-intent suggested - ending for tool signal');
    return END;
  }
  return 'evaluation';
}
