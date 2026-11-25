import { useCallback, useEffect, useState } from "react";

import { useConversations } from "@/contexts/APIContext";
import { apiClient } from "@/lib/api";

import { withoutAnswered, type PersonalQuestion } from "./personal-questions";

const QUESTIONS_POLL_MS = 30_000;

/**
 * The questions your agent has on Home: one card per group of questions that
 * ask for the same thing, read in one call and re-read on a slow poll. An
 * answered card disappears at once; the server fans the answer out to every
 * question in its group.
 */
export function usePersonalQuestions() {
  const conversations = useConversations();
  const [cards, setCards] = useState<PersonalQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Answered here but maybe still listed by the server until the next read.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    const load = () => apiClient.get<{ groups: PersonalQuestion[] }>("/personal-agent/questions")
      .then((res) => { if (active) setCards(res.groups ?? []); })
      // Keep whatever was shown; the next poll tries again.
      .catch(() => undefined)
      .finally(() => { if (active) setLoaded(true); });
    void load();
    const timer = setInterval(() => { void load(); }, QUESTIONS_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, []);

  const answer = useCallback(async (intentId: string, questionId: string, text: string) => {
    setAnswered((prev) => new Set(prev).add(questionId));
    try {
      await conversations.sendAnswers(intentId, [{ questionId, text }]);
    } catch (error) {
      setAnswered((prev) => {
        const next = new Set(prev);
        next.delete(questionId);
        return next;
      });
      throw error;
    }
  }, [conversations]);

  return { questions: withoutAnswered(cards, answered), all: cards, loaded, answer };
}
