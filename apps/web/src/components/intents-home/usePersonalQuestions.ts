import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { useConversations } from "@/contexts/APIContext";
import { apiClient } from "@/lib/api";

import { withoutAnswered, type PersonalQuestion } from "./personal-questions";

const QUESTIONS_POLL_MS = 30_000;

// Answered in this tab but maybe still listed by the server until the next read.
// Shared by every page reading the questions, so an answer given on one (Home,
// an intent, the agent's chat) drops the card and the sidebar count everywhere at once.
let answeredIds: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const answeredSnapshot = () => answeredIds;

/** Mark questions answered (or, `false`, take that back after a failed send). */
export function markAnswered(questionIds: string[], answered = true) {
  const next = new Set(answeredIds);
  for (const id of questionIds) {
    if (answered) next.add(id);
    else next.delete(id);
  }
  answeredIds = next;
  for (const listener of listeners) listener();
}

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
  const answered = useSyncExternalStore(subscribe, answeredSnapshot);

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
    markAnswered([questionId]);
    try {
      await conversations.sendAnswers(intentId, [{ questionId, text }]);
    } catch (error) {
      markAnswered([questionId], false);
      throw error;
    }
  }, [conversations]);

  return { questions: withoutAnswered(cards, answered), all: cards, loaded, answer };
}
