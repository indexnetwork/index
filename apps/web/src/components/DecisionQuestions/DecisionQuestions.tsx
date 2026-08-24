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

  const allAnswered = questions.every((_, i) => isAnswered(answers[i]));

  const submit = () => {
    const padded = questions.map((_, i) => answers[i] ?? null);
    if (!padded.every(isAnswered)) return;
    onSubmit(flattenAnswers(questions, padded as Answer[]));
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {questions.map((question, index) => (
        <QuestionCard
          key={`${question.title}-${index}`}
          questionId={`${baseId}-${index}`}
          question={question}
          answer={answers[index] ?? null}
          disabled={submitted}
          onAnswerChange={(next) => setAt(index, next)}
        />
      ))}

      {submitted ? (
        <span className="text-xs text-gray-500 self-end">Submitted.</span>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={!allAnswered}
            onClick={submit}
            className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Submit
          </button>
        </div>
      )}
    </div>
  );
}
