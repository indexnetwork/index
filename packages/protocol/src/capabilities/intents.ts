/**
 * intents — the capability's single public surface.
 *
 * Everything the rest of the package (and every host) may reach lives on the
 * {@link Intents} class. The directories beside this file are private
 * implementation, grouped by what they do rather than by layer:
 *
 *   graph/               the lifecycle graph — prep, infer, verify, reconcile, execute
 *   intent.inferrer      an utterance into candidate signals
 *   intent.reconciler    candidate signals into create/update/expire actions
 *   intent.verifier      felicity and entropy verdicts
 *   intent.clarifier     a typed payload into a clarified payload plus questions
 *   intent.tools         the agent-facing tool definitions
 *
 * Only the graph keeps a directory. Nothing outside `intents/` imports any of
 * it; the layout may change freely as long as this class keeps its shape.
 */

import type { DefineTool } from "../internal/shared/agent/tool.helpers.js";
import type { IntentGraphDatabase } from "../platform/database.js";
import type { EmbeddingGenerator } from "../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../platform/runtime/follow-up.js";

import { IntentGraphFactory } from "../internal/intents/graph/intent.graph.js";
import { normalizeIntentDescription } from "../internal/intents/graph/intent.graph.shared.js";
import { IntentClarifier } from "../internal/intents/intent.clarifier.js";
import { ExplicitIntentInferrer } from "../internal/intents/intent.inferrer.js";
import { IntentReconciler } from "../internal/intents/intent.reconciler.js";
import { createIntentTools } from "../internal/intents/intent.tools.js";
import { SemanticVerifier } from "../internal/intents/intent.verifier.js";

import type { ClarifyAnswer, ClarifyInput, ClarifyQuestion, ClarifyQuestionOption, ClarifyResult } from "../internal/intents/intent.clarifier.js";
import type { IntentToolDeps } from "../internal/intents/intent.tools.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type {
  ClarifyAnswer,
  ClarifyInput,
  ClarifyQuestion,
  ClarifyQuestionOption,
  ClarifyResult,
  IntentToolDeps,
};

/**
 * Host capabilities the intent lifecycle needs.
 *
 * Every field is optional: a host that only wants the model-backed helpers
 * (verification, clarification) can construct `new Intents()` with nothing.
 * {@link Intents.createGraph} is the one method that requires `database`.
 */
export interface IntentsDeps {
  /** Signal persistence. Required by {@link Intents.createGraph}. */
  database?: IntentGraphDatabase;
  /** Embedding generator used to vectorize executed signals. */
  embedder?: EmbeddingGenerator;
  /** Host follow-up work started after a persist (HyDE, discovery). */
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

  private verifier?: SemanticVerifier;
  private clarifier?: IntentClarifier;

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

  // ── Clarification ───────────────────────────────────────────────────────────

  /**
   * Run one stateless clarification round over a signal payload.
   *
   * With no answers the payload comes back unchanged alongside the questions
   * worth asking; with answers the payload is rewritten to state them, then
   * whatever is still open is asked. Answering is always optional.
   *
   * @param input - The payload and any answers gathered so far.
   */
  public async clarify(input: ClarifyInput): Promise<ClarifyResult> {
    this.clarifier ??= new IntentClarifier();
    return this.clarifier.invoke(input);
  }

  // ── Stateless surface ───────────────────────────────────────────────────────

  /** Normalize a signal description to its persisted form. */
  public static normalizeDescription(description: string): string {
    return normalizeIntentDescription(description);
  }

  /** Register the agent-facing intent tools against a tool definer. */
  public static createTools(defineTool: DefineTool, deps: IntentToolDeps) {
    return createIntentTools(defineTool, deps);
  }
}
