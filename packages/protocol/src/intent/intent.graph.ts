import { StateGraph, START, END } from "@langchain/langgraph";
import { IntentGraphState, VerifiedIntent, ExecutionResult } from "./intent.state.js";
import { ExplicitIntentInferrer } from "./intent.inferrer.js";
import { SemanticVerifier } from "./intent.verifier.js";
import { DEFAULT_SPECIFICITY_WARNING } from "./intent.specificity.js";
import { IntentReconciler } from "./intent.reconciler.js";
import type { NormalizedIntentAction } from "./intent.reconciler.js";
import { IntentGraphDatabase } from "../shared/interfaces/database.interface.js";
import { getAbortSignalConfig } from "../shared/agent/model-signal.js";
import type { EmbeddingGenerator } from "../shared/interfaces/embedder.interface.js";
import type { IntentGraphQueue } from "../shared/interfaces/queue.interface.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { timed } from "../shared/observability/performance.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { DebugMetaAgent } from "../chat/chat-streaming.types.js";
import type { QuestionerEnqueueFn } from "../questioner/questioner.types.js";

const logger = protocolLogger("IntentGraphFactory");

/**
 * Enforce write-mode constraints on reconciler output before any action can
 * reach persistence. Update mode is deliberately fail-closed: only updates
 * whose id is one of the caller-provided targets survive.
 */
export function enforceIntentActionBoundary(
  operationMode: 'create' | 'update' | 'delete' | 'read' | 'propose',
  targetIntentIds: string[] | undefined,
  actions: NormalizedIntentAction[],
): NormalizedIntentAction[] {
  if (operationMode !== 'update') return actions;
  const targets = new Set(targetIntentIds ?? []);
  return actions.filter((action) => action.type === 'update' && targets.has(action.id));
}

const MAX_PERMISSIBLE_ENTROPY = 0.75;
const MIN_CLEAR_INTENT_SCORE = 40;
const GENERIC_JOB_PHRASE = /\b(?:a|any|some)\s+job\b/i;

const inferRoleFromContextText = (text: string): string | null => {
  const normalized = text.toLowerCase();
  if (/\b(engineer|developer)\b/.test(normalized)) return "software engineering";
  if (/\b(designer|ux|ui)\b/.test(normalized)) return "product design";
  if (/\b(marketing|marketer|growth)\b/.test(normalized)) return "marketing";
  if (/\b(product manager|product)\b/.test(normalized)) return "product management";
  if (/\b(data scientist|machine learning|ml|ai)\b/.test(normalized)) return "AI/ML";
  if (/\b(sales|account executive|business development)\b/.test(normalized)) return "sales";
  return null;
};

/**
 * Derive a job-role qualifier from the user's global user_context paragraph
 * (the identity text that replaced the legacy profile projection). Role is
 * inferred from the free text; the old structured skills/interests extraction
 * is gone with the removed profile fields.
 */
const buildJobQualifierFromContext = (contextText: string): string | null => {
  const roleHint = inferRoleFromContextText(contextText ?? "");
  return roleHint ? `${roleHint} role` : null;
};

const enrichVagueIntentWithContext = (description: string, userContext: string): string => {
  const trimmed = description?.trim();
  if (!trimmed) return description;

  const isGenericJobRequest =
    GENERIC_JOB_PHRASE.test(trimmed) ||
    /\b(?:find|get|look(?:ing)?\s+for|want)\s+(?:to\s+)?(?:find\s+)?job\b/i.test(trimmed);
  if (!isGenericJobRequest) return description;

  const qualifier = buildJobQualifierFromContext(userContext);
  if (!qualifier) return description;

  const enriched = trimmed
    .replace(/\ba job\b/i, `a ${qualifier}`)
    .replace(/\bjob\b/i, `${qualifier}`)
    .replace(/\s{2,}/g, " ")
    .trim();

  return enriched.length > 0 ? enriched : description;
};

const isVague = (description: string, entropy: number, clarity: number): boolean => {
  if (GENERIC_JOB_PHRASE.test(description)) return true;
  if (entropy > MAX_PERMISSIBLE_ENTROPY) return true;
  if (clarity < MIN_CLEAR_INTENT_SCORE) return true;
  return false;
};

const getSpecificityWarning = (verdict: { specificity_warning?: string | null }): string => {
  const warning = verdict.specificity_warning?.trim();
  return warning && warning.length > 0 ? warning : DEFAULT_SPECIFICITY_WARNING;
};

const toSpeechActType = (classification?: string): "COMMISSIVE" | "DIRECTIVE" | null => {
  if (classification === "COMMISSIVE" || classification === "DIRECTIVE") return classification;
  return null;
};

/**
 * Factory class to build and compile the Intent Processing Graph.
 */
