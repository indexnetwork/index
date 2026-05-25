import { useState, useCallback } from 'react';
import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OptionRow } from '@/components/DecisionQuestions/OptionRow';
import type { PendingQuestion, AnswerBody } from '@/services/questions';

const OTHER_VALUE = '__other__';

interface InjectedQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
}

function InjectedQuestionCard({ question, onAnswer, onDismiss }: InjectedQuestionCardProps) {
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [otherText, setOtherText] = useState('');
  const [otherSelected, setOtherSelected] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { payload } = question;
  const questionId = question.id;

  const toggleSelection = (label: string, nextChecked: boolean) => {
    if (nextChecked) setOtherSelected(false);
    if (payload.multiSelect) {
      setSelectedLabels((prev) =>
        nextChecked ? [...prev, label] : prev.filter((l) => l !== label),
      );
    } else if (nextChecked) {
      setSelectedLabels([label]);
    }
  };

  const hasAnswer = selectedLabels.length > 0 || (otherSelected && otherText.trim().length > 0);

  const handleSubmit = useCallback(async () => {
    if (!hasAnswer || submitting) return;
    setSubmitting(true);
    try {
      const body: AnswerBody = otherSelected
        ? { selectedOptions: [], freeText: otherText.trim() }
        : { selectedOptions: selectedLabels };
      await onAnswer(questionId, body);
    } finally {
      setSubmitting(false);
    }
  }, [hasAnswer, submitting, otherSelected, otherText, selectedLabels, onAnswer, questionId]);

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
    <div className="max-w-[75%]">
      <div className="bg-white border border-gray-200 border-l-[3px] border-l-gray-400 rounded-[2px] p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <CircleHelp className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">
            Follow-up
          </span>
        </div>

        <p className="text-[13px] font-semibold text-gray-900 mb-1.5">{payload.prompt}</p>

        <div className="flex flex-col gap-1.5 mb-3">
          {payload.options.map((opt) => (
            <OptionRow
              key={opt.label}
              name={questionId}
              value={opt.label}
              type={payload.multiSelect ? 'checkbox' : 'radio'}
              label={opt.label}
              description={opt.description}
              checked={selectedLabels.includes(opt.label)}
              disabled={submitting}
              onChange={(checked) => toggleSelection(opt.label, checked)}
            />
          ))}
          <OptionRow
            name={questionId}
            value={OTHER_VALUE}
            type={payload.multiSelect ? 'checkbox' : 'radio'}
            label="Other (specify)"
            description="Type your own answer."
            checked={otherSelected}
            disabled={submitting}
            onChange={(checked) => {
              setOtherSelected(checked);
              if (!checked) setSelectedLabels([]);
            }}
          />
          {otherSelected && (
            <input
              type="text"
              placeholder="Specify..."
              value={otherText}
              disabled={submitting}
              onChange={(e) => setOtherText(e.target.value)}
              className="text-[13px] text-gray-700 bg-white border border-gray-200 rounded-[2px] px-3 py-2 focus:outline-none focus:border-gray-700"
            />
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDismiss}
            disabled={submitting}
            className={cn(
              'px-2.5 py-1 text-[12px] border border-gray-300 bg-white text-gray-700 rounded-[2px] cursor-pointer',
              submitting && 'opacity-60 cursor-not-allowed',
            )}
          >
            Dismiss
          </button>
          <button
            onClick={handleSubmit}
            disabled={!hasAnswer || submitting}
            className={cn(
              'px-2.5 py-1 text-[12px] border-none bg-[#041729] text-white rounded-[2px] cursor-pointer',
              (!hasAnswer || submitting) && 'opacity-60 cursor-not-allowed',
            )}
          >
            Submit
          </button>
        </div>
      </div>
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
