/**
 * Intent graph, stage 4 and the read fast path.
 */

import { VerifiedIntent, ExecutionResult, ConfirmOutcome, TransitionOutcome, ConfirmIntentAction, TransitionIntentAction, type IntentValidationFailure } from "./intent.graph.state.js";
import { DEFAULT_SPECIFICITY_WARNING, normalizeIntentDescription } from "../intent.proposal.js";
import type { NormalizedIntentAction } from "../intent.reconciler.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../../protocol/core.js";
import { buildExplicitUpdateActions, enforceIntentActionBoundary, generateIntentEmbedding, getSpecificityWarning, isExplicitUpdateRequest, isVague, logger, MAX_PERMISSIBLE_ENTROPY, MIN_CLEAR_INTENT_SCORE, toSpeechActType, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";

/** Zero-vector embedding fallback, matching {@link generateIntentEmbedding}'s dimensionality. */
const ZERO_EMBEDDING_DIMS = 2000;

const VALID_PROPOSAL_EDIT_CLASSIFICATIONS = new Set(['COMMISSIVE', 'DIRECTIVE', 'DECLARATION']);

    /**
     * Node 4: Executor
     * Executes reconciler actions against the database.
     */
export async function executorNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.executor", async () => {
    const actions = enforceIntentActionBoundary(
      isExplicitUpdateRequest(state),
      state.targetIntentIds,
      state.actions ?? [],
    );
    if (actions.length === 0) {
      return { executionResults: [] };
    }

    logger.verbose('Executing actions', { count: actions.length });
    const results: ExecutionResult[] = [];
    let transitionResult: TransitionOutcome | undefined;
    let confirmResult: ConfirmOutcome | undefined;
    const scopeEnvelope = state.scopeType && state.scopeId
      ? { scopeType: state.scopeType, scopeId: state.scopeId }
      : {};
    const networkScopeId = state.scopeType === 'network' ? state.scopeId : undefined;
    const verifiedIntentByPayload = new Map<string, VerifiedIntent>();
    for (const verifiedIntent of state.verifiedIntents) {
      verifiedIntentByPayload.set(verifiedIntent.description, verifiedIntent);
      verifiedIntentByPayload.set(normalizeIntentDescription(verifiedIntent.description), verifiedIntent);
    }

    for (const action of actions) {
      const actionType = action.type.toLowerCase() as 'create' | 'update' | 'expire' | 'transition' | 'confirm';
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
            try {
              await deps.database.deleteIntentIndexAssociations(expireAction.id);
            } catch (err) {
              logger.error('Failed to delete intent-network associations', { intentId: expireAction.id, error: err });
            }
            try {
              const expiredCount = await deps.database.expireOpportunitiesByIntentActor(expireAction.id);
              if (expiredCount > 0) {
                logger.verbose('Expired opportunities referencing intent', { intentId: expireAction.id, expiredCount });
              }
            } catch (err) {
              logger.error('Failed to expire opportunities', { intentId: expireAction.id, error: err });
            }
            deps.intentQueue?.addDeleteHydeJob({ intentId: expireAction.id }).catch((err) =>
              logger.error('Failed to enqueue intent HyDE delete job', { intentId: expireAction.id, error: err })
            );
          }

        } else if (actionType === 'transition') {
          const transitionAction = action as TransitionIntentAction;
          const dbResult = await deps.database.transitionIntentLifecycle({
            intentId: transitionAction.id,
            userId: state.userId,
            status: transitionAction.status,
            networkScopeId,
          });

          let outcome: TransitionOutcome;
          if (dbResult.kind !== 'success' || dbResult.status === 'PAUSED') {
            outcome = dbResult;
          } else {
            try {
              await deps.intentQueue?.addResumeDiscoveryJob({
                intentId: dbResult.id,
                userId: state.userId,
                lifecycleVersionMs: dbResult.lifecycleVersionMs,
              });
              outcome = dbResult;
            } catch (err) {
              logger.warn('Failed to enqueue resumed intent discovery', {
                intentId: dbResult.id,
                lifecycleVersionMs: dbResult.lifecycleVersionMs,
                changed: dbResult.changed,
                error: err,
              });
              if (!dbResult.changed) {
                outcome = { kind: 'enqueue_failed', id: dbResult.id, status: dbResult.status, lifecycleVersionMs: dbResult.lifecycleVersionMs };
              } else {
                let authoritative: { status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED'; lifecycleVersionMs: number } | null = null;
                try {
                  authoritative = await deps.database.compensateFailedResume({
                    intentId: transitionAction.id,
                    userId: state.userId,
                    lifecycleVersionMs: dbResult.lifecycleVersionMs,
                    networkScopeId,
                  });
                } catch (compensationError) {
                  logger.error('Failed to compensate resumed intent after enqueue failure', {
                    intentId: transitionAction.id,
                    lifecycleVersionMs: dbResult.lifecycleVersionMs,
                    compensationError,
                  });
                }
                outcome = {
                  kind: 'enqueue_failed',
                  id: dbResult.id,
                  status: (authoritative?.status ?? dbResult.status) as 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED',
                  lifecycleVersionMs: authoritative?.lifecycleVersionMs ?? dbResult.lifecycleVersionMs,
                };
              }
            }
          }
          transitionResult = outcome;
          results.push({
            actionType: 'transition',
            success: outcome.kind === 'success',
            intentId: 'id' in outcome ? outcome.id : transitionAction.id,
            error: outcome.kind !== 'success' ? outcome.kind : undefined,
          });

        } else if (actionType === 'confirm') {
          const confirmAction = action as ConfirmIntentAction;
          const outcome = await executeConfirmAction(state, deps, confirmAction);
          confirmResult = outcome;
          results.push({
            actionType: 'confirm',
            success: outcome.kind === 'created' || outcome.kind === 'replay',
            intentId: 'intentId' in outcome ? outcome.intentId : undefined,
            error: outcome.kind !== 'created' && outcome.kind !== 'replay' ? outcome.kind : undefined,
          });
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

    return { executionResults: results, transitionResult, confirmResult };
  });
}

