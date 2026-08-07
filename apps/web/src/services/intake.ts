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

/** One answered intake round, in order (round 1 first). */
export interface IntakeRound {
  prompt: string;
  answer: IntakeAnswerBody;
}

/** Follow-up batch plus the locked total interview length (round 1 included). */
export interface IntakeFollowUpResponse {
  questions: QuestionPayload[];
  total: number;
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

  /**
   * Next follow-up batch. `plannedTotal` echoes the locked total on
   * continuation calls; both answers and prompts travel with every call —
   * the server holds no funnel state.
   */
  question: (rounds: IntakeRound[], plannedTotal?: number) =>
    apiClient.post<IntakeFollowUpResponse>("/intents/intake/question", {
      rounds,
      ...(plannedTotal !== undefined ? { plannedTotal } : {}),
    }),

  /** Kick off speculative synthesis; returns immediately. */
  prepare: (input: { rounds: IntakeRound[] }) =>
    apiClient.post<{ runId: string }>("/intents/intake/prepare", input),

  /** Resolve the proposal once the user has chosen where to look. */
  proposal: (input: { runId: string; rounds: IntakeRound[]; networkId?: string; whereText?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/proposal", input)
      .catch(unwrapVerificationRejection),

  /**
   * Replace the visible draft from feedback.
   *
   * `networkId` travels with the revision because the replacement is a new
   * proposal row: `/intents/confirm` compares the posted network against the
   * stored one, so a revision that dropped it would 409 at confirm.
   */
  revise: (input: { runId: string; rounds: IntakeRound[]; feedback: string; networkId?: string }) =>
    apiClient.post<IntakeProposalResponse>("/intents/intake/revise", input)
      .catch(unwrapVerificationRejection),
};
