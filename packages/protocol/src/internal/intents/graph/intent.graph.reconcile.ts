/**
 * Intent graph, stages 2-3: verify inferred signals, then reconcile against what exists.
 */

import { VerifiedIntent, type IntentValidationFailure } from "./intent.graph.state.js";
import { timed } from "../../shared/observability/performance.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../../../protocol/core.js";
import { buildExplicitUpdateActions, getSpecificityWarning, isExplicitUpdateRequest, isVague, logger, type IntentGraphDeps, type IntentState } from "./intent.graph.shared.js";


    /**
     * Node 2: Verification (Map-Reduce / Parallel)
     * Verifies each inferred intent in parallel.
     * Phase 4: Can be skipped for delete operations and updates with no new intents.
     */
export async function verificationNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.verification", async () => {
    const intents = state.inferredIntents;
    const isExplicitUpdate = isExplicitUpdateRequest(state);

    logger.verbose("Starting verification", {
      isExplicitUpdate,
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
          const description = intent.description;
          const _traceEmitterVerifier = requestContext.getStore()?.traceEmitter;
          const verifierStart = Date.now();
          _traceEmitterVerifier?.({ type: "agent_start", name: "intent-verifier" });
          const verdict = await deps.verifier.invoke(description, state.userProfile);
          agentTimingsAccum.push({ name: 'intent.verifier', durationMs: Date.now() - verifierStart });
          _traceEmitterVerifier?.({ type: "agent_end", name: "intent-verifier", durationMs: Date.now() - verifierStart, summary: `Verified: ${verdict.classification}` });

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

          // A vague description is rejected, never rewritten from the user's
          // profile: when the system lacks information it asks. Callers turn
          // this failure into a clarifying question.
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

          if (!state.dryRun && !isExplicitUpdate && verdict.referential_breadth === 'broad') {
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
      isExplicitUpdate,
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
     * Decides on final actions. Archive, transition, and confirm build their
     * one deterministic action directly (no LLM). Explicit update binds to its
     * one target. A bare content path (no target) reconciles via the LLM.
     */
export async function reconciliationNode(state: IntentState, deps: IntentGraphDeps) {
  return timed("IntentGraph.reconciliation", async () => {
    logger.verbose("Starting reconciliation", {
      verifiedIntentCount: state.verifiedIntents.length,
      targetIntentIds: state.targetIntentIds,
      archive: state.archive,
      status: state.status,
      hasProposal: !!state.proposalId,
    });

    const agentTimingsAccum: DebugMetaAgent[] = [];

    if (state.archive) {
      const actions = (state.targetIntentIds ?? []).map(id => ({
        type: 'expire' as const,
        id,
        reasoning: 'User requested deletion'
      }));
      return {
        actions,
        agentTimings: agentTimingsAccum,
        trace: [{ node: "reconciler", detail: `Actions: expire=${actions.length}` }],
      };
    }

    if (state.status !== undefined) {
      const actions = [{ type: 'transition' as const, id: state.targetIntentIds![0], status: state.status }];
      return {
        actions,
        agentTimings: agentTimingsAccum,
        trace: [{ node: "reconciler", detail: `Actions: transition=1 (${state.status})` }],
      };
    }

    if (state.proposalId !== undefined) {
      const actions = [{
        type: 'confirm' as const,
        proposalId: state.proposalId,
        description: state.description ?? '',
        ...(state.networkId ? { networkId: state.networkId } : {}),
      }];
      return {
        actions,
        agentTimings: agentTimingsAccum,
        trace: [{ node: "reconciler", detail: "Actions: confirm=1" }],
      };
    }

    // Content path: explicit update or bare create.
    const candidates = state.verifiedIntents;
    if (candidates.length === 0) {
      logger.verbose("No verified intents to reconcile");
      return {
        actions: [],
        agentTimings: agentTimingsAccum,
        trace: [{ node: "reconciler", detail: "No intents to reconcile" }],
      };
    }

    if (isExplicitUpdateRequest(state)) {
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
    });

    const _traceEmitterReconciler = requestContext.getStore()?.traceEmitter;
    const reconcilerStart = Date.now();
    _traceEmitterReconciler?.({ type: "agent_start", name: "intent-reconciler" });
    const result = await deps.reconciler.invoke(formattedCandidates, state.activeIntents);
    agentTimingsAccum.push({ name: 'intent.reconciler', durationMs: Date.now() - reconcilerStart });
    _traceEmitterReconciler?.({ type: "agent_end", name: "intent-reconciler", durationMs: Date.now() - reconcilerStart, summary: `Reconciled ${result.actions.length} action(s)` });

    // Bare create path: no target boundary to enforce (that only applies to
    // an explicit update, handled above).
    const actions = result.actions;
    logger.verbose("Reconciliation complete", {
      actionCount: actions.length,
    });

    // Count actions by type.
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
