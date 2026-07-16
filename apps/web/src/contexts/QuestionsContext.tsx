import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuestionsService } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import type { PendingQuestion, AnswerBody } from '@/services/questions';
import { log } from '@/lib/logger';

const logger = log.context.from('QuestionsContext');

interface QuestionsContextType {
  /** All pending questions for the current user. */
  questions: PendingQuestion[];
  /** Legacy/global inbox count (pool pushes excluded). */
  count: number;
  /** Pending rows shown on the global Questions page. */
  globalPending: number;
  /** Delivered pool rows shown only through the Personal Agent surfaces. */
  pushedPoolPending: number;
  /** Sum used by the Personal Agent sidebar badge. */
  personalAgentPending: number;
  /** Whether the initial fetch is in progress. */
  loading: boolean;
  /** Submit an answer for a question and remove it from the list. */
  answer: (questionId: string, body: AnswerBody) => Promise<void>;
  /** Dismiss a question and remove it from the list. */
  dismiss: (questionId: string) => Promise<void>;
  /** Force an immediate refresh. */
  refresh: () => Promise<void>;
}

const QuestionsContext = createContext<QuestionsContextType | undefined>(undefined);

const POLL_INTERVAL_MS = 30_000;

export function QuestionsProvider({ children }: { children: ReactNode }) {
  const questionsService = useQuestionsService();
  const { user } = useAuthContext();
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [counts, setCounts] = useState({
    globalPending: 0,
    pushedPoolPending: 0,
    personalAgentPending: 0,
  });
  const [loading, setLoading] = useState(false);

  const fetchQuestions = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [pending, pendingCounts] = await Promise.all([
        questionsService.getPending({ noConversation: true, excludeModes: ['pool_discovery'] }),
        questionsService.getPendingCounts(),
      ]);
      setQuestions(pending);
      setCounts(pendingCounts);
    } catch (err) {
      logger.error('Failed to fetch pending questions', { error: err });
    }
  }, [questionsService, user?.id]);

  // Initial fetch + polling
  useEffect(() => {
    if (!user?.id) {
      setQuestions([]);
      setCounts({ globalPending: 0, pushedPoolPending: 0, personalAgentPending: 0 });
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      await fetchQuestions();
      if (!cancelled) setLoading(false);
    };

    load();

    const interval = setInterval(() => {
      if (!cancelled) fetchQuestions();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchQuestions, user?.id]);

  const answer = useCallback(async (questionId: string, body: AnswerBody) => {
    await questionsService.answer(questionId, body);
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    await fetchQuestions();
  }, [fetchQuestions, questionsService]);

  const dismiss = useCallback(async (questionId: string) => {
    await questionsService.dismiss(questionId);
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    await fetchQuestions();
  }, [fetchQuestions, questionsService]);

  return (
    <QuestionsContext.Provider
      value={{
        questions,
        count: counts.globalPending,
        globalPending: counts.globalPending,
        pushedPoolPending: counts.pushedPoolPending,
        personalAgentPending: counts.personalAgentPending,
        loading,
        answer,
        dismiss,
        refresh: fetchQuestions,
      }}
    >
      {children}
    </QuestionsContext.Provider>
  );
}

export function useQuestions() {
  const context = useContext(QuestionsContext);
  if (context === undefined) {
    throw new Error('useQuestions must be used within a QuestionsProvider');
  }
  return context;
}
