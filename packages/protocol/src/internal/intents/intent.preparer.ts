import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

import { admissionFailure, semanticMetadata, type IntentSemanticMetadata } from "./intent.admission.js";
import { SemanticVerifier } from "./intent.verifier.js";

/** One answer paired with the recovery field it fills. */
export interface PrepareAnswer { prompt: string; answer: string }
/** The current draft and recovery answers not yet folded into it. */
export interface PrepareInput { payload: string; answers?: PrepareAnswer[] }
export interface RecoveryFieldOption { label: string; description: string }
export type RecoveryFieldKind = "single" | "multi" | "text";
export interface RecoveryField {
  id: string;
  label: string;
  kind: RecoveryFieldKind;
  options?: RecoveryFieldOption[];
  placeholder?: string;
}

/** Host-authorized preparation. Null metadata authorizes revisions needing fresh measurements. Never accept this object from an untrusted client. */
export interface PreparedIntent { metadata: IntentSemanticMetadata | null }

/** Review is available only after admission of the complete prepared draft. */
export type PrepareResult =
  | { status: "ready"; payload: string; metadata: IntentSemanticMetadata }
  | { status: "needs_revision"; payload: string; feedback: string; recovery: RecoveryField[] };

const payloadSchema = z.object({ payload: z.string().trim().min(1).max(65_536) });
const recoveryOptionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  description: z.string().max(280).nullable().optional().transform((value) => value ?? ""),
});

const recoveryFieldSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(["single", "multi", "text"]),
  options: z.array(recoveryOptionSchema).min(2).max(5).nullable().optional(),
  placeholder: z.string().max(200).nullable().optional(),
});

const recoverySchema = z.object({
  recovery: z.array(recoveryFieldSchema).min(2).max(6),
});

function parseRecoveryFields(result: z.infer<typeof recoverySchema>): RecoveryField[] {
  return result.recovery.map((field) => {
    const placeholder = field.placeholder?.trim() || undefined;
    const options = field.options?.length ? field.options : undefined;
    if (field.kind === "text") {
      if (!placeholder) {
        throw new Error("Text recovery fields require a placeholder.");
      }
      return { id: field.id, label: field.label, kind: field.kind, placeholder };
    }
    if (!options?.length) {
      throw new Error("Single and multi recovery fields require options.");
    }
    return { id: field.id, label: field.label, kind: field.kind, options };
  });
}

/** Folds recovery answers into a draft, admits its final form, and returns a dynamic recovery form on failure. Model failures propagate for retry. */
export class IntentPreparer {
  constructor(private readonly verifier: Pick<SemanticVerifier, "invoke"> = new SemanticVerifier()) {}

  /**
   * Prepare one draft using the creation admission policy.
   * @param input - Current payload and pending recovery answers.
   * @param profileContext - The speaker's profile, if supplied by the host.
   * @returns An admitted draft or admission feedback plus a recovery form.
   * @throws When rewriting, verification, or recovery generation fails; callers must retain the input for retry.
   */
  public async invoke(input: PrepareInput, profileContext = ""): Promise<PrepareResult> {
    const answers = (input.answers ?? []).filter((answer) => answer.answer.trim());
    let payload = input.payload;
    if (answers.length > 0) {
      const model = createStructuredModel("intentClarifier", payloadSchema, { name: "intent_draft" });
      const result = await invokeWithAbortSignal(model, [
        new SystemMessage("Fold every supplied answer into the signal in the person's own voice. Preserve all existing details unless an answer explicitly changes them. Every claim must trace to the draft or answers; never invent constraints or facts to make a signal pass validation. Return the complete draft, concise and concrete."),
        new HumanMessage(JSON.stringify({ payload, answers })),
      ]);
      payload = payloadSchema.parse(result).payload;
    }
    const verdict = await this.verifier.invoke(payload, profileContext);
    const failure = admissionFailure(payload, verdict);
    if (!failure) return { status: "ready", payload, metadata: semanticMetadata(verdict) };

    const model = createStructuredModel("intentClarifier", recoverySchema, { name: "intent_recovery" });
    const result = await invokeWithAbortSignal(model, [
      new SystemMessage("Build one recovery form that helps the person concretize their signal. Return 2-6 fields. Each field needs a draft-specific label, a kind (single, multi, or text), and for single/multi 2-5 concrete options anchored to the draft. Text fields need a placeholder. Never re-ask what the draft or answers already settle. Options must be matchable and specific. Do not expose scores, classifications, JSON, or internal vocabulary."),
      new HumanMessage(JSON.stringify({
        payload,
        answers,
        feedback: failure.message,
        category: failure.category,
        classification: verdict.classification,
        clarity: verdict.felicity_scores.clarity,
        entropy: verdict.semantic_entropy,
        referentialBreadth: verdict.referential_breadth,
        missingConstraints: verdict.missing_selectional_constraints,
      })),
    ]);
    return {
      status: "needs_revision",
      payload,
      feedback: failure.message,
      recovery: parseRecoveryFields(recoverySchema.parse(result)),
    };
  }
}
