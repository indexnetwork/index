import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
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
  /** Stable authoritative pending-set signature used only for invalidation. */
  pendingRevision: string;
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
const EMPTY_COUNTS = {
  globalPending: 0,
  pushedPoolPending: 0,
  personalAgentPending: 0,
};

export function QuestionsProvider({ children }: { children: ReactNode }) {
  const questionsService = useQuestionsService();
  const { user } = useAuthContext();
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [loading, setLoading] = useState(false);
  const userId = user?.id;
  const activeUserIdRef = useRef<string | undefined>(userId);
  const requestGenerationRef = useRef(0);
  useLayoutEffect(() => {
    if (activeUserIdRef.current !== userId) {
      activeUserIdRef.current = userId;
      requestGenerationRef.current += 1;
    }
  }, [userId]);

  const fetchQuestions = useCallback(async () => {
    if (!userId) return;
    const requestUserId = userId;
    const requestGeneration = ++requestGenerationRef.current;
    try {
      const [pending, pendingCounts] = await Promise.all([
        questionsService.getPending({ noConversation: true, excludeModes: ['pool_discovery'] }),
        questionsService.getPendingCounts(),
      ]);
      if (
        activeUserIdRef.current !== requestUserId
        || requestGenerationRef.current !== requestGeneration
      ) return;
      setQuestions(pending);
      setCounts(pendingCounts);
    } catch (err) {
      logger.error('Failed to fetch pending questions', { error: err });
    }
  }, [questionsService, userId]);

  // Initial fetch + polling
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setQuestions([]);
      setCounts(EMPTY_COUNTS);
      if (!userId) setLoading(false);
    });
    if (!userId) {
      return () => {
        cancelled = true;
      };
    }

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
  }, [fetchQuestions, userId]);

  const pendingRevision = useMemo(
    () => `${userId ?? 'anonymous'}:${questions.map((question) => question.id).sort().join(',')}`,
    [questions, userId],
  );

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
        pendingRevision,
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
