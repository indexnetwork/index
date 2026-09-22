/**
 * intents — the capability's single public surface.
 *
 * Everything the rest of the package (and every host) may reach lives on the
 * {@link Intents} class. The directories beside this file are private
 * implementation, grouped by what they do rather than by layer:
 *
 *   graph/               the lifecycle graph — prepare/create; infer/verify explicit updates
 *   intent.inferrer      an utterance into candidate signals
 *   intent.verifier      felicity and entropy verdicts
 *   intent.preparer        a typed payload into an admitted draft or recovery form
 *
 * Only the graph keeps a directory. Nothing outside `intents/` imports any of
 * it; the layout may change freely as long as this class keeps its shape.
 */

import type { IntentGraphDatabase } from "../platform/database.js";
import type { EmbeddingGenerator } from "../platform/discovery/embedder.js";
import type { IntentFollowUp } from "../platform/runtime/follow-up.js";

import { IntentGraphFactory } from "../internal/intents/graph/intent.graph.js";
import { normalizeIntentDescription } from "../internal/intents/graph/intent.graph.shared.js";
import { IntentPreparer } from "../internal/intents/intent.preparer.js";
import { ExplicitIntentInferrer } from "../internal/intents/intent.inferrer.js";
import { semanticMetadata } from "../internal/intents/intent.admission.js";
import { SemanticVerifier } from "../internal/intents/intent.verifier.js";

import type { PrepareInput, PrepareResult } from "../internal/intents/intent.preparer.js";

export type { IntentSemanticMetadata } from "../internal/intents/intent.admission.js";
export type { PreparedIntent } from "../internal/intents/intent.preparer.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type {
  PrepareAnswer,
  PrepareInput,
  PrepareResult,
  RecoveryField,
  RecoveryFieldKind,
  RecoveryFieldOption,
} from "../internal/intents/intent.preparer.js";

/**
 * Host capabilities the intent lifecycle needs.
 *
 * Every field is optional: a host that only wants the model-backed helpers
 * (verification, preparation) can construct `new Intents()` with nothing.
 * {@link Intents.createGraph} is the one method that requires `database`.
 */
export interface IntentsDeps {
  /** Signal persistence. Required by {@link Intents.createGraph}. */
  database?: IntentGraphDatabase;
  /** Embedding generator used to vectorize executed signals. */
  embedder?: EmbeddingGenerator;
  /** Host follow-up work started after a persist. */
  followUp?: IntentFollowUp;
  /**
   * Model-backed stages, injectable so tests can run the graph without a model.
   * Omitted stages construct their canonical implementation on first use.
   */
  agents?: {
    inferrer?: Pick<ExplicitIntentInferrer, "invoke">;
    verifier?: Pick<SemanticVerifier, "invoke">;
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

  private verifier?: Pick<SemanticVerifier, "invoke">;
  private preparer?: IntentPreparer;

  constructor(deps: IntentsDeps = {}) {
    this.deps = deps;
  }

  // ── Lifecycle graph ─────────────────────────────────────────────────────────

  /**
   * Build the intent lifecycle graph — prepare and create, or explicitly read, update, archive, and transition.
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
    this.verifier ??= this.deps.agents?.verifier ?? new SemanticVerifier();
    return this.verifier.invoke(content, profileContext);
  }

  // ── Preparation ─────────────────────────────────────────────────────────────

  /**
   * Prepare one signal draft for creation admission.
   *
   * Fold recovery answers into the draft, then apply creation admission. A
   * ready result authorizes final review; needs_revision returns admission
   * feedback and a dynamic recovery form.
   * @returns The admitted draft or repairable feedback and recovery fields.
   * @throws On model failure; the host must expose a retryable failure.
   *
   * @param input - The payload and any recovery answers gathered so far.
   */
  public async prepare(input: PrepareInput): Promise<PrepareResult> {
    this.preparer ??= new IntentPreparer(this.deps.agents?.verifier);
    return this.preparer.invoke(input);
  }

  /**
   * Measure text without applying any admission filters.
   * @param content - The exact saved description.
   * @param profileContext - The speaker's profile, serialized as JSON.
   * @returns Metadata even when the verdict would fail admission.
   * @throws On model failure; callers must leave the saved intent intact.
   */
  public async scoreIntent(content: string, profileContext = "") {
    return semanticMetadata(await this.verifyIntent(content, profileContext));
  }

  // ── Stateless surface ───────────────────────────────────────────────────────

  /** Normalize explicit updates. Creation preserves the submitted description verbatim. */
  public static normalizeDescription(description: string): string {
    return normalizeIntentDescription(description);
  }
}
