import { useCallback, useState } from 'react';
import type { PendingQuestion, AnswerBody } from '@/services/questions';
import { useTickingNow } from '@/components/negotiations/use-ticking-now';

/**
 * Server-side ask_user answer window — mirrors DEFAULT_ASK_USER_WINDOW_MS in
 * packages/protocol/src/negotiation/negotiation.protocol.ts (24h). The window
 * starts when the consultation question is created.
 */
const ASK_USER_WINDOW_MS = 24 * 60 * 60 * 1000;

/** "23h left" / "45m left" countdown label for the consultation window. */
export function formatConsultationTimeLeft(createdAt: string, now: number): string {
  const startedAt = new Date(createdAt).getTime();
  if (!Number.isFinite(startedAt)) return '';
  const remainingMinutes = Math.max(1, Math.ceil((startedAt + ASK_USER_WINDOW_MS - now) / 60_000));
  if (remainingMinutes >= 60) return `${Math.floor(remainingMinutes / 60)}h left`;
  return `${remainingMinutes}m left`;
}

interface ConsultationCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  /** Injectable clock for tests; defaults to a 30s ticking now. */
  now?: number;
}

/**
 * The ask_user consultation card (proposals §2.2): a negotiator paused
 * mid-negotiation to consult its own client — the strongest visual priority
 * in the system. Amber left border, navy "Your move" chip, 24h countdown,
 * inline answer field, and the privacy promise rendered as part of the card.
 */
export function ConsultationCard({ question, onAnswer, now: nowProp }: ConsultationCardProps) {
  const tickingNow = useTickingNow();
  const now = nowProp ?? tickingNow;
  const [answerText, setAnswerText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = answerText.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onAnswer(question.id, { selectedOptions: [], freeText: answerText.trim() });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, onAnswer, question.id, answerText]);

  const timeLeft = formatConsultationTimeLeft(question.createdAt, now);

  return (
    <div
      data-testid="consultation-card"
      className="rounded-lg border border-amber-200 border-l-[3px] border-l-amber-400 bg-[#fffdf7] p-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-[#041729] bg-[#041729] px-2.5 py-1 font-ibm-plex-mono text-[10px] font-semibold text-white">
          Your move
        </span>
        <span className="font-ibm-plex-mono text-[11px] text-gray-500">Your agent is asking</span>
        <span className="flex-1" />
        {timeLeft && (
          <span
            data-testid="consultation-countdown"
            className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-ibm-plex-mono text-[10px] font-semibold text-amber-700"
          >
            {timeLeft}
          </span>
        )}
      </div>

      <p className="mt-2 text-[15px] font-semibold leading-snug text-gray-900">
        {question.payload.prompt}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        Your agent paused the negotiation to check with you.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={answerText}
          disabled={submitting}
          placeholder="Type your answer…"
          aria-label="Answer your agent"
          onChange={(event) => setAnswerText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleSubmit();
            }
          }}
          className="flex-1 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#041729] focus:outline-none focus:ring-2 focus:ring-[#041729]/10"
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="rounded-sm bg-[#041729] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Sending…' : 'Send'}
        </button>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        <span aria-hidden="true" className="text-xs">🔒</span>
        <span className="font-ibm-plex-mono text-[10.5px] text-gray-400">
          Only your agent sees this — it decides what to disclose.
        </span>
      </div>
    </div>
  );
}
