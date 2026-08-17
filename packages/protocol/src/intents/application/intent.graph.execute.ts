/**
 * Intent graph, stage 4 and the read fast path.
 */

import { VerifiedIntent, ExecutionResult, type IntentValidationFailure } from "../domain/intent.state.js";
import { DEFAULT_SPECIFICITY_WARNING } from "../domain/signal.specificity.js";
import { normalizeIntentDescription } from "../domain/intent.proposal.js";
import type { NormalizedIntentAction } from "./intent.reconciler.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../agents/index.js";
import { buildExplicitUpdateActions, enforceIntentActionBoundary, enrichVagueIntentWithContext, generateIntentEmbedding, getSpecificityWarning, isVague, logger, MAX_PERMISSIBLE_ENTROPY, MIN_CLEAR_INTENT_SCORE, toSpeechActType, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";

    /**
     * Node 4: Executor
     * Executes reconciler actions against the database.
     */
export async function executorNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.executor", async () => {
    const actions = enforceIntentActionBoundary(
      state.operationMode,
      state.targetIntentIds,
      state.actions ?? [],
    );
    if (actions.length === 0) {
      return { executionResults: [] };
    }

    logger.verbose('Executing actions', { count: actions.length });
    const results: ExecutionResult[] = [];
    const scopeEnvelope = state.scopeType && state.scopeId
      ? { scopeType: state.scopeType, scopeId: state.scopeId }
      : {};
    const verifiedIntentByPayload = new Map<string, VerifiedIntent>();
    for (const verifiedIntent of state.verifiedIntents) {
      verifiedIntentByPayload.set(verifiedIntent.description, verifiedIntent);
      verifiedIntentByPayload.set(normalizeIntentDescription(verifiedIntent.description), verifiedIntent);
    }

    for (const action of actions) {
      const actionType = action.type.toLowerCase() as 'create' | 'update' | 'expire';
      try {
        if (actionType === 'create') {
          const createAction = action as {
            payload: string;
            score: number | null;
            semanticEntropy?: number | null;
            referentialAnchor?: string | null;
            intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
          };
          const sanitizedPayload = normalizeIntentDescription(createAction.payload);
          const matchedVerifiedIntent =
            verifiedIntentByPayload.get(createAction.payload) ||
            verifiedIntentByPayload.get(sanitizedPayload);

          // Generate embedding for the intent payload
          const flatEmbedding = await generateIntentEmbedding(deps, sanitizedPayload);

          const created = await deps.database.createIntent({
            userId: state.userId,
            payload: sanitizedPayload,
            confidence: createAction.score ? createAction.score / 100 : 1.0,
            inferenceType: 'explicit',
            sourceType: 'discovery_form',
            embedding: flatEmbedding,
            semanticEntropy:
              createAction.semanticEntropy ??
              matchedVerifiedIntent?.verification?.semantic_entropy ??
              null,
            referentialAnchor:
              createAction.referentialAnchor ??
              matchedVerifiedIntent?.verification?.referential_anchor ??
              null,
            felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
            felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
            felicityClarity: matchedVerifiedIntent?.verification?.felicity_scores.clarity ?? null,
            intentMode: createAction.intentMode ?? null,
            speechActType: toSpeechActType(matchedVerifiedIntent?.verification?.classification),
          });

          results.push({ actionType: 'create', success: true, intentId: created.id, payload: sanitizedPayload });
          logger.verbose('Created intent', { intentId: created.id });

          deps.intentQueue?.addGenerateHydeJob({
            intentId: created.id,
            userId: state.userId,
            ...scopeEnvelope,
          }).catch((err) =>
            logger.error('Failed to enqueue intent HyDE job', { intentId: created.id, error: err })
          );

          if (deps.questionerEnqueue) {
            const userContext = (await deps.database.getUserContext(state.userId, null))?.text ?? '';
            deps.questionerEnqueue({
              mode: 'intent',
              userId: state.userId,
              sourceType: 'intent',
              sourceId: created.id,
              ...scopeEnvelope,
              context: {
                intentId: created.id,
                payload: sanitizedPayload,
                userContext,
              },
            }).catch((err) =>
              logger.error('Failed to enqueue intent question generation', { intentId: created.id, error: err })
            );
          }

        } else if (actionType === 'update') {
          const updateAction = action as {
            id: string;
            payload: string;
            intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
          };
          const sanitizedPayload = normalizeIntentDescription(updateAction.payload);
          const matchedVerifiedIntent =
            verifiedIntentByPayload.get(updateAction.payload) ||
            verifiedIntentByPayload.get(sanitizedPayload);

          // Regenerate embedding for the updated payload
          const flatEmbedding = await generateIntentEmbedding(deps, sanitizedPayload, updateAction.id);

          const updated = await deps.database.updateIntent(updateAction.id, {
            payload: sanitizedPayload,
            embedding: flatEmbedding,
            semanticEntropy:
              matchedVerifiedIntent?.verification?.semantic_entropy ??
              null,
            referentialAnchor:
              matchedVerifiedIntent?.verification?.referential_anchor ??
              null,
            felicityAuthority: matchedVerifiedIntent?.verification?.felicity_scores.authority ?? null,
            felicitySincerity: matchedVerifiedIntent?.verification?.felicity_scores.sincerity ?? null,
            felicityClarity: matchedVerifiedIntent?.verification?.felicity_scores.clarity ?? null,
            intentMode: updateAction.intentMode ?? null,
            speechActType: toSpeechActType(matchedVerifiedIntent?.verification?.classification),
            ...(state.expectedIntentFingerprint !== undefined ? {
              expectedIntentFingerprint: state.expectedIntentFingerprint,
              expectedIntentUserId: state.userId,
            } : {}),
          });
          results.push({
            actionType: 'update',
            success: !!updated,
            intentId: updateAction.id,
            payload: sanitizedPayload,
            error: updated ? undefined : 'Intent not found'
          });
          logger.verbose('Updated intent', { intentId: updateAction.id });
          if (updated) {
            deps.intentQueue?.addGenerateHydeJob({
              intentId: updateAction.id,
              userId: state.userId,
              ...scopeEnvelope,
            }).catch((err) =>
              logger.error('Failed to enqueue intent HyDE job', { intentId: updateAction.id, error: err })
            );
          }

        } else if (actionType === 'expire') {
          const expireAction = action as { id: string };
          const result = await deps.database.archiveIntent(expireAction.id);
          results.push({
            actionType: 'expire',
            success: result.success,
            intentId: expireAction.id,
            error: result.error
          });
          logger.verbose('Archived intent', { intentId: expireAction.id });
          if (result.success) {
            deps.intentQueue?.addDeleteHydeJob({ intentId: expireAction.id }).catch((err) =>
              logger.error('Failed to enqueue intent HyDE delete job', { intentId: expireAction.id, error: err })
            );
          }
        }
      } catch (error) {
        logger.error('Failed to execute action', { actionType: action.type, error });
        results.push({
          actionType,
          success: false,
          intentId: 'id' in action ? action.id : undefined,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { executionResults: results };
  });
}


    /**
     * Node: Query
     * Fast-path read node — fetches intents from DB based on scope.
     * Handles: global user intents, network-scoped (all or filtered by user).
     * No LLM calls; no inference/verification/reconciliation.
     */
export async function queryNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.query", async () => {
    logger.verbose("Starting query (read mode)", {
      userId: state.userId,
      networkId: state.networkId,
      queryUserId: state.queryUserId,
      allUserIntents: state.allUserIntents,
    });

    try {
      // Scope-aware default: caller's intents across all reachable networks.
      // Triggered when the tool layer passed indexScope and did not pick a
      // specific networkId or queryUserId — i.e. "my intents" in a chat
      // where the agent's reach is more than one index.
      if (
        !state.queryUserId &&
        !state.networkId &&
        state.indexScope &&
        state.indexScope.length > 0
      ) {
        const intents = await deps.database.getActiveIntentsAcrossIndexes(
          state.userId,
          state.indexScope,
        );
        if (intents.length === 0) {
          return {
            readResult: {
              count: 0,
              intents: [],
              message: "You don't have any active intents yet. Share what you're looking for.",
            },
          };
        }
        return {
          readResult: {
            count: intents.length,
            intents: intents.map((i) => ({
              id: i.id,
              description: i.payload,
              summary: i.summary,
              createdAt: i.createdAt,
            })),
          },
        };
      }

      // When allUserIntents is true, ignore network scope and return all
      const effectiveIndexId = state.allUserIntents ? undefined : state.networkId;

      if (effectiveIndexId) {
        // Verify membership
        const isMember = await deps.database.isNetworkMember(effectiveIndexId, state.userId);
        if (!isMember) {
          return {
            readResult: {
              count: 0,
              intents: [],
              message: "Index not found or you are not a member.",
            },
          };
        }

        // Network-scoped read
        if (!state.queryUserId) {
          // All intents in the index (any member can see)
          const intents = await deps.database.getNetworkIntentsForMember(
            effectiveIndexId,
            state.userId,
            { limit: 50, offset: 0 }
          );
          if (intents.length === 0) {
            return {
              readResult: {
                count: 0,
                intents: [],
                message: "No intents in this network yet.",
                networkId: effectiveIndexId,
              },
            };
          }
          return {
            readResult: {
              count: intents.length,
              networkId: effectiveIndexId,
              intents: intents.map((i) => ({
                id: i.id,
                description: i.payload,
                summary: i.summary,
                createdAt: i.createdAt,
                userId: i.userId,
                userName: i.userName,
              })),
            },
          };
        }

        // Specific user's intents in the index
        const effectiveUserId = state.queryUserId;
        const intents = await deps.database.getIntentsInIndexForMember(
          effectiveUserId,
          effectiveIndexId
        );
        if (intents.length === 0) {
          return {
            readResult: {
              count: 0,
              intents: [],
              message:
                effectiveUserId === state.userId
                  ? "You don't have any intents in this network yet."
                  : "No intents for that user in this network.",
              networkId: effectiveIndexId,
            },
          };
        }
        const user = await deps.database.getUser(effectiveUserId);
        const userName = user?.name ?? null;
        return {
          readResult: {
            count: intents.length,
            networkId: effectiveIndexId,
            intents: intents.map((i) => ({
              id: i.id,
              description: i.payload,
              summary: i.summary,
              createdAt: i.createdAt,
              userId: effectiveUserId,
              userName,
            })),
          },
        };
      }

      // Global (no network scope): return user's own active intents
      const intents = await deps.database.getActiveIntents(state.userId);
      if (intents.length === 0) {
        return {
          readResult: {
            count: 0,
            intents: [],
            message:
              "You don't have any active intents yet. Share what you're looking for.",
          },
        };
      }
      return {
        readResult: {
          count: intents.length,
          intents: intents.map((i) => ({
            id: i.id,
            description: i.payload,
            summary: i.summary,
            createdAt: i.createdAt,
          })),
        },
      };
    } catch (err) {
      logger.error("Query node failed", { error: err });
      return {
        readResult: {
          count: 0,
          intents: [],
          message: "Failed to fetch intents. Please try again.",
        },
      };
    }
  });
}
