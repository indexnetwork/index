import { useState, useId } from 'react';
import { QuestionCard } from '@/components/DecisionQuestions/QuestionCard';
import type { PendingQuestion } from '@/services/questions';
import type { Answer } from '@/components/DecisionQuestions/flatten';
import type { AnswerBody } from '@/services/questions';

/** Map (sourceType, mode) → human-readable group label. */
export function groupLabel(sourceType: string, mode: string): string {
  if (sourceType === 'opportunity' && mode === 'discovery') return 'About your opportunities';
  if (sourceType === 'opportunity' && mode === 'negotiation') return 'About a negotiation';
  if (sourceType === 'intent') return 'About your signal';
  if (sourceType === 'profile') return 'About you';
  return 'Questions';
}

/** Build a grouping key from detection fields. */
export function groupKey(q: PendingQuestion): string {
  return `${q.detection.sourceType}:${q.detection.mode}`;
}

interface QuestionGroupProps {
  label: string;
  questions: PendingQuestion[];
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
}

export function QuestionGroup({ label, questions, onAnswer, onDismiss }: QuestionGroupProps) {
  const baseId = useId();
  const [answers, setAnswers] = useState<Record<string, Answer | null>>({});
  const [submitting, setSubmitting] = useState<Record<string, boolean>>({});

  const handleSubmit = async (q: PendingQuestion) => {
    const answer = answers[q.id];
    if (!answer) return;

    const body: AnswerBody =
      answer.kind === 'other'
        ? { selectedOptions: [], freeText: answer.text }
        : { selectedOptions: answer.selectedLabels };

    setSubmitting((prev) => ({ ...prev, [q.id]: true }));
    try {
      await onAnswer(q.id, body);
    } finally {
      setSubmitting((prev) => ({ ...prev, [q.id]: false }));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
        {label}
      </h3>
      {questions.map((q) => {
        const answer = answers[q.id] ?? null;
        const isSubmitting = submitting[q.id] ?? false;
        const hasAnswer =
          answer?.kind === 'selection'
            ? answer.selectedLabels.length > 0
            : answer?.kind === 'other'
              ? answer.text.trim().length > 0
              : false;

        return (
          <div key={q.id} className="flex flex-col gap-1.5">
            <QuestionCard
              questionId={`${baseId}-${q.id}`}
              question={q.payload}
              answer={answer}
              disabled={isSubmitting}
              onAnswerChange={(next) =>
                setAnswers((prev) => ({ ...prev, [q.id]: next }))
              }
            />
            <div className="flex items-center justify-end gap-2 px-1">
              <button
                type="button"
                onClick={() => onDismiss(q.id)}
                disabled={isSubmitting}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                type="button"
                disabled={!hasAnswer || isSubmitting}
                onClick={() => handleSubmit(q)}
                className="bg-[#041729] text-white px-3 py-1 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