/**
 * Confirm a stored proposal into a persisted intent. An owner-edited
 * description (differs from the stored proposal) is re-verified and made
 * authoritative before confirmation continues; an unchanged description
 * skips straight to the atomic confirm. HyDE admission is awaited (unlike
 * the fire-and-forget enqueue on a plain create): a failure here means the
 * intent was saved but is not yet indexed, which the caller must retry.
 */
async function executeConfirmAction(
  state: IntentState,
  deps: IntentGraphDeps,
  action: ConfirmIntentAction,
): Promise<ConfirmOutcome> {
  const { proposalId, description, networkId } = action;

  const proposal = await deps.database.getProposalForOwner(proposalId, state.userId);
  if (!proposal) return { kind: 'missing' };
  // Check the network scope before touching description/verification at all:
  // a caller confirming into the wrong network must never revise the stored
  // proposal on its way to being rejected.
  if (proposal.networkId !== (networkId ?? null)) return { kind: 'payload_mismatch' };

  let effectiveDescription = proposal.description;
  if (proposal.description !== description) {
    if (proposal.status !== 'pending') return { kind: 'consumed' };
    if (proposal.expiresAt.getTime() <= Date.now()) return { kind: 'expired' };

    const profileContext = (await deps.database.getUserContext(state.userId, null))?.text ?? '';
    const verdict = await deps.verifier.invoke(description, profileContext);
    const valid = VALID_PROPOSAL_EDIT_CLASSIFICATIONS.has(verdict.classification)
      && !isVague(description, verdict.semantic_entropy, verdict.felicity_scores.clarity);
    if (!valid) return { kind: 'proposal_edit_rejected' };

    const analysis = {
      verifierOutput: verdict,
      combinedScore: Math.min(
        verdict.felicity_scores.authority,
        verdict.felicity_scores.sincerity,
        verdict.felicity_scores.clarity,
      ),
    };
    await deps.database.revisePendingProposal({
      proposalId: proposal.id,
      userId: state.userId,
      expectedDescription: proposal.description,
      expectedNetworkId: proposal.networkId,
      description,
      analysis,
    });
    // A revision lost to a concurrent writer (null return) is resolved by the
    // authoritative check inside confirmProposalIntent below, same as any
    // other race on this proposal.
    effectiveDescription = description;
  }

  const embedding = (await generateIntentEmbedding(deps, effectiveDescription)) ?? new Array(ZERO_EMBEDDING_DIMS).fill(0);
  const confirmation = await deps.database.confirmProposalIntent({
    proposalId,
    userId: state.userId,
    description: effectiveDescription,
    ...(networkId ? { networkId } : {}),
    embedding,
  });

  if (confirmation.kind !== 'created' && confirmation.kind !== 'replay') {
    if (confirmation.kind === 'membership_required') {
      return { kind: 'membership_required', networkId: proposal.networkId ?? networkId ?? '' };
    }
    return { kind: confirmation.kind };
  }

  const intentId = confirmation.intent.id;
  try {
    await deps.intentQueue?.addGenerateHydeJob({
      intentId,
      userId: state.userId,
      ...(proposal.networkId ? { scopeType: 'network' as const, scopeId: proposal.networkId } : {}),
    });
    return { kind: confirmation.kind, intentId };
  } catch (err) {
    logger.error('Intent admission enqueue failed after confirmation persistence', { intentId, error: err });
    return { kind: 'admission_enqueue_failed', intentId };
  }
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