export class IntentGraphFactory {
  constructor(
    private database: IntentGraphDatabase,
    private embedder?: EmbeddingGenerator,
    private intentQueue?: IntentGraphQueue,
    private questionerEnqueue?: QuestionerEnqueueFn,
  ) { }

  public createGraph() {
    // Instantiate Agents (Nodes)
    const inferrer = new ExplicitIntentInferrer();
    const verifier = new SemanticVerifier();
    const reconciler = new IntentReconciler();

    // --- NODE DEFINITIONS ---

    /**
     * Node 0: Prep
     * Always fetches ALL of the user's active intents from the DB via getActiveIntents(userId).
     * This ensures reconciliation can detect duplicates and modifications globally,
     * regardless of network scope.
     */
    const prepNode = async (state: typeof IntentGraphState.State) => {
      return timed("IntentGraph.prep", async () => {
        logger.verbose("Starting preparation phase", {
          operationMode: state.operationMode,
          hasContent: !!state.inputContent,
          targetIntentIds: state.targetIntentIds,
          networkId: state.networkId,
        });

        // Gate: write operations require an existing profile
        if (state.operationMode !== 'read') {
          const profile = await this.database.getProfile(state.userId);
          if (!profile) {
            const msg = "You need to create a profile before creating intents. Please set up your profile first.";
            logger.error("Prep failed: no profile for user", { userId: state.userId });
            return { error: msg };
          }
        }

        const activeIntents = await this.database.getActiveIntents(state.userId);
        const formattedActiveIntents = activeIntents
          .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
          .join('\n') || "No active intents.";

        logger.verbose("Fetched active intents", {
          count: activeIntents.length,
          operationMode: state.operationMode
        });

        return {
          activeIntents: formattedActiveIntents,
          trace: [{
            node: "prep",
            detail: `Fetched ${activeIntents.length} active intent(s)`,
          }],
        };
      });
    };

    /**
     * Node 1: Inference
     * Extracts intents from raw content.
     * Phase 4: Uses operation mode to control behavior and determine if node should execute.
     * Phase 5: Passes conversation context for anaphoric resolution.
     */
    const inferenceNode = async (state: typeof IntentGraphState.State) => {
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

        // Cast operationMode: 'read' and 'propose' map to 'create' for the inferrer
        // (inference node is never called in read mode; propose behaves like create for inference)
        const inferrerMode = (state.operationMode === 'read' || state.operationMode === 'propose') ? 'create' : state.operationMode;
        const _traceEmitterInferrer = requestContext.getStore()?.traceEmitter;
        const inferrerStart = Date.now();
        _traceEmitterInferrer?.({ type: "agent_start", name: "intent-inferrer" });
        const result = await inferrer.invoke(
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
    };

    /**
     * Node 2: Verification (Map-Reduce / Parallel)
     * Verifies each inferred intent in parallel.
     * Phase 4: Can be skipped for delete operations and updates with no new intents.
     */
    const verificationNode = async (state: typeof IntentGraphState.State) => {
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
          intents.map(async (intent): Promise<VerifiedIntent | null> => {
            try {
              let description = intent.description;
              const _traceEmitterVerifier = requestContext.getStore()?.traceEmitter;
              const verifierStart1 = Date.now();
              _traceEmitterVerifier?.({ type: "agent_start", name: "intent-verifier" });
              let verdict = await verifier.invoke(description, state.userProfile);
              agentTimingsAccum.push({ name: 'intent.verifier', durationMs: Date.now() - verifierStart1 });
              _traceEmitterVerifier?.({ type: "agent_end", name: "intent-verifier", durationMs: Date.now() - verifierStart1, summary: `Verified: ${verdict.classification}` });

              if (isVague(description, verdict.semantic_entropy, verdict.felicity_scores.clarity)) {
                // Role-hint enrichment for vague job intents reads the global
                // user_context paragraph instead of the structured profile fields.
                const roleHintContext = (await this.database.getUserContext(state.userId, null))?.text ?? '';
                const enrichedDescription = enrichVagueIntentWithContext(description, roleHintContext);
                if (enrichedDescription !== description) {
                  logger.verbose("Enriched vague intent using profile context", {
                    before: description,
                    after: enrichedDescription,
                  });
                  const _traceEmitterVerifier2 = requestContext.getStore()?.traceEmitter;
                  const verifierStart2 = Date.now();
                  _traceEmitterVerifier2?.({ type: "agent_start", name: "intent-verifier" });
                  const enrichedVerdict = await verifier.invoke(enrichedDescription, state.userProfile);
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
                return null;
              }

              if (isVague(description, verdict.semantic_entropy, verdict.felicity_scores.clarity)) {
                logger.warn('Dropping vague intent after verification', {
                  description,
                  entropy: verdict.semantic_entropy,
                  clarity: verdict.felicity_scores.clarity,
                });
                return null;
              }

              if (state.operationMode !== 'propose' && verdict.referential_breadth === 'broad') {
                logger.warn('Dropping broad attributive intent before persistence', {
                  description,
                  referentialBreadth: verdict.referential_breadth,
                  missingSelectionalConstraints: verdict.missing_selectional_constraints,
                  warning: getSpecificityWarning(verdict),
                });
                return null;
              }

              // Calculate Score
              const score = Math.min(
                verdict.felicity_scores.authority,
                verdict.felicity_scores.sincerity,
                verdict.felicity_scores.clarity
              );

              // Return enriched intent
              return {
                ...intent,
                description,
                verification: verdict,
                score
              };
            } catch (e) {
              logger.error('Error verifying intent', { description: intent.description, error: e });
              return null;
            }
          })
        );

        // Filter out nulls
        const verified = verificationResults.filter((i): i is VerifiedIntent => i !== null);
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

        return { verifiedIntents: verified, agentTimings: agentTimingsAccum, trace: traceEntries };
      });
    };

