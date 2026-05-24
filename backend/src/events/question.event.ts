interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

interface QuestionCreatedPayload {
  questionId: string;
  userId: string;
  mode: string;
  sourceType: string;
  sourceId: string;
}

interface QuestionAnsweredPayload {
  questionId: string;
  userId: string;
  mode: string;
  sourceType: string;
  sourceId: string;
  answer: QuestionAnswer;
}

/**
 * Hooks called on question lifecycle events.
 * Set by main.ts to trigger downstream processing via queues or services.
 */
export const QuestionEvents = {
  onCreated: (_payload: QuestionCreatedPayload): void => {},
  onAnswered: (_payload: QuestionAnsweredPayload): void => {},
};
