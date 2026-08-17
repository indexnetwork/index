/**
 * Intent graph, stages 2-3: verify inferred signals, then reconcile against what exists.
 */

import { VerifiedIntent, ExecutionResult, type IntentValidationFailure } from "./intent.graph.state.js";
import { DEFAULT_SPECIFICITY_WARNING } from "../verification/intent.specificity.js";
import { normalizeIntentDescription } from "../proposal/intent.proposal.js";
import type { NormalizedIntentAction } from "../inference/intent.reconciler.js";
import { getAbortSignalConfig } from "../../shared/agent/model-signal.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../agents/index.js";
import { buildExplicitUpdateActions, enforceIntentActionBoundary, enrichVagueIntentWithContext, generateIntentEmbedding, getSpecificityWarning, isVague, logger, MAX_PERMISSIBLE_ENTROPY, MIN_CLEAR_INTENT_SCORE, toSpeechActType, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";


    /**
     * Node 2: Verification (Map-Reduce / Parallel)
     * Verifies each inferred intent in parallel.
     * Phase 4: Can be skipped for delete operations and updates with no new intents.
     */
export async function verificationNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.verification", async () => {
    const intents = state.inferredIntents;

    logger.verbose("Starting verification", {
      operationMode: state.operationMode,
      intentCount: intents.length
    });

    if (intents.length === 0) {
      logger.verbose("No intents to verify");
      return { verifiedIntents: [], agentTimings: [] };
    }

    logger.verbose('Verifying intents in parallel', { count: intents.length });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    // Parallel Execution
    const verificationResults = await Promise.all(
      intents.map(async (intent): Promise<
        { intent: VerifiedIntent } | { failure: IntentValidationFailure }
      > => {
        try {
          let description = intent.description;
          const _traceEmitterVerifier = requestContext.getStore()?.traceEmitter;
          const verifierStart1 = Date.now();
          _traceEmitterVerifier?.({ type: "agent_start", name: "intent-verifier" });
          let verdict = await deps.verifier.invoke(description, state.userProfile);
          agentTimingsAccum.push({ name: 'intent.verifier', durationMs: Date.now() - verifierStart1 });
          _traceEmitterVerifier?.({ type: "agent_end", name: "intent-verifier", durationMs: Date.now() - verifierStart1, summary: `Verified: ${verdict.classification}` });

          if (isVague(description, verdict.semantic_entropy, verdict.felicity_scores.clarity)) {
            // Role-hint enrichment for vague job intents reads the global
            // user_context paragraph instead of the structured profile fields.
            const roleHintContext = (await deps.database.getUserContext(state.userId, null))?.text ?? '';
            const enrichedDescription = enrichVagueIntentWithContext(description, roleHintContext);
            if (enrichedDescription !== description) {
              logger.verbose("Enriched vague intent using profile context", {
                before: description,
                after: enrichedDescription,
              });
              const _traceEmitterVerifier2 = requestContext.getStore()?.traceEmitter;
              const verifierStart2 = Date.now();
              _traceEmitterVerifier2?.({ type: "agent_start", name: "intent-verifier" });
              const enrichedVerdict = await deps.verifier.invoke(enrichedDescription, state.userProfile);
              agentTimingsAccum.push({ name: 'intent.verifier', durationMs: Date.now() - verifierStart2 });
              _traceEmitterVerifier2?.({ type: "agent_end", name: "intent-verifier", durationMs: Date.now() - verifierStart2, summary: `Verified (enriched): ${enrichedVerdict.classification}` });
              const becameClear =
                enrichedVerdict.semantic_entropy < verdict.semantic_entropy ||
                enrichedVerdict.felicity_scores.clarity > verdict.felicity_scores.clarity;
              if (becameClear) {
                description = enrichedDescription;
                verdict = enrichedVerdict;
              }
            }
          }

          // Filter Logic: Must be a Commissive, Directive, or Declaration
          const VALID_TYPES = ['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'];
          if (!VALID_TYPES.includes(verdict.classification)) {
            logger.warn('Dropping intent', { description, classification: verdict.classification });
            return {
              failure: {
                category: 'non_actionable',
                classification: verdict.classification,
                referentialBreadth: verdict.referential_breadth,
                message: `Description was classified as ${verdict.classification}, not an actionable goal.`,
              },
            };
          }

          if (isVague(description, verdict.semantic_entropy, verdict.felicity_scores.clarity)) {
            logger.warn('Dropping vague intent after verification', {
              description,
              entropy: verdict.semantic_entropy,
              clarity: verdict.felicity_scores.clarity,
            });
            return {
              failure: {
                category: 'vague_or_invalid',
                classification: verdict.classification,
                referentialBreadth: verdict.referential_breadth,
                message: 'Description failed clarity or semantic-entropy requirements.',
              },
            };
          }

          if (state.operationMode === 'create' && verdict.referential_breadth === 'broad') {
            logger.warn('Dropping broad attributive intent before persistence', {
              description,
              referentialBreadth: verdict.referential_breadth,
              missingSelectionalConstraints: verdict.missing_selectional_constraints,
              warning: getSpecificityWarning(verdict),
            });
            return {
              failure: {
                category: 'vague_or_invalid',
                classification: verdict.classification,
                referentialBreadth: verdict.referential_breadth,
                message: getSpecificityWarning(verdict),
              },
            };
          }

          // Calculate Score
          const score = Math.min(
            verdict.felicity_scores.authority,
            verdict.felicity_scores.sincerity,
            verdict.felicity_scores.clarity
          );

          // Return enriched intent
          return {
            intent: {
              ...intent,
              description,
              verification: verdict,
              score,
            },
          };
        } catch (e) {
          logger.error('Error verifying intent', { description: intent.description, error: e });
          return {
            failure: {
              category: 'verification_failure',
              message: e instanceof Error ? e.message : 'Intent verification failed unexpectedly.',
            },
          };
        }
      })
    );

    const verified = verificationResults.flatMap((result) => 'intent' in result ? [result.intent] : []);
    const validationFailures = verificationResults.flatMap((result) => 'failure' in result ? [result.failure] : []);
    logger.verbose(`Verification complete`, {
      passed: verified.length,
      total: intents.length,
      operationMode: state.operationMode
    });

    // Build trace entries with Felicity scores for each verified intent
    const traceEntries = verified.map(v => {
      const fs = v.verification?.felicity_scores;
      const entropy = v.verification?.semantic_entropy;
      const classification = v.verification?.classification;
      const referentialBreadth = v.verification?.referential_breadth;
      return {
        node: "verification",
        detail: `"${v.description.slice(0, 40)}${v.description.length > 40 ? '...' : ''}" → ${classification}${referentialBreadth ? ` (${referentialBreadth} referential breadth)` : ''}`,
        data: fs ? {
          clarity: fs.clarity,
          authority: fs.authority,
          sincerity: fs.sincerity,
          entropy: entropy != null ? Math.round(entropy * 100) / 100 : undefined,
          referentialBreadth,
          missingSelectionalConstraints: v.verification?.missing_selectional_constraints,
          specificityWarning: v.verification?.specificity_warning ?? undefined,
          classification,
          score: v.score,
        } : undefined,
      };
    });

    // Add summary trace if some intents were filtered out
    const dropped = intents.length - verified.length;
    if (dropped > 0) {
      traceEntries.unshift({
        node: "verification",
        detail: `Verified ${verified.length}/${intents.length} (${dropped} filtered as invalid)`,
        data: undefined,
      });
    } else if (verified.length > 0) {
      traceEntries.unshift({
        node: "verification",
        detail: `Verified ${verified.length} intent(s)`,
        data: undefined,
      });
    }

    return { verifiedIntents: verified, validationFailures, agentTimings: agentTimingsAccum, trace: traceEntries };
  });
}


    /**
     * Node 3: Reconciliation
     * Decides on final actions (Create, Update, Expire).
     * Phase 4: Handles delete operations directly without LLM reconciliation.
     */