    /**
     * Node 3: Reconciliation
     * Decides on final actions (Create, Update, Expire).
     * Phase 4: Handles delete operations directly without LLM reconciliation.
     */
    const reconciliationNode = async (state: typeof IntentGraphState.State) => {
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
        const result = await reconciler.invoke(formattedCandidates, state.activeIntents);
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
    };

    /** Strip URLs and "More details at [url]" from intent payloads before persisting. */
    const sanitizePayload = (payload: string): string => {
      if (!payload || typeof payload !== "string") return payload;
      const out = payload
        .replace(/\s*More details at\s*:?\s*https?:\/\/[^\s"'<>)\]]+/gi, "")
        .replace(/\s*See\s+https?:\/\/[^\s"'<>)\]]+\s+for\s+more[^.]*\.?/gi, "")
        .replace(/https?:\/\/[^\s"'<>)\]]+/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return out.replace(/[.,;]\s*$/, "").trim() || payload;
    };

    /**
     * Generate a flat embedding for an intent payload, swallowing failures so
     * persistence can continue without an embedding. `intentId` is logging-only
     * (present for updates, absent for creates).
     */
    const generateIntentEmbedding = async (
      sanitizedPayload: string,
      intentId?: string,
    ): Promise<number[] | undefined> => {
      if (!this.embedder) return undefined;
      try {
        const embedding = await this.embedder.generate(sanitizedPayload, undefined, getAbortSignalConfig());
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
    };

    /**
     * Node 4: Executor
     * Executes reconciler actions against the database.
     */
    const executorNode = async (state: typeof IntentGraphState.State) => {
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
          verifiedIntentByPayload.set(sanitizePayload(verifiedIntent.description), verifiedIntent);
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
              const sanitizedPayload = sanitizePayload(createAction.payload);
              const matchedVerifiedIntent =
                verifiedIntentByPayload.get(createAction.payload) ||
                verifiedIntentByPayload.get(sanitizedPayload);

              // Generate embedding for the intent payload
              const flatEmbedding = await generateIntentEmbedding(sanitizedPayload);

              const created = await this.database.createIntent({
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

              this.intentQueue?.addGenerateHydeJob({
                intentId: created.id,
                userId: state.userId,
                ...scopeEnvelope,
              }).catch((err) =>
                logger.error('Failed to enqueue intent HyDE job', { intentId: created.id, error: err })
              );

              if (this.questionerEnqueue) {
                const userContext = (await this.database.getUserContext(state.userId, null))?.text ?? '';
                this.questionerEnqueue({
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
              const sanitizedPayload = sanitizePayload(updateAction.payload);
              const matchedVerifiedIntent =
                verifiedIntentByPayload.get(updateAction.payload) ||
                verifiedIntentByPayload.get(sanitizedPayload);

              // Regenerate embedding for the updated payload
              const flatEmbedding = await generateIntentEmbedding(sanitizedPayload, updateAction.id);

              const updated = await this.database.updateIntent(updateAction.id, {
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
                this.intentQueue?.addGenerateHydeJob({
                  intentId: updateAction.id,
                  userId: state.userId,
                  ...scopeEnvelope,
                }).catch((err) =>
                  logger.error('Failed to enqueue intent HyDE job', { intentId: updateAction.id, error: err })
                );
              }

            } else if (actionType === 'expire') {
              const expireAction = action as { id: string };
              const result = await this.database.archiveIntent(expireAction.id);
              results.push({
                actionType: 'expire',
                success: result.success,
                intentId: expireAction.id,
                error: result.error
              });
              logger.verbose('Archived intent', { intentId: expireAction.id });
              if (result.success) {
                this.intentQueue?.addDeleteHydeJob({ intentId: expireAction.id }).catch((err) =>
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
    };

    // --- QUERY NODE (Read Mode) ---

    /**
     * Node: Query
     * Fast-path read node — fetches intents from DB based on scope.
     * Handles: global user intents, network-scoped (all or filtered by user).
     * No LLM calls; no inference/verification/reconciliation.
     */
    const queryNode = async (state: typeof IntentGraphState.State) => {
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
            const intents = await this.database.getActiveIntentsAcrossIndexes(
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
            const isMember = await this.database.isNetworkMember(effectiveIndexId, state.userId);
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
              const intents = await this.database.getNetworkIntentsForMember(
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
            const intents = await this.database.getIntentsInIndexForMember(
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
            const user = await this.database.getUser(effectiveUserId);
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
          const intents = await this.database.getActiveIntents(state.userId);
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
    };

    // --- CONDITIONAL ROUTING FUNCTIONS ---

    /**
     * After prep: read mode → query; otherwise decide inference vs reconciler by operation mode.
     */
    const afterPrepRoute = (state: typeof IntentGraphState.State): string => {
      if (state.error) {
        logger.warn('Prep failed with error, short-circuiting to END', { error: state.error });
        return '__end__';
      }
      if (state.operationMode === 'read') {
        logger.verbose('Read mode - routing to query (fast path)');
        return 'query';
      }
      return shouldRunInference(state);
    };

    /**
     * Determines if inference should run based on operation mode.
     * Delete operations skip inference entirely and go straight to reconciliation.
     */
    const shouldRunInference = (state: typeof IntentGraphState.State): string => {
      if (state.operationMode === 'delete') {
        logger.verbose('Delete mode - skipping inference, routing to reconciliation');
        return 'reconciler';
      }

      logger.verbose('Running inference', {
        operationMode: state.operationMode
      });
      return 'inference';
    };

    /**
     * Determines if verification should run based on operation mode and inferred intents.
     * Skips verification for:
     * - Operations with no inferred intents
     * - Can be extended to skip for update operations with no new intents
     */
    const shouldRunVerification = (state: typeof IntentGraphState.State): string => {
      if (state.inferredIntents.length === 0) {
        if (state.operationMode === 'propose') {
          logger.verbose('Propose mode with no inferred intents - exiting early');
          return '__end__';
        }
        logger.verbose('No intents to verify - skipping verification, routing to reconciliation');
        return 'reconciler';
      }

      if (state.operationMode === 'update') {
        logger.verbose('Update mode with new intents - running verification');
        return 'verification';
      }

      if (state.operationMode === 'create') {
        logger.verbose('Create mode - running verification');
        return 'verification';
      }

      // Default to verification for safety
      logger.verbose('Default routing to verification');
      return 'verification';
    };

    // --- GRAPH ASSEMBLY WITH CONDITIONAL EDGES (PHASE 4) ---

    const workflow = new StateGraph(IntentGraphState)
      .addNode("prep", prepNode)
      .addNode("query", queryNode)
      .addNode("inference", inferenceNode)
      .addNode("verification", verificationNode)
      .addNode("reconciler", reconciliationNode)
      .addNode("executor", executorNode)

      // Flow paths:
      // - READ:    prep → query → END (fast path, no LLM calls)
      // - CREATE:  prep → inference → verification → reconciler → executor → END
      // - UPDATE:  prep → inference → reconciliation → executor → END (skips verification if no new intents)
      // - DELETE:  prep → reconciliation → executor → END (skips inference and verification)
      // - PROPOSE: prep → inference → verification → END (no reconciliation/execution, no DB writes)
      .addEdge(START, "prep")

      // After prep: read mode → query; else inference or reconciler
      .addConditionalEdges("prep", afterPrepRoute, {
        query: "query",
        inference: "inference",
        reconciler: "reconciler",
        __end__: END,
      })

      // Query (read mode) always ends
      .addEdge("query", END)

      // After inference: decide if we need verification (skip if no intents)
      .addConditionalEdges("inference", shouldRunVerification, {
        verification: "verification",
        reconciler: "reconciler",
        __end__: END,
      })

      // After verification: propose mode exits early; others continue to reconciliation
      .addConditionalEdges("verification", (state: typeof IntentGraphState.State) => {
        if (state.operationMode === 'propose') {
          logger.verbose('Propose mode - stopping after verification, skipping reconciliation');
          return '__end__';
        }
        return 'reconciler';
      }, {
        reconciler: "reconciler",
        __end__: END,
      })

      // Reconciliation always goes to executor
      .addEdge("reconciler", "executor")

      // Executor is always the end
      .addEdge("executor", END);

    return workflow.compile();
  }
}
