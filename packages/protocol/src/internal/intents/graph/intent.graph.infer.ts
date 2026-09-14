/**
 * Intent graph preparation and explicit update inference.
 */

import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../../protocol/core.js";
import { logger, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";

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

  const routeCount = [hasContent, hasArchive, hasStatus].filter(Boolean).length;
  if (routeCount > 1) {
    return 'Intent graph input selected more than one route: content, archive, and status are mutually exclusive.';
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
     * Validates the input route and loads active IDs for existing-intent operations.
     * Creation does not inspect or reconcile existing intents.
     */
export async function prepNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.prep", async () => {
    logger.verbose("Starting preparation phase", {
      hasContent: !!state.inputContent,
      targetIntentIds: state.targetIntentIds,
      archive: state.archive,
      status: state.status,
      networkId: state.networkId,
    });

    const validationError = validateInputShape(state);

    // Creation never loads existing intents: explicit creation cannot merge them.
    const activeIntents = state.inputContent !== undefined && !state.targetIntentIds?.length
      ? []
      : await deps.database.getActiveIntents(state.userId);

    logger.verbose("Fetched active intents", {
      count: activeIntents.length,
    });

    return {
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
    logger.verbose("Starting inference", {
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
        conversationContext: state.conversationContext
      }
    );
    agentTimingsAccum.push({ name: 'intent.inferrer', durationMs: Date.now() - inferrerStart });
    _traceEmitterInferrer?.({ type: "agent_end", name: "intent-inferrer", durationMs: Date.now() - inferrerStart, summary: result.intents.length > 0 ? `Extracted ${result.intents.length} intent(s)` : "intent-inferrer completed" });

    logger.verbose("Inference complete", {
      inferredCount: result.intents.length,
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

/** Prepare an unprepared create, or reuse host authorization for the final edited text. */
export async function preparationNode(state: IntentState, deps: IntentGraphDeps) {
  const result = state.preparation ? undefined : await deps.clarifier.invoke({ payload: state.inputContent! }, state.userProfile);
  if (result?.status === "needs_clarification") {
    return {
      preparationResult: result,
      actions: [],
      validationFailures: [{ category: "vague_or_invalid" as const, message: result.feedback }],
    };
  }
  const preparation = state.preparation ?? { metadata: result!.metadata };
  return {
    preparation,
    preparationResult: result,
    actions: [{ type: "create" as const, payload: state.inputContent!, metadata: preparation.metadata }],
    trace: [{ node: "preparation", detail: state.preparation ? "Reused approved preparation" : "Description passed admission" }],
  };
}
