/**
 * Opportunity Graph: Linear Multi-Step Workflow for Opportunity Discovery
 *
 * Architecture: Follows intent graph pattern with Annotation-based state.
 * Flow: Prep → Scope → Resolve → Discovery → Evaluation → Ranking → Persist → Negotiate → END
 *
 * Key Constraints:
 * - Opportunities only between intents sharing the same index
 * - Both intents must have hyde documents for semantic matching
 * - Non-indexed intents cannot participate in discovery
 *
 * The graph is the discovery pipeline and nothing else. Read, update, delete,
 * send, negotiate_existing, approve_introduction and the introduction path are
 * plain functions in `opportunity.graph.modes.ts` — they never needed a state
 * machine, and routing them through one hid nine single-node paths behind a
 * conditional edge. Every node below is a top-level function taking the state
 * and an explicit {@link OpportunityGraphDeps}.
 *
 * Constructor injects Database, Embedder, and compiled HyDE graph.
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import { OpportunityGraphState } from './opportunity.state.js';
import { OpportunityEvaluator } from "./opportunity.evaluator.js";
import type { OpportunityGraphDatabase } from '../../platform/database.js';
import type { Embedder } from '../../platform/embedder.js';
import type { NegotiationGraphLike } from '../negotiations/negotiation.module.js';
import type { AgentDispatcher } from '../shared/interfaces/agent-dispatcher.interface.js';
import { DISCOVERY_EVALUATOR_MIN_SCORE, DISCOVERY_MIN_SIMILARITY, validateDiscoveryEvaluatorMinScore, validateDiscoveryMinSimilarity } from './discovery.env.js';
import type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";
import type { StampNewbornOpportunitiesFn } from "./opportunity.newborn-stamping.js";
import { routingLog, withNodeTrace, type OpportunityGraphDeps, type OpportunityGraphThresholdOverrides, type OpportunityHydeGenerator, type OpportunityEvaluatorLike, type OpportunityState } from "./opportunity.graph.shared.js";
import { prepNode, prepTraceSummary, resolveNode, resolveTraceSummary, scopeNode, scopeTraceSummary } from "./opportunity.graph.prep.js";
import { discoveryNode, discoveryTraceSummary } from "./opportunity.graph.discovery.js";
import { evaluationNode, rankingNode, rankingTraceSummary } from "./opportunity.graph.evaluation.js";
import { persistNode, persistTraceSummary } from "./opportunity.graph.persist-node.js";
import { negotiateNode } from "./opportunity.graph.negotiate.js";

export type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";
export type { StampNewbornOpportunitiesFn, StampNewbornOpportunitiesInput } from "./opportunity.newborn-stamping.js";
export { buildPrioritizedNegotiationIntents } from "./opportunity.existing-negotiation.js";
export {
  buildDiscovererContext,
  safeOpportunityGraphError,
  type HydeGeneratorInvokeInput,
  type OpportunityEvaluatorLike,
  type OpportunityGraphDeps,
  type OpportunityGraphThresholdOverrides,
} from "./opportunity.graph.shared.js";
import { approveIntroduction, createIntroduction, deleteOpportunity, negotiateExisting, readOpportunities, sendOpportunity, updateOpportunityStatus } from "./opportunity.graph.modes.js";

export {
  approveIntroduction,
  createIntroduction,
  deleteOpportunity,
  evaluateIntroduction,
  negotiateExisting,
  readOpportunities,
  sendOpportunity,
  updateOpportunityStatus,
  validateIntroduction,
  type IntroductionRequest,
  type OpportunityMutationOutcome,
  type OpportunityMutationRequest,
} from "./opportunity.graph.modes.js";

/**
 * Factory class to build and compile the Opportunity Graph.
 * Uses dependency injection for testability.
 *
 * `deps` is public so callers can invoke the non-discovery modes
 * (`readOpportunities`, `sendOpportunity`, …) against the same wiring.
 */
export class OpportunityGraphFactory {
  /** Resolved dependency bag shared by the graph nodes and the standalone modes. */
  public readonly deps: OpportunityGraphDeps;

