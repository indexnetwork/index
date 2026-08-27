/**
 * Shared vocabulary for the opportunity graph's nodes and modes.
 *
 * The nodes used to be closures inside `OpportunityGraphFactory.createGraph()`,
 * capturing `this` and the resolved thresholds. They are now top-level functions
 * that take an explicit {@link OpportunityGraphDeps} bag, so each node is
 * readable — and testable — on its own. This module owns the pieces more than
 * one of them needs: the dependency bag, the loggers, the trace wrapper, and the
 * small pure helpers.
 */

import type { Id } from '../../platform/database.js';
import { OpportunityGraphState, type IndexedIntent, type SourceProfileData, type CandidateMatch } from './opportunity.state.js';
import type { EvaluatorEntity } from "./opportunity.match-explainer.js";
import type { MatchExplainerLike } from "./opportunity.match-explainer.js";
import type { OpportunityGraphDatabase, Opportunity } from '../../platform/database.js';
import type { Embedder } from '../../platform/discovery/embedder.js';
import type { AgentDispatcher } from '../shared/interfaces/agent-dispatcher.interface.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { renderNetworkContext } from '../shared/network/metadata.renderer.js';
import { requestContext } from '../shared/observability/request-context.js';
import type { QueueOpportunityNotificationFn } from "./opportunity.lifecycle.js";

/** Host callback that wakes a signal's PersonalAgent with `matches_ready`. */
export type MatchesReadyFn = (input: { userId: string; intentId: string }) => Promise<void>;

/** The graph's channel state, as every node sees it. */
export type OpportunityState = typeof OpportunityGraphState.State;

/** Input shape for the HyDE graph invoke call (query-based embedding). */
export interface HydeGeneratorInvokeInput {
  sourceType: 'query';
  sourceText: string;
  forceRegenerate?: boolean;
  profileContext?: string;
}

/** The compiled HyDE graph, as the discovery node consumes it. */
export interface OpportunityHydeGenerator {
  invoke: (input: HydeGeneratorInvokeInput) => Promise<{
    hydeEmbeddings: Record<string, number[]>;
    lenses?: Array<{ label: string; corpus: 'profiles' | 'intents' | 'premises' }>;
    hydeDocuments?: Record<string, { hydeText?: string; lens?: string }>;
  }>;
}

export interface OpportunityGraphThresholdOverrides {
  retrievalMinSimilarity?: number;
}

/**
 * Everything the nodes and modes reach for. Composed once by
 * `OpportunityGraphFactory` and passed to each function explicitly.
 */
export interface OpportunityGraphDeps {
  database: OpportunityGraphDatabase;
  embedder: Embedder;
  hydeGenerator: OpportunityHydeGenerator;
  /** Resolved match explainer: the injected test double, or a real `MatchExplainer`. Used by discovery-path evaluation. */
  matchExplainer: MatchExplainerLike;
  queueNotification?: QueueOpportunityNotificationFn;
  /**
   * Emits `matches_ready` for a signal that just got matches. Discovery never
   * opens a negotiation itself; the signal's PersonalAgent decides.
   */
  matchesReady?: MatchesReadyFn;
  /**
   * Used on the chat path to decide whether to wait for the user's personal
   * agent (long timeout) or fall back to the system agent immediately
   * (short timeout). Without it, the chat path always uses a short timeout.
   */
  agentDispatcher?: Pick<AgentDispatcher, 'hasExternalAgent'>;
  retrievalMinSimilarity: number;
}

export const logger = protocolLogger('OpportunityGraph');
export const prepLog = protocolLogger('OpportunityGraph:Prep');
export const scopeLog = protocolLogger('OpportunityGraph:Scope');
export const resolveLog = protocolLogger('OpportunityGraph:Resolve');
export const discoveryLog = protocolLogger('OpportunityGraph:Discovery');
export const evaluationLog = protocolLogger('OpportunityGraph:Evaluation');
export const matchesReadyLog = protocolLogger('OpportunityGraph:MatchesReady');
export const rankingLog = protocolLogger('OpportunityGraph:Ranking');
export const introValidationLog = protocolLogger('OpportunityGraph:IntroValidation');
export const introEvaluationLog = protocolLogger('OpportunityGraph:IntroEvaluation');
export const persistLog = protocolLogger('OpportunityGraph:Persist');
export const persistPathLog = protocolLogger('OpportunityGraph:Persist:PathSelect');
export const persistDedupLog = protocolLogger('OpportunityGraph:Persist:Dedup');
export const readLog = protocolLogger('OpportunityGraph:Read');
export const updateLog = protocolLogger('OpportunityGraph:Update');
export const deleteLog = protocolLogger('OpportunityGraph:Delete');
export const sendLog = protocolLogger('OpportunityGraph:Send');
export const negotiateExistingLog = protocolLogger('OpportunityGraph:NegotiateExisting');
export const routingLog = protocolLogger('OpportunityGraph:Routing');

/**
 * Error text can include provider response bodies, URLs, and credentials. Keep
 * observability useful by retaining only a conservative error class at this
 * boundary; detailed errors are intentionally not emitted from graph traces.
 */
export function safeOpportunityGraphError(_error: unknown): string {
  return 'OpportunityEvaluationError: [redacted]';
}

/**
 * Wraps a graph node function to emit agent_start/agent_end trace events
 * at its boundaries so the frontend TRACE panel shows real-time progress.
 * @param traceName - Kebab-case agent name (e.g. "opportunity-prep")
 * @param nodeFn - The original node function
 * @param summaryFn - Optional function to derive a summary string from the node result
 */
