/**
 * Narrow question-policy port consumed by the Questions capability — IND-550.
 * Sources now route through the canonical negotiation module public surface.
 */
export {
  NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
  NEGOTIATION_QUESTION_GENERIC_NETWORK,
  NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY,
  isSafeNegotiationQuestionText,
} from "../negotiation/public/index.js";
export type { NegotiationConsultationReason } from "../negotiation/public/index.js";