  constructor(
    database: OpportunityGraphDatabase,
    embedder: Embedder,
    hydeGenerator: OpportunityHydeGenerator,
    optionalEvaluator?: OpportunityEvaluatorLike,
    queueNotification?: QueueOpportunityNotificationFn,
    negotiationGraph?: NegotiationGraphLike,
    /**
     * Used on the chat path to decide whether to wait for the user's personal
     * agent (long timeout) or fall back to the system agent immediately
     * (short timeout). Without it, the chat path always uses a short timeout.
     */
    agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>,
    /**
     * Callback to enqueue a negotiate_existing job for an opportunity.
     * When provided, negotiate_existing mode uses this to queue follow-up
     * negotiations after introducer approval.
     */
    queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>,
    /** Host-side P4b stamper. Omitted by manual/introducer/enrichment roots. */
    stampNewbornOpportunities?: StampNewbornOpportunitiesFn,
    /** Eval/test-only overrides; production composition resolves from environment. */
    thresholdOverrides?: OpportunityGraphThresholdOverrides,
  ) {
    this.deps = {
      database,
      embedder,
      hydeGenerator,
      evaluatorAgent: optionalEvaluator ?? new OpportunityEvaluator(),
      queueNotification,
      negotiationGraph,
      agentDispatcher,
      queueNegotiateExisting,
      stampNewbornOpportunities,
      retrievalMinSimilarity: thresholdOverrides?.retrievalMinSimilarity === undefined
        ? DISCOVERY_MIN_SIMILARITY
        : validateDiscoveryMinSimilarity(thresholdOverrides.retrievalMinSimilarity),
      evaluatorMinScore: thresholdOverrides?.evaluatorMinScore === undefined
        ? DISCOVERY_EVALUATOR_MIN_SCORE
        : validateDiscoveryEvaluatorMinScore(thresholdOverrides.evaluatorMinScore),
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

  /** Promote a latent or draft opportunity to pending. Delegates to {@link sendOpportunity}. */
  public sendOpportunity(request: Parameters<typeof sendOpportunity>[1]) {
    return sendOpportunity(this.deps, request);
  }

  /** Approve an introducer-pattern opportunity. Delegates to {@link approveIntroduction}. */
  public approveIntroduction(request: Parameters<typeof approveIntroduction>[1]) {
    return approveIntroduction(this.deps, request);
  }

  /** Negotiate an existing opportunity. Delegates to {@link negotiateExisting}. */
  public negotiateExisting(request: Parameters<typeof negotiateExisting>[1]) {
    return negotiateExisting(this.deps, request);
  }

  /** Validate → evaluate → persist an introduction. Delegates to {@link createIntroduction}. */
  public createIntroduction(request: Parameters<typeof createIntroduction>[1]) {
    return createIntroduction(this.deps, request);
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
      .addNode('persist', withNodeTrace("opportunity-persist", (s: OpportunityState) => persistNode(s, deps), persistTraceSummary))
      .addNode('negotiate', (s: OpportunityState) => negotiateNode(s, deps))

      .addEdge(START, 'prep')

      // Conditional routing: early exit if no indexed intents
      .addConditionalEdges('prep', shouldContinueAfterPrep, {
        scope: 'scope',
        evaluation: 'evaluation',
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

      // Discovery → Ranking → Persist → Negotiate (post-persist).
      // Fresh and continuation discovery both negotiate newly created/reactivated
      // opportunities. The stage is skipped only when no negotiation graph is wired or
      // persistence produced no negotiation targets (negotiateNode also guards both cases).
      .addEdge('evaluation', 'ranking')
      .addEdge('ranking', 'persist')
      .addConditionalEdges('persist', (state: OpportunityState) => {
        if (!deps.negotiationGraph) return END;
        if (!state.opportunities || state.opportunities.length === 0) return END;
        return 'negotiate';
      }, {
        negotiate: 'negotiate',
        [END]: END,
      })
      .addEdge('negotiate', END)
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
  // Continuation mode: skip scope/resolve/discovery, go straight to evaluation
  if (state.operationMode === 'continue_discovery') {
    routingLog.verbose('Continue discovery → skipping to evaluation', {
      candidatesLoaded: state.candidates.length,
    });
    return 'evaluation';
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
