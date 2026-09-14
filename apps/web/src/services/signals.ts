/** Client for preparing a signal and saving its final revision. */
import type { ClarifyAnswer, ClarifyQuestion, ClarifyResult as ProtocolClarifyResult } from "@indexnetwork/protocol";

import { apiClient } from "@/lib/api";

export type { ClarifyAnswer, ClarifyQuestion };

/** The API host replaces admitted metadata with authenticated preparation. */
export type ClarifyResult =
  | (Omit<Extract<ProtocolClarifyResult, { status: "ready" }>, "metadata"> & { preparationReceipt: string })
  | Extract<ProtocolClarifyResult, { status: "needs_clarification" }>;

export const signalService = {
  /** Prepare a draft; keep pending answers until this round succeeds. */
  clarify: (payload: string, answers: ClarifyAnswer[] = []) =>
    apiClient.post<ClarifyResult>("/intents/clarify", { payload, answers }),

  /** Save the final text using server-authorized preparation. */
  create: (description: string, preparationReceipt: string) =>
    apiClient.post<{ intentId: string }>("/intents", { description, preparationReceipt }),
};
