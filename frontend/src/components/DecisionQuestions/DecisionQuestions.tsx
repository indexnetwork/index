import { useId, useState } from 'react';
import { QuestionCard } from './QuestionCard';
import { flattenAnswers, type Answer } from './flatten';
import type { Question } from './types';

interface DecisionQuestionsProps {
  questions: Question[];
  submitted: boolean;
  onSubmit: (flattened: string) => void;
}

function isAnswered(a: Answer | null | undefined): boolean {
  if (!a) return false;
  if (a.kind === 'selection') return a.selectedLabels.length > 0;
  return a.text.trim().length > 0;
}

export function DecisionQuestions({
  questions,
  submitted,
  onSubmit,
}: DecisionQuestionsProps) {
  // Per-instance prefix prevents radio-group `name` collisions when multiple
  // DecisionQuestions render in the transcript at once.
  const baseId = useId();

  const [answers, setAnswers] = useState<(Answer | null)[]>(() =>
    questions.map(() => null),
  );
  const [step, setStep] = useState(0);

  // Clamp the active step if `questions` shrinks (shouldn't normally happen,
  // but SSE-driven prop changes shouldn't crash the renderer).
  const safeStep = Math.min(step, Math.max(questions.length - 1, 0));

  const setAt = (idx: number, next: Answer) =>
    setAnswers((prev) => {
      // Pad to current questions length in case the prop grew via SSE multi-emit.
      const padded =
        prev.length >= questions.length
          ? prev
          : [...prev, ...new Array(questions.length - prev.length).fill(null)];
      return padded.map((a, i) => (i === idx ? next : a));
    });

  if (questions.length === 0) return null;

  const current = questions[safeStep];
  const currentAnswered = isAnswered(answers[safeStep]);
  const isLast = safeStep === questions.length - 1;
  const allAnswered = questions.every((_, i) => isAnswered(answers[i]));
  const multi = questions.length > 1;

  const submit = () => {
    const padded = questions.map((_, i) => answers[i] ?? null);
    if (!padded.every(isAnswered)) return;
    onSubmit(flattenAnswers(questions, padded as Answer[]));
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {multi && (
        <div className="flex items-center justify-between text-[11px] text-[#3D3D3D]">
          <span className="font-medium">
            Question {safeStep + 1} of {questions.length}
          </span>
          <div className="flex gap-1">
            {questions.map((_, i) => (
              <span
                key={i}
                aria-label={`Step ${i + 1}${i === safeStep ? ' (current)' : ''}`}
                className={
                  'h-1.5 w-6 rounded-full ' +
                  (i < safeStep
                    ? 'bg-[#041729]'
                    : i === safeStep
                      ? 'bg-[#041729]'
                      : 'bg-[#E8E8E8]')
                }
              />
            ))}
          </div>
        </div>
      )}

      <QuestionCard
        key={`${current.title}-${safeStep}`}
        questionId={`${baseId}-${safeStep}`}
        question={current}
        answer={answers[safeStep] ?? null}
        disabled={submitted}
        onAnswerChange={(next) => setAt(safeStep, next)}
      />

      {submitted ? (
        <span className="text-xs text-gray-500 self-end">Submitted.</span>
      ) : (
        <div className="flex items-center justify-end gap-2">
          {multi && safeStep > 0 && (
            <button
              type="button"
              onClick={() => setStep(safeStep - 1)}
              className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors"
            >
              Back
            </button>
          )}
          {isLast ? (
            <button
              type="button"
              disabled={!allAnswered}
              onClick={submit}
              className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Submit
            </button>
          ) : (
            <button
              type="button"
              disabled={!currentAnswered}
              onClick={() => setStep(safeStep + 1)}
              className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Next
            </button>
          )}
        </div>
      )}
    </div>
  );
}
