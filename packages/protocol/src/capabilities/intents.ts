/**
 * intents — the capability's single public surface.
 *
 * Everything the rest of the package (and every host) may reach lives on the
 * {@link Intents} class. The directories beside this file are private
 * implementation, grouped by what they do rather than by layer:
 *
 *   graph/               the lifecycle graph — prep, infer, verify, reconcile, execute
 *   intake/              the guided first-signal interview
 *   intent.inferrer      an utterance into candidate signals
 *   intent.reconciler    candidate signals into create/update/expire actions
 *   intent.verifier      felicity and entropy verdicts
 *   intent.clarifier     the clarification path when a signal is underspecified
 *   intent.indexer       scoring one signal against one network
 *   intent.proposal      the persisted proposal record and description normalization
 *   intent.tools         the agent-facing tool definitions
 *
 * Only the two multi-file stages keep a directory. Nothing outside `intents/`
 * imports any of it; the layout may change freely as long as this class keeps
 * its shape.
 */

import type { DefineTool } from "../internal/shared/agent/tool.helpers.js";
import type { IntentGraphDatabase } from "../platform/database.js";
import type { EmbeddingGenerator } from "../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../platform/runtime/follow-up.js";

import { IntentGraphFactory } from "../internal/intents/graph/intent.graph.js";
import { IntentIndexer } from "../internal/shared/intent-indexer.js";
import { ExplicitIntentInferrer } from "../internal/intents/intent.inferrer.js";
import { IntentReconciler } from "../internal/intents/intent.reconciler.js";
import { FALLBACK_WHO_QUESTION, SignalIntakeOrchestrator } from "../internal/intents/intake/intake.orchestrator.js";
import { SignalIntakePackGenerator } from "../internal/intents/intake/intake.pack.generator.js";
import { normalizeIntentDescription } from "../internal/intents/intent.proposal.js";
import { createIntentTools } from "../internal/intents/intent.tools.js";
import { SemanticVerifier } from "../internal/intents/intent.verifier.js";

import type { IntentIndexerOutput } from "../internal/shared/intent-indexer.js";
import type { FollowUpPlan, FollowUpPlanInput, IntakeAnswer, IntakeRound, SynthesisInput, SynthesisResult } from "../internal/intents/intake/intake.orchestrator.js";
import type { IntakePack, IntakePackInput, IntakePackQuestion, IntakePackQuestionOption } from "../internal/intents/intake/intake.pack.generator.js";
import type { IntentToolDeps } from "../internal/intents/intent.tools.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type {
  FollowUpPlan,
  FollowUpPlanInput,
  IntakeAnswer,
  IntakePack,
  IntakePackInput,
  IntakePackQuestion,
  IntakePackQuestionOption,
  IntakeRound,
  IntentIndexerOutput,
  IntentToolDeps,
  SynthesisInput,
  SynthesisResult,
};

/**
 * Host capabilities the intent lifecycle needs.
 *
 * Every field is optional: a host that only wants the model-backed helpers
 * (verification, indexing, intake) can construct `new Intents()` with nothing.
 * {@link Intents.createGraph} is the one method that requires `database`.
 */
export interface IntentsDeps {
  /** Signal persistence. Required by {@link Intents.createGraph}. */
  database?: IntentGraphDatabase;
  /** Embedding generator used to vectorize executed signals. */
  embedder?: EmbeddingGenerator;
  /** Host follow-up work started after a persist (HyDE, network assignment, discovery). */
  followUp?: IntentFollowUp;
  /**
   * Model-backed stages, injectable so tests can run the graph without a model.
   * Omitted stages construct their canonical implementation on first use.
   */
  agents?: {
    inferrer?: Pick<ExplicitIntentInferrer, "invoke">;
    verifier?: Pick<SemanticVerifier, "invoke">;
    reconciler?: Pick<IntentReconciler, "invoke">;
  };
}

/**
 * The intents capability.
 *
 * One instance is cheap: the model-backed collaborators behind each method are
 * constructed on first use and then reused, so a host can hold a single
 * `Intents` and call only the parts it needs without paying for the rest.
 */
export class Intents {
  private readonly deps: IntentsDeps;

  private indexer?: IntentIndexer;
  private verifier?: SemanticVerifier;
  private orchestrator?: SignalIntakeOrchestrator;
  private packGenerator?: SignalIntakePackGenerator;

  constructor(deps: IntentsDeps = {}) {
    this.deps = deps;
  }

  // ── Lifecycle graph ─────────────────────────────────────────────────────────

  /**
   * Build the intent lifecycle graph — load, infer, verify, reconcile, execute.
   *
   * @throws If the instance was constructed without a `database`.
   */
  public createGraph() {
    const { database, embedder, followUp, agents } = this.deps;
    if (!database) {
      throw new Error("Intents.createGraph() requires a `database` dependency.");
    }
    return new IntentGraphFactory(database, embedder, followUp, agents).createGraph();
  }

  // ── Verification ────────────────────────────────────────────────────────────

  /**
   * Verify one utterance against the speaker's profile — felicity conditions,
   * speech-act classification, semantic entropy, and specificity.
   *
   * @param content - The raw utterance.
   * @param profileContext - The speaker's profile, serialized as JSON.
   */
  public async verifyIntent(content: string, profileContext: string) {
    this.verifier ??= new SemanticVerifier();
    return this.verifier.invoke(content, profileContext);
  }

  // ── Indexing ────────────────────────────────────────────────────────────────

  /**
   * Score how well one signal fits one network, from the network's purpose and
   * the member's sharing preferences.
   *
   * @returns Scores and reasoning, or `null` when the model call fails.
   */
  public async indexIntent(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null,
    networkContext?: string | null,
  ): Promise<IntentIndexerOutput | null> {
    this.indexer ??= new IntentIndexer();
    return this.indexer.invoke(intent, indexPrompt, memberPrompt, sourceName, networkContext);
  }

  // ── Guided intake ───────────────────────────────────────────────────────────

  /** Generate a participant's intake brief and round-1 question. */
  public async generateIntakePack(input: IntakePackInput): Promise<IntakePack> {
    this.packGenerator ??= new SignalIntakePackGenerator();
    return this.packGenerator.generate(input);
  }

  /** Plan and write the next intake follow-up questions. */
  public async generateIntakeFollowUps(input: FollowUpPlanInput): Promise<FollowUpPlan> {
    this.orchestrator ??= new SignalIntakeOrchestrator();
    return this.orchestrator.generateFollowUps(input);
  }

  /** Turn answered intake rounds into a signal description and card summary. */
  public async synthesizeIntake(input: SynthesisInput): Promise<SynthesisResult> {
    this.orchestrator ??= new SignalIntakeOrchestrator();
    return this.orchestrator.synthesize(input);
  }

  // ── Stateless surface ───────────────────────────────────────────────────────

  /** The static round-1 question used when pack generation is unavailable. */
  public static readonly FALLBACK_INTAKE_QUESTION: IntakePackQuestion = FALLBACK_WHO_QUESTION;

  /** Normalize a signal description to its persisted form. */
  public static normalizeDescription(description: string): string {
    return normalizeIntentDescription(description);
  }

  /** Register the agent-facing intent tools against a tool definer. */
  public static createTools(defineTool: DefineTool, deps: IntentToolDeps) {
    return createIntentTools(defineTool, deps);
  }
}