export async function reconciliationNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.reconciliation", async () => {
    logger.verbose("Starting reconciliation", {
      operationMode: state.operationMode,
      verifiedIntentCount: state.verifiedIntents.length,
      targetIntentIds: state.targetIntentIds
    });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    // Phase 4: Handle delete operations directly
    if (state.operationMode === 'delete') {
      if (!state.targetIntentIds || state.targetIntentIds.length === 0) {
        logger.warn("Delete mode with no target IDs");
        return {
          actions: [],
          agentTimings: agentTimingsAccum,
          trace: [{ node: "reconciler", detail: "Delete mode with no target IDs" }],
        };
      }

      logger.verbose("Delete mode - generating expire actions", {
        targetIds: state.targetIntentIds
      });

      const actions = state.targetIntentIds.map(id => ({
        type: 'expire' as const,
        id,
        reasoning: 'User requested deletion'
      }));

      return {
        actions,
        agentTimings: agentTimingsAccum,
        trace: [{
          node: "reconciler",
          detail: `Actions: expire=${actions.length}`,
        }],
      };
    }

    // Standard reconciliation for create/update operations
    const candidates = state.verifiedIntents;
    if (candidates.length === 0) {
      logger.verbose("No verified intents to reconcile");
      return {
        actions: [],
        agentTimings: agentTimingsAccum,
        trace: [{ node: "reconciler", detail: "No intents to reconcile" }],
      };
    }

    if (state.operationMode === 'update') {
      const explicitUpdate = buildExplicitUpdateActions(
        state.targetIntentIds,
        state.activeIntentIds,
        candidates,
      );
      return {
        actions: explicitUpdate.actions,
        validationFailures: explicitUpdate.failure
          ? [...state.validationFailures, explicitUpdate.failure]
          : state.validationFailures,
        agentTimings: agentTimingsAccum,
        trace: [{
          node: 'reconciler',
          detail: explicitUpdate.failure
            ? `Explicit update rejected: ${explicitUpdate.failure.category}`
            : `Explicit update bound to target ${state.targetIntentIds?.[0]}`,
        }],
      };
    }

    // Format candidates for the Reconciler Prompt
    const formattedCandidates = candidates.map(c =>
      `- [${c.type.toUpperCase()}] "${c.description}" (Confidence: ${c.confidence}, Score: ${c.score})\n` +
      `  Reasoning: ${c.reasoning}\n` +
      `  Verification: ${c.verification?.classification} (Flags: ${c.verification?.flags.join(', ') || 'None'})`
    ).join('\n');

    logger.verbose("Invoking reconciler agent", {
      candidateCount: candidates.length,
      operationMode: state.operationMode
    });

    const _traceEmitterReconciler = requestContext.getStore()?.traceEmitter;
    const reconcilerStart = Date.now();
    _traceEmitterReconciler?.({ type: "agent_start", name: "intent-reconciler" });
    const result = await deps.reconciler.invoke(formattedCandidates, state.activeIntents);
    agentTimingsAccum.push({ name: 'intent.reconciler', durationMs: Date.now() - reconcilerStart });
    _traceEmitterReconciler?.({ type: "agent_end", name: "intent-reconciler", durationMs: Date.now() - reconcilerStart, summary: `Reconciled ${result.actions.length} action(s)` });

    const actions = enforceIntentActionBoundary(
      state.operationMode,
      state.targetIntentIds,
      result.actions,
    );
    logger.verbose("Reconciliation complete", {
      actionCount: actions.length,
      droppedActionCount: result.actions.length - actions.length,
      operationMode: state.operationMode
    });

    // Count actions by type after enforcing the operation boundary.
    const counts = { create: 0, update: 0, expire: 0 };
    for (const a of actions) {
      if (a.type in counts) counts[a.type as keyof typeof counts]++;
    }

    return {
      actions,
      agentTimings: agentTimingsAccum,
      trace: [{
        node: "reconciler",
        detail: `Actions: create=${counts.create}, update=${counts.update}, expire=${counts.expire}`,
      }],
    };
  });
}
