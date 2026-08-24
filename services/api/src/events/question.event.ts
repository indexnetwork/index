interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

type QuestionMode = 'discovery' | 'intent' | 'enrichment' | 'chat' | 'pool_discovery';

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
  purpose?: 'recovery';
  /** Recovery snapshot fingerprint rechecked before canonical intent mutation. */
  recoveryIntentFingerprint?: string;
  sourceType: string;
  sourceId: string;
  answer: QuestionAnswer;
}

interface QuestionDismissedPayload {
  questionId: string;
  userId: string;
  mode: QuestionMode;
  sourceType: string;
  sourceId: string;
}

/**
 * Hooks called on question lifecycle events.
 * No-ops by default — assign handlers in main.ts when downstream processing
 * is needed (e.g. feeding answered questions back into intent refinement).
 */
export const QuestionEvents = {
  onCreated: (_payload: QuestionCreatedPayload): void => {},
  onAnswered: (_payload: QuestionAnsweredPayload): void | Promise<void> => {},
  /** Fired on dismissal for generic chat-question consumers. */
  onDismissed: (_payload: QuestionDismissedPayload): void | Promise<void> => {},
};
