import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { DecisionClient, type DecisionAnswer, type DecisionQuestion } from "../shared/agent/decision.client.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

import { ADMISSION_CONSTRAINTS, admissionFailure, admissionFromDecision, semanticMetadata, type AdmissionConstraint, type AdmissionDecision, type IntentSemanticMetadata } from "./intent.admission.js";
import { SemanticVerifier, type MissingSelectionalConstraint, type SemanticVerifierOutput } from "./intent.verifier.js";
import type { IntentValidationFailure } from "./graph/intent.graph.state.js";

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

/** Jev's read of the current rows. `passed` is the only state that may mint a receipt. */
export interface AdmissionCheck {
  passed: boolean;
  missing: AdmissionConstraint[];
  message: string;
}

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
  recovery: z.array(recoveryFieldSchema).min(1).max(6),
});
const legacyRecoverySchema = z.object({
  recovery: z.array(recoveryFieldSchema).min(2).max(6),
});

const noul = (instructions: string, yes: string, no: string): DecisionQuestion => ({
  type: "noul",
  instructions: `Read \`draft\` and \`answers\` together. ${instructions}`,
  criteria: { true: yes, false: no },
});

/** The admission process: the same questions judge the opening draft and a draft after answers. */
const ADMISSION_QUESTIONS: Record<string, DecisionQuestion> = {
  speech_act: {
    type: "choice",
    instructions: "Read `draft` and `answers` together. What speech act is `draft`?",
    criteria: {
      commissive: "The speaker commits to a future action.",
      directive: "The speaker is looking for someone, or asking for something to happen with another person.",
      declaration: "The speaker cancels, closes, or declares a state change.",
      other: "A fact, opinion, feeling, or anything that is not a search, a commitment, or a declaration.",
    },
  },
  too_vague: noul(
    "Is `draft` still too unconstrained to match someone on? A bare request, such as wanting a job with no role or outcome, is too vague.",
    "The goal is too unconstrained to match on.",
    "The goal names a concrete role, outcome, or particular help.",
  ),
  too_broad: noul(
    "Could many people still satisfy `draft`, even if it names a topic?",
    "Many people could plausibly match.",
    "A concrete role, outcome, location, timeframe, or specific need narrows who fits.",
  ),
  role: noul("Is a specific role still missing from `draft`?", "No specific role is stated.", "A specific role is stated."),
  outcome: noul("Is a concrete outcome still missing from `draft`?", "No concrete outcome is stated.", "A concrete outcome is stated."),
  location: noul("Is a location still missing from `draft` where one would change who fits?", "No location is stated and one would change who fits.", "A location is stated, or none is needed."),
  timeframe: noul("Is a timeframe still missing from `draft` where one would change who fits?", "No timeframe is stated and one would change who fits.", "A timeframe is stated, or none is needed."),
  domain: noul("Is a domain still missing from `draft`?", "No domain is stated.", "A domain is stated."),
  concrete_need: noul("Is the particular help still missing from `draft`?", "The particular help is not stated.", "The particular help is stated."),
};

function parseRecoveryFields(fields: z.infer<typeof recoveryFieldSchema>[]): RecoveryField[] {
  return fields.map((field) => {
    const placeholder = field.placeholder?.trim() || undefined;
    const options = field.options?.length ? field.options : undefined;
    if (field.kind === "text") {
      if (!placeholder) throw new Error("Text recovery fields require a placeholder.");
      return { id: field.id, label: field.label, kind: field.kind, placeholder };
    }
    if (!options?.length) throw new Error("Single and multi recovery fields require options.");
    return { id: field.id, label: field.label, kind: field.kind, options };
  });
}

function readDecision(answers: Record<string, DecisionAnswer>): AdmissionDecision {
  const speech = answers.speech_act;
  const speechAct = speech?.type === "choice" ? speech.choice : "";
  if (speechAct !== "commissive" && speechAct !== "directive" && speechAct !== "declaration" && speechAct !== "other") {
    throw new Error("Jev speech_act answer was unusable");
  }
  const probability = (key: string): number => {
    const answer = answers[key];
    if (!answer || answer.type !== "noul") throw new Error(`Jev ${key} answer was unusable`);
    return answer.noul;
  };
  const constraints = Object.fromEntries(ADMISSION_CONSTRAINTS.map((name) => [name, probability(name)])) as Record<AdmissionConstraint, number>;
  return { speechAct, tooVague: probability("too_vague"), tooBroad: probability("too_broad"), constraints };
}

