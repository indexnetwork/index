import { EventEmitter } from 'events';

/**
 * In-memory wait bus for the orchestrator's blocking `ask_user_question` tool.
 *
 * A running chat turn (the tool handler, via the ChatQuestionsHost bridge)
 * awaits resolutions for the question ids it just persisted; the questions
 * REST endpoints resolve them through `QuestionEvents.onAnswered`/`onDismissed`
 * (wired in main.ts). When no waiter is listening (turn already ended, other
 * instance, or question answered later from the questions page), the emit is
 * a no-op and the answer simply stays on the question row.
 *
 * Multi-instance note: in-memory only — same single-instance semantics as
 * chat-interrupt.events.ts. A Redis pub/sub upgrade would swap this module
 * while preserving the emit/await API.
 */

/** Default wait budget when the caller does not supply one (4 minutes). */
const DEFAULT_WAIT_TIMEOUT_MS = 4 * 60 * 1000;

export interface ChatQuestionResolution {
  questionId: string;
  status: 'answered' | 'dismissed';
  answer?: {
    selectedOptions: string[];
    freeText?: string;
    answeredBy: string;
    answeredAt: string;
  };
}

/** Outcome returned per awaited question (mirrors protocol ChatQuestionAnswerOutcome). */
export interface ChatQuestionAwaitOutcome {
  questionId: string;
  status: 'answered' | 'dismissed' | 'timeout';
  answer?: ChatQuestionResolution['answer'];
}

const chatQuestionEmitter = new EventEmitter();
chatQuestionEmitter.setMaxListeners(500);

function channel(questionId: string): string {
  return `question:${questionId}`;
}

/**
 * Emit a resolution (answer or dismissal) for a chat-mode question.
 * No-op when no chat turn is currently awaiting this question.
 *
 * @param resolution - The question id, terminal status, and answer payload.
 */
export function emitChatQuestionResolution(resolution: ChatQuestionResolution): void {
  chatQuestionEmitter.emit(channel(resolution.questionId), resolution);
}

/**
 * True when a running chat turn is currently blocked on this question.
 * Used by the answer endpoint to report `resumed` back to the client.
 *
 * @param questionId - The question to check for an active waiter.
 */
export function hasChatQuestionWaiter(questionId: string): boolean {
  return chatQuestionEmitter.listenerCount(channel(questionId)) > 0;
}

/**
 * Block until every given question resolves (answered/dismissed), the wait
 * budget elapses, or the signal aborts. Unresolved questions are reported
 * with status `timeout` — they remain `pending` in the database.
 *
 * @param questionIds - Question ids persisted by the ask_user_question tool.
 * @param opts        - Optional timeout override and abort signal.
 * @returns One outcome per question id, in input order.
 */
export function awaitChatQuestionAnswers(
  questionIds: string[],
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<ChatQuestionAwaitOutcome[]> {
  const timeoutMs = opts?.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_WAIT_TIMEOUT_MS;
  const signal = opts?.signal;

  return new Promise((resolve) => {
    const outcomes = new Map<string, ChatQuestionAwaitOutcome>();
    const cleanups: Array<() => void> = [];
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      for (const cleanup of cleanups) cleanup();
      resolve(
        questionIds.map(
          (id) => outcomes.get(id) ?? { questionId: id, status: 'timeout' as const },
        ),
      );
    };

    if (questionIds.length === 0 || signal?.aborted) {
      settle();
      return;
    }

    const timer = setTimeout(settle, timeoutMs);
    cleanups.push(() => clearTimeout(timer));

    if (signal) {
      const onAbort = () => settle();
      signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }

    for (const questionId of questionIds) {
      const handler = (resolution: ChatQuestionResolution) => {
        outcomes.set(questionId, {
          questionId,
          status: resolution.status,
          ...(resolution.answer ? { answer: resolution.answer } : {}),
        });
        if (outcomes.size === questionIds.length) settle();
      };
      chatQuestionEmitter.on(channel(questionId), handler);
      cleanups.push(() => chatQuestionEmitter.off(channel(questionId), handler));
    }
  });
}
