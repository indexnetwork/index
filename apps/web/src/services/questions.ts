/**
 * Types and service for pending questions (GET /questions, POST /questions/:id/answer|dismiss).
 */

export interface QuestionOption {
  label: string;
  description: string;
}

export interface QuestionPayload {
  title: string;
  prompt: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

export interface QuestionDetection {
  mode: 'discovery' | 'intent' | 'enrichment' | 'negotiation' | 'chat';
  sourceType: string;
  sourceId: string;
  triggeredBy?: string;
  timestamp: string;
  /** ID of the assistant message that triggered this question. */
  messageId?: string;
}

export interface QuestionActor {
  userId: string;
  networkId?: string;
  role: 'subject';
}

export interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

export interface PendingQuestion {
  id: string;
  detection: QuestionDetection;
  actors: QuestionActor[];
  payload: QuestionPayload;
  status: 'pending' | 'answered' | 'dismissed';
  answer: QuestionAnswer | null;
  expiresAt: string | null;
  createdAt: string;
  conversationId: string | null;
}

export interface QuestionsListResponse {
  questions: PendingQuestion[];
}

export interface AnswerBody {
  selectedOptions: string[];
  freeText?: string;
}

export interface AnswerResponse {
  success: boolean;
  /**
   * True when a live chat turn was blocked on this question
   * (ask_user_question) and resumes streaming with the answer.
   */
  resumed?: boolean;
}

export const createQuestionsService = (
  api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>
) => ({
  /**
   * Fetch pending questions for the authenticated user.
   * Optionally filter by mode, sourceType, sourceId, selected intent scope, or noConversation.
   */
  getPending: async (filters?: {
    mode?: QuestionDetection['mode'];
    sourceType?: string;
    sourceId?: string;
    scopeType?: 'intent';
    scopeId?: string;
    noConversation?: boolean;
  }): Promise<PendingQuestion[]> => {
    const params = new URLSearchParams({ status: 'pending' });
    if (filters?.mode) params.set('mode', filters.mode);
    if (filters?.sourceType) params.set('sourceType', filters.sourceType);
    if (filters?.sourceId) params.set('sourceId', filters.sourceId);
    if (filters?.scopeType) params.set('scopeType', filters.scopeType);
    if (filters?.scopeId) params.set('scopeId', filters.scopeId);
    if (filters?.noConversation) params.set('noConversation', 'true');
    const res = await api.get<QuestionsListResponse>(`/questions?${params}`);
    return res.questions ?? [];
  },

  /** Fetch pending questions linked to a specific conversation. */
  getByConversation: async (conversationId: string): Promise<PendingQuestion[]> => {
    const params = new URLSearchParams({ status: 'pending', conversationId });
    const res = await api.get<QuestionsListResponse>(`/questions?${params}`);
    return res.questions ?? [];
  },

  /** Submit an answer for a question. Returns whether a live chat turn resumed. */
  answer: async (questionId: string, body: AnswerBody): Promise<AnswerResponse> => {
    const res = await api.post<AnswerResponse>(`/questions/${questionId}/answer`, body);
    return res ?? { success: true };
  },

  /** Dismiss a question. */
  dismiss: async (questionId: string): Promise<void> => {
    await api.post(`/questions/${questionId}/dismiss`, {});
  },
});