function textField(message: string): RecoveryField {
  return { id: "detail", label: message, kind: "text", placeholder: "Add the missing detail" };
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** Folds recovery answers into a draft, admits its final form, and returns a dynamic recovery form on failure. Model failures propagate for retry. */
export class IntentPreparer {
  constructor(
    private readonly verifier: Pick<SemanticVerifier, "invoke"> = new SemanticVerifier(),
    private readonly decider: Pick<DecisionClient, "decide"> = new DecisionClient(),
  ) {}

  /**
   * Ask Jev whether the current rows would pass. Does not fold text or write questions.
   * @param input - Opening draft and the answers already on the page.
   * @param profileContext - The speaker's profile, if supplied by the host.
   * @throws When Jev fails; the caller keeps the rows and retries.
   */
  public async check(input: PrepareInput, profileContext = ""): Promise<AdmissionCheck> {
    const answers = (input.answers ?? []).filter((answer) => answer.answer.trim());
    const judged = admissionFromDecision(readDecision(await this.decider.decide(
      { draft: input.payload, answers, profile: profileContext },
      ADMISSION_QUESTIONS,
    )));
    if (!judged.failure) return { passed: true, missing: [], message: "" };
    return { passed: false, missing: judged.missing, message: judged.failure.message };
  }

  /**
   * Write one recovery field per constraint id. Does not run Jev.
   * @param input - Opening draft and the answers already on the page.
   * @param missing - Constraint ids that still need a row.
   */
  public async questions(input: PrepareInput, missing: readonly string[]): Promise<RecoveryField[]> {
    const answers = (input.answers ?? []).filter((answer) => answer.answer.trim());
    const constraints = [...new Set(missing)].filter((id): id is AdmissionConstraint =>
      (ADMISSION_CONSTRAINTS as readonly string[]).includes(id));
    if (!constraints.length) return [];
    return this.fieldsFor(input.payload, answers, "", constraints);
  }

  /**
   * Fold answers, admit the draft, and return a recovery form when it still fails.
   * @param input - Current payload and pending recovery answers.
   * @param profileContext - The speaker's profile, if supplied by the host.
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

    let jevFailed = false;
    try {
      const judged = admissionFromDecision(readDecision(await this.decider.decide({ draft: payload, profile: profileContext }, ADMISSION_QUESTIONS)));
      if (judged.failure) return this.revise(payload, answers, judged.failure.message, judged.missing);
    } catch (error) {
      if (isAbort(error)) throw error;
      jevFailed = true;
    }

    const verdict = await this.verifier.invoke(payload, profileContext);
    const failure = admissionFailure(verdict);
    if (!failure) return { status: "ready", payload, metadata: semanticMetadata(verdict) };
    if (jevFailed) return this.legacy(payload, answers, failure, verdict);
    return this.revise(payload, answers, failure.message, verdict.missing_selectional_constraints);
  }

  /** Today's recovery form, used only when the Jev call itself fails. */
  private async legacy(payload: string, answers: PrepareAnswer[], failure: IntentValidationFailure, verdict: SemanticVerifierOutput): Promise<PrepareResult> {
    const model = createStructuredModel("intentClarifier", legacyRecoverySchema, { name: "intent_recovery" });
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
    return { status: "needs_revision", payload, feedback: failure.message, recovery: parseRecoveryFields(legacyRecoverySchema.parse(result).recovery) };
  }

  /** One field per constraint still missing. None named means one text field from the admission message. */
  private async revise(payload: string, answers: PrepareAnswer[], feedback: string, missing: readonly (AdmissionConstraint | MissingSelectionalConstraint)[]): Promise<PrepareResult> {
    const constraints = [...new Set(missing)];
    const recovery = constraints.length === 0
      ? [textField(feedback)]
      : await this.fieldsFor(payload, answers, feedback, constraints);
    return { status: "needs_revision", payload, feedback, recovery };
  }

  private async fieldsFor(payload: string, answers: PrepareAnswer[], feedback: string, constraints: string[]): Promise<RecoveryField[]> {
    const model = createStructuredModel("intentClarifier", recoverySchema, { name: "intent_recovery" });
    const result = await invokeWithAbortSignal(model, [
      new SystemMessage(`Write one recovery field for each missing constraint, in this order: ${constraints.join(", ")}. Set each field's id to that constraint name. Each field needs a draft-specific label, a kind (single, multi, or text), and for single/multi 2-5 concrete options anchored to the draft. Text fields need a placeholder. Do not add any other field. Never re-ask what the draft or answers already settle. Do not expose scores, classifications, JSON, or internal vocabulary.`),
      new HumanMessage(JSON.stringify({ payload, answers, feedback, missingConstraints: constraints })),
    ]);
    const fields = parseRecoveryFields(recoverySchema.parse(result).recovery);
    const byId = new Map(fields.map((field) => [field.id, field]));
    const matched = constraints.map((id) => byId.get(id));
    if (matched.some((field) => !field)) throw new Error("Recovery fields did not cover the missing constraints.");
    return matched as RecoveryField[];
  }
}