export function withNodeTrace<S, R>(
  traceName: string,
  nodeFn: (state: S) => Promise<R>,
  summaryFn?: (result: R) => string | undefined,
): (state: S) => Promise<R> {
  return async (state: S) => {
    const traceEmitter = requestContext.getStore()?.traceEmitter;
    const nodeStart = Date.now();
    traceEmitter?.({ type: "agent_start", name: traceName });
    try {
      const result = await nodeFn(state);
      const durationMs = Date.now() - nodeStart;
      const summary = summaryFn?.(result) ?? undefined;
      traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary });
      return result;
    } catch (err) {
      const durationMs = Date.now() - nodeStart;
      const errMsg = safeOpportunityGraphError(err);
      traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary: `error: ${errMsg}` });
      throw err;
    }
  };
}

/** Shared trace summary: surface `error` when a node returned one. */
export function errorSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown> | null | undefined;
  return r?.error ? `error: ${r.error}` : undefined;
}

/** Time window for persist-node dedup. Suppresses a second opportunity with the same person while a recent one (within 30 days) is still in flight, so a person is not re-surfaced multiple times within a month (EDG-23). */
export const DEDUP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ACTIVE_NEGOTIATION_TASK_STATES = new Set(['working', 'paused']);
const ACTIVE_NEGOTIATION_TASK_FRESHNESS_MS = 5 * 60 * 1000;

export function isActiveNegotiationTaskFresh(task: { state: string; updatedAt: Date }): boolean {
  if (!ACTIVE_NEGOTIATION_TASK_STATES.has(task.state)) return false;
  return Date.now() - new Date(task.updatedAt).getTime() < ACTIVE_NEGOTIATION_TASK_FRESHNESS_MS;
}

export function triggerForOwner(opportunity: Opportunity, ownerUserId: string): string | undefined {
  return opportunity.detection.triggeredBy
    ?? opportunity.actors.find((actor) => actor.userId === ownerUserId)?.intent;
}

export function belongsToOwnedIntent(
  opportunity: Opportunity,
  ownerUserId: string,
  triggerIntentId: string,
): boolean {
  return opportunity.detection.triggeredBy === triggerIntentId
    || opportunity.actors.some((actor) =>
      actor.userId === ownerUserId && actor.intent === triggerIntentId);
}

/**
 * IND-567: Cool-down window (ms) for cross-query rejection suppression.
 * Candidates with a recently rejected or stalled opportunity within this window
 * receive a similarity penalty during evaluation ranking. 7 days.
 */
export const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Similarity multiplier applied to candidates that fall within the rejection
 * cool-down window (IND-567). 0.5 halves their ranking score, typically
 * pushing them below the evaluation-batch cut while leaving a soft trace in
 * the trace log rather than silently dropping them.
 */
export const REJECTION_COOLDOWN_SIMILARITY_PENALTY = 0.5;

/** Default cap for source premises used by premise-to-premise discovery. Prevents BACKEND-5-style fan-out. */

/** NUL separator: it cannot occur inside an id, so the composite key is unambiguous. */
const PAIR_KEY_SEPARATOR = String.fromCharCode(0);

export function networkMembershipPairKey(userId: string, networkId: string): string {
  return userId + PAIR_KEY_SEPARATOR + networkId;
}

export function buildEvaluatorEvidenceKey(candidate: CandidateMatch): string {
  return [
    candidate.candidateUserId,
    candidate.networkId,
    candidate.candidateIntentId ?? candidate.candidatePremiseId ?? candidate.candidateContextId ?? candidate.sourceContextId ?? 'profile',
  ].join(':');
}

/**
 * Builds a compact text summary of the discoverer's profile and active intents
 * for use as profileContext in HyDE generation.
 * @param profile - The discoverer's profile data (identity, attributes)
 * @param intents - The discoverer's indexed intents (capped at 5)
 * @returns A context string, or undefined if no meaningful data is available
 */
export function buildDiscovererContext(
  profile: SourceProfileData | null | undefined,
  intents: IndexedIntent[] | undefined
): string | undefined {
  const lines: string[] = [];

  if (profile) {
    const identity = profile.identity;
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (identity?.location) {
      lines.push(`Location: ${identity.location}`);
    }
    if (profile.context) {
      lines.push(`Context: ${profile.context}`);
    }
  }

  if (intents?.length) {
    // indexedIntents preserves DB order from getActiveIntents (newest first),
    // so slice(0, 5) is deterministic without an explicit sort.
    const capped = intents.slice(0, 5);
    lines.push('');
    lines.push('Active intents:');
    for (const intent of capped) {
      lines.push(`- ${intent.payload}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}

/**
 * Build a networkContexts map for the evaluator from a set of entities.
 * Fetches network data, checks permissions.contextInjection.discovery,
 * and renders context for eligible networks.
 */
export async function buildNetworkContexts(
  entities: EvaluatorEntity[],
  database: Pick<OpportunityGraphDatabase, 'getNetwork'>,
): Promise<Record<string, string>> {
  const networkIds = [...new Set(entities.map((e) => e.networkId))];
  const networks = await Promise.all(networkIds.map((nid) => database.getNetwork(nid).then((n) => ({ nid, n }))));
  const contexts: Record<string, string> = {};
  for (const { nid, n: network } of networks) {
    if (!network) continue;
    const perms = (network.permissions ?? {}) as Record<string, unknown>;
    const injection = perms.contextInjection as { discovery?: boolean } | undefined;
    if (injection?.discovery === false) continue;
    contexts[nid] = renderNetworkContext({
      title: network.title,
      prompt: network.prompt,
    });
  }
  return contexts;
}

export type { Id };
