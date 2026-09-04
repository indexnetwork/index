/**
 * Shared vocabulary for the intent graph's nodes.
 *
 * The nodes were closures inside `IntentGraphFactory.createGraph()`; they are
 * top-level functions now, each taking an explicit {@link IntentGraphDeps}.
 * This module owns the bag, the logger, and the pure helpers.
 */

import { IntentGraphState, VerifiedIntent, type IntentGraphAction, type IntentValidationFailure } from "./intent.graph.state.js";
import { ExplicitIntentInferrer } from "../intent.inferrer.js";
import { SemanticVerifier } from "../intent.verifier.js";
import { IntentReconciler } from "../intent.reconciler.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";
import { IntentGraphDatabase } from "../../../platform/database.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import type { EmbeddingGenerator } from "../../../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../../../platform/runtime/follow-up.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";

/** The graph's channel state, as every node sees it. */
export type IntentState = typeof IntentGraphState.State;

/** Everything the intent nodes reach for. Composed once by the factory. */
export interface IntentGraphDeps {
  database: IntentGraphDatabase;
  embedder?: EmbeddingGenerator;
  intentFollowUp?: IntentFollowUp;
  inferrer: Pick<ExplicitIntentInferrer, 'invoke'>;
  verifier: Pick<SemanticVerifier, 'invoke'>;
  reconciler: Pick<IntentReconciler, 'invoke'>;
}

export const logger = protocolLogger("IntentGraphFactory");

/**
 * True when the input shape is an explicit update: content plus a target id.
 * Distinguishes an explicit update from archive/transition/confirm, which also
 * carry `targetIntentIds` but for a different purpose.
 */
export function isExplicitUpdateRequest(state: Pick<IntentState, 'inputContent' | 'targetIntentIds'>): boolean {
  return state.inputContent !== undefined && !!state.targetIntentIds?.length;
}

/**
 * Enforce write-mode constraints on reconciler output before any action can
 * reach persistence. An explicit update is deliberately fail-closed: only an
 * update whose id is the caller-provided target survives.
 */
export function enforceIntentActionBoundary(
  isExplicitUpdate: boolean,
  targetIntentIds: string[] | undefined,
  actions: IntentGraphAction[],
): IntentGraphAction[] {
  if (!isExplicitUpdate) return actions;
  const targets = new Set(targetIntentIds ?? []);
  return actions.filter((action) => action.type === 'update' && targets.has(action.id));
}

/**
 * Build the only action permitted for an explicit update. This path is
 * intentionally deterministic: semantic reconciliation may shape create
 * operations, but it may not redirect an update away from its supplied target.
 */
export function buildExplicitUpdateActions(
  targetIntentIds: string[] | undefined,
  activeIntentIds: string[],
  candidates: VerifiedIntent[],
): { actions: NormalizedIntentAction[]; failure?: IntentValidationFailure } {
  if (targetIntentIds?.length !== 1 || !activeIntentIds.includes(targetIntentIds[0])) {
    return {
      actions: [],
      failure: {
        category: 'update_target_boundary',
        message: 'Explicit update requires exactly one active intent owned by the caller.',
      },
    };
  }
  if (candidates.length !== 1) {
    return {
      actions: [],
      failure: {
        category: 'reconciliation_boundary',
        message: 'Explicit update must resolve to exactly one verified intent.',
      },
    };
  }

  const candidate = candidates[0];
  return {
    actions: [{
      type: 'update',
      id: targetIntentIds[0],
      payload: candidate.description,
      score: candidate.score ?? null,
      reasoning: candidate.reasoning ?? 'Explicit user-confirmed update',
      intentMode: candidate.verification?.referential_anchor ? 'REFERENTIAL' : 'ATTRIBUTIVE',
    }],
  };
}

export const MAX_PERMISSIBLE_ENTROPY = 0.75;
export const MIN_CLEAR_INTENT_SCORE = 40;
export const GENERIC_JOB_PHRASE = /\b(?:a|any|some)\s+job\b/i;

export const isVague = (description: string, entropy: number, clarity: number): boolean => {
  if (GENERIC_JOB_PHRASE.test(description)) return true;
  if (entropy > MAX_PERMISSIBLE_ENTROPY) return true;
  if (clarity < MIN_CLEAR_INTENT_SCORE) return true;
  return false;
};

/** Default user-facing warning for broad attributive intents. */
export const DEFAULT_SPECIFICITY_WARNING = "This signal is broad and may produce many weak matches. Add a more concrete role, outcome, location, timeframe, domain, or specific need to get better recommendations.";

export const getSpecificityWarning = (verdict: { specificity_warning?: string | null }): string => {
  const warning = verdict.specificity_warning?.trim();
  return warning && warning.length > 0 ? warning : DEFAULT_SPECIFICITY_WARNING;
};

export const toSpeechActType = (classification?: string): "COMMISSIVE" | "DIRECTIVE" | null => {
  if (classification === "COMMISSIVE" || classification === "DIRECTIVE") return classification;
  return null;
};

/** Normalize intent text to the form the graph persists. */
export function normalizeIntentDescription(description: string): string {
  if (!description || typeof description !== "string") return description;
  const normalized = description
    .replace(/\s*More details at\s*:?\s*https?:\/\/[^\s"'<>)\]]+/gi, "")
    .replace(/\s*See\s+https?:\/\/[^\s"'<>)\]]+\s+for\s+more[^.]*\.?/gi, "")
    .replace(/https?:\/\/[^\s"'<>)\]]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return normalized.replace(/[.,;]\s*$/, "").trim() || description;
}

/**
 * Generate a flat embedding for an intent payload, swallowing failures so
 * persistence can continue without an embedding. `intentId` is logging-only
 * (present for updates, absent for creates).
 */
export async function generateIntentEmbedding(
  deps: IntentGraphDeps,
  sanitizedPayload: string,
  intentId?: string,
): Promise<number[] | undefined> {
  if (!deps.embedder) return undefined;
  try {
    const embedding = await deps.embedder.generate(sanitizedPayload, undefined, getAbortSignalConfig());
    const flatEmbedding = Array.isArray(embedding?.[0])
      ? (embedding as number[][])[0]
      : (embedding as number[]);
    logger.verbose("Generated embedding for intent", {
      ...(intentId ? { intentId } : {}),
      dimensions: flatEmbedding?.length,
    });
    return flatEmbedding;
  } catch (embErr) {
    logger.error("Failed to generate embedding for intent (continuing without)", {
      ...(intentId ? { intentId } : {}),
      error: embErr,
    });
    return undefined;
  }
}
