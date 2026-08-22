/**
 * Intent graph, stages 0-1: load the user's signals, then infer new ones.
 */

import { VerifiedIntent, ExecutionResult, type IntentValidationFailure } from "./intent.graph.state.js";
import { DEFAULT_SPECIFICITY_WARNING, normalizeIntentDescription } from "../intent.proposal.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../agents/agent.module.js";
import { buildExplicitUpdateActions, enforceIntentActionBoundary, generateIntentEmbedding, getSpecificityWarning, isVague, logger, MAX_PERMISSIBLE_ENTROPY, MIN_CLEAR_INTENT_SCORE, toSpeechActType, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";

    /**
     * Node 0: Prep
     * Always fetches ALL of the user's active intents from the DB via getActiveIntents(userId).
     * This ensures reconciliation can detect duplicates and modifications globally,
     * regardless of network scope.
     */
export async function prepNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.prep", async () => {
    logger.verbose("Starting preparation phase", {
      operationMode: state.operationMode,
      hasContent: !!state.inputContent,
      targetIntentIds: state.targetIntentIds,
      networkId: state.networkId,
    });

    // Gate: write operations require an existing profile
    if (state.operationMode !== 'read') {
      const profile = await deps.database.getProfile(state.userId);
      if (!profile) {
        const msg = "You need to create a profile before creating intents. Please set up your profile first.";
        logger.error("Prep failed: no profile for user", { userId: state.userId });
        return { error: msg };
      }
    }

    const activeIntents = await deps.database.getActiveIntents(state.userId);
    const formattedActiveIntents = activeIntents
      .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
      .join('\n') || "No active intents.";

    logger.verbose("Fetched active intents", {
      count: activeIntents.length,
      operationMode: state.operationMode
    });

    return {
      activeIntents: formattedActiveIntents,
      activeIntentIds: activeIntents.map((intent) => intent.id),
      trace: [{
        node: "prep",
        detail: `Fetched ${activeIntents.length} active intent(s)`,
      }],
    };
  });
}

    /**
     * Node 1: Inference
     * Extracts intents from raw content.
     * Phase 4: Uses operation mode to control behavior and determine if node should execute.
     * Phase 5: Passes conversation context for anaphoric resolution.
     */
export async function inferenceNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.inference", async () => {
    logger.verbose("Starting inference", {
      operationMode: state.operationMode,
      hasContent: !!state.inputContent,
      contentPreview: state.inputContent?.substring(0, 50),
      hasConversationContext: !!state.conversationContext,
      conversationMessagesCount: state.conversationContext?.length || 0
    });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    // Phase 4: Control profile fallback based on operation mode
    // Only allow for create operations without explicit content
    const allowProfileFallback = state.operationMode === 'create' && !state.inputContent;

    // Cast operationMode: 'read' and 'propose' map to 'create' for the deps.inferrer
    // (inference node is never called in read mode; propose behaves like create for inference)
    const inferrerMode = (state.operationMode === 'read' || state.operationMode === 'propose') ? 'create' : state.operationMode;
    const _traceEmitterInferrer = requestContext.getStore()?.traceEmitter;
    const inferrerStart = Date.now();
    _traceEmitterInferrer?.({ type: "agent_start", name: "intent-inferrer" });
    const result = await deps.inferrer.invoke(
      state.inputContent || null,
      state.userProfile,
      {
        allowProfileFallback,
        operationMode: inferrerMode,
        conversationContext: state.conversationContext  // Phase 5: Pass conversation history
      }
    );
    agentTimingsAccum.push({ name: 'intent.inferrer', durationMs: Date.now() - inferrerStart });
    _traceEmitterInferrer?.({ type: "agent_end", name: "intent-inferrer", durationMs: Date.now() - inferrerStart, summary: result.intents.length > 0 ? `Extracted ${result.intents.length} intent(s)` : "intent-inferrer completed" });

    logger.verbose("Inference complete", {
      inferredCount: result.intents.length,
      operationMode: state.operationMode
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
