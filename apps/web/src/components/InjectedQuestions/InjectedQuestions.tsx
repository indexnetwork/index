import { useState, useCallback, KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import type { PendingQuestion, AnswerBody } from '@/services/questions';

interface InjectedQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
}

function InjectedQuestionCard({ question, onAnswer, onDismiss }: InjectedQuestionCardProps) {
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { payload } = question;
  const questionId = question.id;

  // Options are click-to-submit buttons — picking one answers the question
  // directly (no separate Submit step).
  const submitOption = useCallback(
    async (label: string) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        await onAnswer(questionId, { selectedOptions: [label] });
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, onAnswer, questionId],
  );

  const submitFreeText = useCallback(async () => {
    const text = otherText.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer(questionId, { selectedOptions: [], freeText: text });
    } finally {
      setSubmitting(false);
    }
  }, [otherText, submitting, onAnswer, questionId]);

  const handleFreeTextKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitFreeText();
    }
  };

  const handleDismiss = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onDismiss(questionId);
    } finally {
      setSubmitting(false);
    }
  }, [submitting, onDismiss, questionId]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-[15px] font-semibold leading-snug text-gray-900">
        {payload.prompt}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {payload.options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            disabled={submitting}
            onClick={() => submitOption(opt.label)}
            className="w-full text-left px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all disabled:opacity-50"
          >
            {opt.label}
            {opt.description && (
              <span className="mt-0.5 block text-xs text-gray-400">{opt.description}</span>
            )}
          </button>
        ))}

        {/* Last option is always a free-text input for a custom response */}
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white focus-within:border-[#041729] transition-colors">
          <input
            type="text"
            placeholder="write your own…"
            value={otherText}
            disabled={submitting}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={handleFreeTextKeyDown}
            className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={submitFreeText}
            disabled={!otherText.trim() || submitting}
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send answer"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        disabled={submitting}
        className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-60"
      >
        Dismiss
      </button>
    </div>
  );
}

interface InjectedQuestionsProps {
  questions: PendingQuestion[];
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
}

export function InjectedQuestions({ questions, onAnswer, onDismiss }: InjectedQuestionsProps) {
  if (questions.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {questions.map((q) => (
        <InjectedQuestionCard
          key={q.id}
          question={q}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
