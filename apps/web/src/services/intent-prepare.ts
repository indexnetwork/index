/** Client for preparing an intent and saving its final revision. */
import type { PrepareAnswer, PrepareResult as ProtocolPrepareResult, RecoveryField } from "@indexnetwork/protocol";

import { apiClient } from "@/lib/api";

export type { PrepareAnswer, RecoveryField };

/** A first intent the agent drafted from the profile. */
export interface IntentSuggestion {
  kind: "looking_for" | "offering";
  text: string;
}

/** The API host replaces admitted metadata with authenticated preparation. */
export type PrepareResult =
  | (Extract<ProtocolPrepareResult, { status: "ready" }> & { preparationReceipt: string })
  | Extract<ProtocolPrepareResult, { status: "needs_revision" }>;

export const intentService = {
  /** Prepare a draft; fold recovery answers and run admission. */
  prepare: (payload: string, answers: PrepareAnswer[] = []) =>
    apiClient.post<PrepareResult>("/intents/prepare", { payload, answers }),

  /** Two things to look for and one to offer, drafted from the profile, plus the example starters rewritten for them; empty when there are none. */
  suggestions: () =>
    apiClient.post<{ suggestions: IntentSuggestion[]; examples?: string[] }>("/intents/suggestions", {}),

  /** Save the final text using server-authorized preparation; without a receipt the server prepares it and refuses a draft that isn't ready. */
  create: (description: string, preparationReceipt?: string) =>
    apiClient.post<{ intentId: string }>("/intents", preparationReceipt ? { description, preparationReceipt } : { description }),
};
