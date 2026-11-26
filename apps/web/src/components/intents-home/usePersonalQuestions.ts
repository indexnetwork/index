import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useConversations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { apiClient } from "@/lib/api";

import { withoutAnswered, type PersonalQuestion } from "./personal-questions";

const QUESTIONS_POLL_MS = 30_000;

/**
 * One copy of the questions for the whole tab, shared by every page that shows
 * them (Home, an intent, the sidebar's count). Moving between pages keeps what
 * is already here and rereads quietly behind it, so nothing reloads in view.
 */
interface QuestionsState {
  /** Whose questions these are; another account signing in starts over. */
  owner: string | null;
  cards: PersonalQuestion[];
  loaded: boolean;
  /** Answered here but maybe still listed by the server until the next read. */
  answered: ReadonlySet<string>;
}

let state: QuestionsState = { owner: null, cards: [], loaded: false, answered: new Set() };
const listeners = new Set<() => void>();
const set = (next: Partial<QuestionsState>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

let readers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let lastRead = 0;
let viewer: string | null = null;
const load = () => {
  const owner = viewer;
  lastRead = Date.now();
  if (state.owner !== owner) set({ owner, cards: [], loaded: false, answered: new Set() });
  return apiClient.get<{ groups: PersonalQuestion[] }>("/personal-agent/questions")
    .then((res) => { if (viewer === owner) set({ cards: res.groups ?? [], loaded: true }); })
    // Keep whatever was shown; the next poll tries again.
    .catch(() => { if (viewer === owner && !state.loaded) set({ loaded: true }); });
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => state;
const NONE: PersonalQuestion[] = [];

/** Poll while any page shows the questions; a page arriving reads again only if the last read is old. */
function useQuestionsPoll(userId: string | null) {
  useEffect(() => {
    readers++;
    viewer = userId;
    if (state.owner !== userId || Date.now() - lastRead >= QUESTIONS_POLL_MS) void load();
    if (!timer) timer = setInterval(() => { void load(); }, QUESTIONS_POLL_MS);
    return () => {
      readers--;
      // Wait a beat: moving between pages lets one go just before the next takes over.
      setTimeout(() => {
        if (readers === 0 && timer) { clearInterval(timer); timer = null; }
      }, 0);
    };
  }, [userId]);
}

/** Mark questions answered (or, `false`, take that back after a failed send). */
export function markAnswered(questionIds: string[], answered = true) {
  const next = new Set(state.answered);
  for (const id of questionIds) {
    if (answered) next.add(id);
    else next.delete(id);
  }
  set({ answered: next });
}

/**
 * The questions your agent has on Home: one card per group of questions that
 * ask for the same thing, read in one call and re-read on a slow poll. An
 * answered card disappears at once, on every page; the server fans the answer
 * out to every question in its group.
 */
export function usePersonalQuestions() {
  const conversations = useConversations();
  const userId = useAuthContext().user?.id ?? null;
  const current = useSyncExternalStore(subscribe, snapshot);
  // Until the signed-in account's own read lands, show nothing rather than someone else's.
  const mine = current.owner === userId;
  const cards = mine ? current.cards : NONE;
  const loaded = mine && current.loaded;
  const answered = current.answered;
  useQuestionsPoll(userId);

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
