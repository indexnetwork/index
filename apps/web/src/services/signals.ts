/** Client for preparing a signal and saving its final revision. */
import type { PrepareAnswer, PrepareResult as ProtocolPrepareResult, RecoveryField } from "@indexnetwork/protocol";

import { apiClient } from "@/lib/api";

export type { PrepareAnswer, RecoveryField };

/** The API host replaces admitted metadata with authenticated preparation. */
export type PrepareResult =
  | (Extract<ProtocolPrepareResult, { status: "ready" }> & { preparationReceipt: string })
  | Extract<ProtocolPrepareResult, { status: "needs_revision" }>;

export const signalService = {
  /** Prepare a draft; fold recovery answers and run admission. */
  prepare: (payload: string, answers: PrepareAnswer[] = []) =>
    apiClient.post<PrepareResult>("/intents/prepare", { payload, answers }),

  /** Save the final text using server-authorized preparation. */
  create: (description: string, preparationReceipt: string) =>
    apiClient.post<{ intentId: string }>("/intents", { description, preparationReceipt }),
};
