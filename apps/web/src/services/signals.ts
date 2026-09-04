/** Client for the two-call signal flow: clarify a payload, then create it. */
import { apiClient } from "@/lib/api";

/** One answer already given, paired with the question it answers. */
export interface ClarifyAnswer {
  prompt: string;
  answer: string;
}

/** One selectable choice on a clarifying question. */
export interface ClarifyQuestionOption {
  label: string;
  description: string;
}

/** One clarifying question, shaped for direct rendering. */
export interface ClarifyQuestion {
  prompt: string;
  options: ClarifyQuestionOption[];
  multiSelect: boolean;
}

/** The payload as it now reads, plus whatever is still worth asking. */
export interface ClarifyResult {
  payload: string;
  questions: ClarifyQuestion[];
}

export const signalService = {
  /**
   * Run one clarification round. Nothing is stored: every call carries the
   * whole payload and every answer given so far.
   */
  clarify: (payload: string, answers: ClarifyAnswer[] = []) =>
    apiClient.post<ClarifyResult>("/intents/clarify", { payload, answers }),

  /** Persist the signal. */
  create: (description: string) =>
    apiClient.post<{ intentId: string }>("/intents", { description }),
};
