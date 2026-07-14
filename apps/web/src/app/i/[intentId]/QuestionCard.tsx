import { useState, useCallback, KeyboardEvent } from "react";
import { ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";

import type { PendingQuestion, AnswerBody } from "@/services/questions";

/** A, B, C… letter for an option index. */
function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

interface QuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  /** Navigate between pending questions. Rendered inside the card when provided. */
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}

/**
 * Intent-page question card. Design inspired by the Claude Code question UI:
 * lettered A/B/C option rows and a bordered card, adapted to the light theme.
 * Behavior stays click-to-answer — picking an option answers immediately.
 */
export function QuestionCard({
  question,
  onAnswer,
  onDismiss,
  onPrev,
  onNext,
  canPrev,
  canNext,
}: QuestionCardProps) {
  const [otherText, setOtherText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { payload } = question;
  const questionId = question.id;

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
    if (e.key === "Enter" && !e.shiftKey) {
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
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] font-semibold leading-snug text-gray-900">
          {payload.prompt}
        </p>
        {(onPrev || onNext) && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Previous question"
              disabled={!canPrev}
              onClick={onPrev}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next question"
              disabled={!canNext}
              onClick={onNext}
              className="flex h-6 w-6 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-0.5">
        {payload.options.map((opt, i) => (
          <button
            key={opt.label}
            type="button"
            disabled={submitting}
            onClick={() => submitOption(opt.label)}
            className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-500 group-hover:bg-[#041729] group-hover:text-white transition-colors">
              {optionLetter(i)}
            </span>
            <span className="text-sm text-gray-900">{opt.label}</span>
          </button>
        ))}

        {/* Free-text row — write a custom answer to this question. */}
        <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-white pl-2.5 pr-2 py-1.5 focus-within:border-[#041729] transition-colors">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-semibold text-gray-400">
            {optionLetter(payload.options.length)}
          </span>
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
        Skip
      </button>
    </div>
  );
}
