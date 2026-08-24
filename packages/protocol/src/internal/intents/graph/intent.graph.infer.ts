/**
 * Intent graph, stages 0-1: load the user's signals, then infer new ones.
 */

import { VerifiedIntent, ExecutionResult, type IntentValidationFailure } from "./intent.graph.state.js";
import { DEFAULT_SPECIFICITY_WARNING, normalizeIntentDescription } from "../intent.proposal.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../../protocol/core.js";
import { buildExplicitUpdateActions, enforceIntentActionBoundary, generateIntentEmbedding, getSpecificityWarning, isExplicitUpdateRequest, isVague, logger, MAX_PERMISSIBLE_ENTROPY, MIN_CLEAR_INTENT_SCORE, toSpeechActType, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";

/**
 * Validate that the input shape selects exactly one route. Returns an error
 * message when it doesn't; undefined when the shape is valid.
 *
 * Never infer destruction from a missing field: `targetIntentIds` alone
 * (no content, no archive, no status) is an input error, not a silent no-op.
 */
export function validateInputShape(state: IntentState): string | undefined {
  const hasContent = state.inputContent !== undefined;
  const hasTargets = !!state.targetIntentIds?.length;
  const hasArchive = state.archive === true;
  const hasStatus = state.status !== undefined;
  const hasProposal = state.proposalId !== undefined;

  const routeCount = [hasContent, hasArchive, hasStatus, hasProposal].filter(Boolean).length;
  if (routeCount > 1) {
    return 'Intent graph input selected more than one route: content, archive, status, and proposalId are mutually exclusive.';
  }
  if (hasTargets && !hasContent && !hasArchive && !hasStatus) {
    return 'targetIntentIds requires inputContent (update), archive, or status.';
  }
  if (hasArchive && !hasTargets) {
    return 'archive requires targetIntentIds.';
  }
  if (hasStatus && !hasTargets) {
    return 'status requires targetIntentIds.';
  }
  return undefined;
}

    /**
     * Node 0: Prep
     * Always fetches ALL of the user's active intents from the DB via getActiveIntents(userId).
     * This ensures reconciliation can detect duplicates and modifications globally,
     * regardless of network scope. Also validates that the input shape selects
     * exactly one route (see {@link validateInputShape}).
     */
export async function prepNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.prep", async () => {
    logger.verbose("Starting preparation phase", {
      hasContent: !!state.inputContent,
      targetIntentIds: state.targetIntentIds,
      archive: state.archive,
      status: state.status,
      hasProposal: !!state.proposalId,
      networkId: state.networkId,
    });

    const validationError = validateInputShape(state);

    const activeIntents = await deps.database.getActiveIntents(state.userId);
    const formattedActiveIntents = activeIntents
      .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
      .join('\n') || "No active intents.";

    logger.verbose("Fetched active intents", {
      count: activeIntents.length,
    });

    return {
      activeIntents: formattedActiveIntents,
      activeIntentIds: activeIntents.map((intent) => intent.id),
      ...(validationError ? { error: validationError } : {}),
      trace: [{
        node: "prep",
        detail: `Fetched ${activeIntents.length} active intent(s)`,
      }],
    };
  });
}

    /**
     * Node 1: Inference
     * Extracts intents from raw content. Only reached on the content path
     * (see {@link afterPrepRoute}), so `inputContent` is always defined here.
     * Passes conversation context for anaphoric resolution.
     */
export async function inferenceNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.inference", async () => {
    const inferrerMode = isExplicitUpdateRequest(state) ? 'update' : 'create';
    logger.verbose("Starting inference", {
      inferrerMode,
      contentPreview: state.inputContent?.substring(0, 50),
      hasConversationContext: !!state.conversationContext,
      conversationMessagesCount: state.conversationContext?.length || 0
    });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    const _traceEmitterInferrer = requestContext.getStore()?.traceEmitter;
    const inferrerStart = Date.now();
    _traceEmitterInferrer?.({ type: "agent_start", name: "intent-inferrer" });
    const result = await deps.inferrer.invoke(
      state.inputContent ?? null,
      state.userProfile,
      {
        operationMode: inferrerMode,
        conversationContext: state.conversationContext
      }
    );
    agentTimingsAccum.push({ name: 'intent.inferrer', durationMs: Date.now() - inferrerStart });
    _traceEmitterInferrer?.({ type: "agent_end", name: "intent-inferrer", durationMs: Date.now() - inferrerStart, summary: result.intents.length > 0 ? `Extracted ${result.intents.length} intent(s)` : "intent-inferrer completed" });

    logger.verbose("Inference complete", {
      inferredCount: result.intents.length,
      inferrerMode,
    });

    const descriptions = result.intents.map(i => i.description).slice(0, 3);
    const truncated = result.intents.length > 3 ? `... +${result.intents.length - 3} more` : "";

    return {
      inferredIntents: result.intents,
      agentTimings: agentTimingsAccum,
      trace: [{
        node: "inference",
        detail: result.intents.length === 0
          ? "No intents extracted"
          : `Extracted ${result.intents.length}: ${descriptions.map(d => `"${d.slice(0, 50)}${d.length > 50 ? '...' : ''}"`).join(", ")}${truncated}`,
      }],
    };
  });
}
