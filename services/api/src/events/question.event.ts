interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

type QuestionMode = 'discovery' | 'intent' | 'enrichment' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery';

export type NegotiationSettlement = {
  authoritative: true;
  purpose: 'uptake' | 'stalled_followup' | 'inflight_consultation';
  taskId?: string;
  settlementId?: string;
  recipientIntentId: string;
  opportunityId: string;
  networkId: string;
  continuationStatus?: 'requested' | 'completed';
  resumeClaimed: boolean;
};

export interface QuestionCreatedPayload {
  questionId: string;
  userId: string;
  mode: QuestionMode;
  sourceType: string;
  sourceId: string;
}

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: QuestionMode;
  /** Internal generation purpose; never serialized to clients. */
  purpose?: 'uptake' | 'recovery' | 'stalled_followup' | 'inflight_consultation';
  /** Recovery snapshot fingerprint rechecked before canonical intent mutation. */
  recoveryIntentFingerprint?: string;
  sourceType: string;
  sourceId: string;
  answer: QuestionAnswer;
  settlement?: NegotiationSettlement;
}

interface QuestionDismissedPayload {
  questionId: string;
  userId: string;
  mode: QuestionMode;
  sourceType: string;
  sourceId: string;
  settlement?: NegotiationSettlement;
}

/**
 * Hooks called on question lifecycle events.
 * No-ops by default — assign handlers in main.ts when downstream processing
 * is needed (e.g. feeding answered questions back into intent refinement).
 */
export const QuestionEvents = {
  onCreated: (_payload: QuestionCreatedPayload): void => {},
  onAnswered: (_payload: QuestionAnsweredPayload): void | Promise<void> => {},
  /** Fired on dismissal — used to unblock chat turns waiting on ask_user_question. */
  onDismissed: (_payload: QuestionDismissedPayload): void | Promise<void> => {},
};
