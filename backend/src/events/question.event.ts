interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

type QuestionMode = 'discovery' | 'intent' | 'profile' | 'negotiation';

interface QuestionCreatedPayload {
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
  sourceType: string;
  sourceId: string;
  answer: QuestionAnswer;
}

/**
 * Hooks called on question lifecycle events.
 * No-ops by default — assign handlers in main.ts when downstream processing
 * is needed (e.g. feeding answered questions back into intent refinement).
 */
export const QuestionEvents = {
  onCreated: (_payload: QuestionCreatedPayload): void => {},
  onAnswered: (_payload: QuestionAnsweredPayload): void => {},
};
