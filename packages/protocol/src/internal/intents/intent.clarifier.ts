import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

import { admissionFailure, semanticMetadata, type IntentSemanticMetadata } from "./intent.admission.js";
import { SemanticVerifier } from "./intent.verifier.js";

/** One answer paired with the question it answers. */
export interface ClarifyAnswer { prompt: string; answer: string }
/** The current draft and answers not yet folded into it. */
export interface ClarifyInput { payload: string; answers?: ClarifyAnswer[] }
export interface ClarifyQuestionOption { label: string; description: string }
export interface ClarifyQuestion { prompt: string; options: ClarifyQuestionOption[]; multiSelect: boolean }

/** Host-authorized preparation. Null metadata authorizes revisions needing fresh measurements. Never accept this object from an untrusted client. */
export interface PreparedIntent { metadata: IntentSemanticMetadata | null }

/** Review is available only after admission of the complete clarified draft. */
export type ClarifyResult =
  | { status: "ready"; payload: string; metadata: IntentSemanticMetadata; questions: [] }
  | { status: "needs_clarification"; payload: string; feedback: string; questions: ClarifyQuestion[] };

const payloadSchema = z.object({ payload: z.string().trim().min(1).max(65_536) });
const questionsSchema = z.object({
  questions: z.array(z.object({
    prompt: z.string().trim().min(1).max(400),
    options: z.array(z.object({ label: z.string().trim().min(1).max(120), description: z.string().max(280) })).max(4),
    multiSelect: z.boolean(),
  })).min(1).max(3),
});

/** Folds answers into a draft, admits its final form, and asks about unmet requirements. Model failures propagate for retry. */
export class IntentClarifier {
  constructor(private readonly verifier: Pick<SemanticVerifier, "invoke"> = new SemanticVerifier()) {}

  /**
   * Prepare one draft using the creation admission policy.
   * @param input - Current payload and pending answers.
   * @param profileContext - The speaker's profile, if supplied by the host.
   * @returns An admitted draft or questions addressing the actual admission failure.
   * @throws When rewriting, verification, or question generation fails; callers must retain the input for retry.
   */
  public async invoke(input: ClarifyInput, profileContext = ""): Promise<ClarifyResult> {
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
    if (!failure) return { status: "ready", payload, metadata: semanticMetadata(verdict), questions: [] };

    const model = createStructuredModel("intentClarifier", questionsSchema, { name: "intent_questions" });
    const result = await invokeWithAbortSignal(model, [
      new SystemMessage("Ask 1-3 concise questions that repair the supplied admission failure and missing constraints. Ask only about details that change who can match or clarify the goal. Never re-ask what the draft or answers already settle. Offer up to 4 concrete choices anchored to the draft, or no choices for a free-text question. Set multiSelect only when choices can hold together. Do not expose scores, classifications, JSON, or internal vocabulary."),
      new HumanMessage(JSON.stringify({ payload, answers, feedback: failure.message, classification: verdict.classification, clarity: verdict.felicity_scores.clarity, entropy: verdict.semantic_entropy, missingConstraints: verdict.missing_selectional_constraints })),
    ]);
    return { status: "needs_clarification", payload, feedback: failure.message, questions: questionsSchema.parse(result).questions };
  }
}
