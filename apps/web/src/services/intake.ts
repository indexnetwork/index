/** Client for the deterministic /intents/intake funnel. */

import { APIError, apiClient } from "@/lib/api";
import type { QuestionPayload } from "@/services/questions";

/** One answered intake round. */
export interface IntakeAnswerBody {
  selectedOptions: string[];
  freeText?: string;
}

export interface IntakeQuestionResponse { question: QuestionPayload }

export interface IntakeProposalResponse {
  proposalId: string;
  description: string;
  lookingFor: string;
  youBring: string;
}

/** Recoverable 422: the server wants a clarifying answer before it will retry. */
export interface IntakeVerificationRejection {
  code: "verification_rejected";
  clarification: QuestionPayload;
}

/** Both answers travel with every call: the server holds no funnel state. */
interface IntakeAnswers {
  whoAnswer: IntakeAnswerBody;
  bringAnswer: IntakeAnswerBody;
}

/**
 * `/proposal` and `/revise` reject with a 422 whose JSON body carries
 * `code`/`clarification` (see IntentIntakeController#fail). apiClient wraps
 * that body under `APIError.response`; unwrap it here so callers can match
 * on `error.code` directly instead of reaching into the transport error.
 */
function unwrapVerificationRejection(error: unknown): never {
  if (error instanceof APIError && error.status === 422) {
    const body = error.response as Partial<IntakeVerificationRejection> | undefined;
    if (body?.code === "verification_rejected" && body.clarification) {
      throw { code: body.code, clarification: body.clarification } satisfies IntakeVerificationRejection;
    }
  }
  throw error;
}

export const intakeService = {
  /** Round 1 from the precomputed pack. */
  start: () => apiClient.post<IntakeQuestionResponse>("/intents/intake/start", {}),

  /** Round 2, grounded by the round-1 answer. */
  question: (whoAnswer: IntakeAnswerBody) =>
    apiClient.post<IntakeQuestionResponse>("/intents/intake/question", { whoAnswer }),

  /** Kick off speculative synthesis; returns immediately. */
  prepare: (input: IntakeAnswers & { round2Prompt?: string }) =>
    apiClient.post<{ runId: string }>("/intents/intake/prepare", input),

  /** Resolve the proposal once the user has chosen where to look. */
  proposal: (input: IntakeAnswers & { runId: string; networkId?: string; whereText?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/proposal", input)
      .catch(unwrapVerificationRejection),

  /** Replace the visible draft from feedback. */
  revise: (input: IntakeAnswers & { runId: string; feedback: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/revise", input)
      .catch(unwrapVerificationRejection),
};
