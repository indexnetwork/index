import { useState, useCallback } from 'react';
import { OptionRow } from '@/components/DecisionQuestions/OptionRow';
import { toSignalProductLanguage } from '@/lib/product-language';
import type { PendingQuestion, AnswerBody } from '@/services/questions';

const OTHER_VALUE = '__other__';

interface InjectedQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  showAskedKicker?: boolean;
}

function InjectedQuestionCard({
  question,
  onAnswer,
  onDismiss,
  showAskedKicker = false,
}: InjectedQuestionCardProps) {
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
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      {showAskedKicker && (
        <p className="mb-2 text-xs uppercase tracking-wider text-gray-500 font-ibm-plex-mono">
          ASKED JUST NOW
        </p>
      )}
      {payload.evidence && (
        <div className="mb-2">
          <span
            data-testid="question-evidence-chip"
            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
          >
            {`\u25CE ${toSignalProductLanguage(payload.evidence)}`}
          </span>
        </div>
      )}
      <p className="text-[15px] font-semibold leading-snug text-gray-900">
        {payload.prompt}
      </p>
      {payload.multiSelect && (
        <p className="mt-1 text-xs text-gray-400">Select all that apply.</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
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
            showSubline={!payload.multiSelect}
          />
        ))}
        <OptionRow
          name={questionId}
          value={OTHER_VALUE}
          type={payload.multiSelect ? 'checkbox' : 'radio'}
          label="Other (specify)"
          description="Something else"
          checked={otherSelected}
          disabled={submitting}
          onChange={(checked) => {
            setOtherSelected(checked);
            if (checked) setSelectedLabels([]);
          }}
        />
        {otherSelected && (
          <input
            type="text"
            placeholder="Type your answer..."
            value={otherText}
            disabled={submitting}
            autoFocus
            onChange={(e) => setOtherText(e.target.value)}
            className="mt-0.5 text-sm text-gray-800 bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 placeholder:text-gray-400 focus:outline-none focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10"
          />
        )}
      </div>

      <div className="mt-4 flex justify-end gap-1.5 border-t border-gray-100 pt-4">
        <button
          type="button"
          onClick={handleDismiss}
          disabled={submitting}
          className="bg-transparent border border-gray-400 text-[#3D3D3D] px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-gray-200 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!hasAnswer || submitting}
          className="bg-[#041729] text-white px-3 py-1.5 rounded-sm text-xs font-medium hover:bg-[#0a2d4a] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {submitting ? 'Saving...' : 'Submit'}
        </button>
      </div>
    </div>
  );
}

/**
 * Three-dot typing indicator shown while the agent may be preparing a
 * follow-up pool-discovery question (interview-mode chaining, IND-418).
 */
function TypingDots() {
  return (
    <div
      data-testid="question-chain-typing"
      aria-label="Your agent is preparing a follow-up"
      className="flex items-center gap-1 px-2 py-2"
    >
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gray-400 [animation-delay:300ms]" />
    </div>
  );
}

interface InjectedQuestionsProps {
  questions: PendingQuestion[];
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  /** Show a typing indicator below the cards (follow-up may be incoming). */
  showTypingIndicator?: boolean;
  /** Render the intent-workspace-only pending-question kicker. */
  showAskedKicker?: boolean;
}

export function InjectedQuestions({
  questions,
  onAnswer,
  onDismiss,
  showTypingIndicator,
  showAskedKicker,
}: InjectedQuestionsProps) {
  if (questions.length === 0 && !showTypingIndicator) return null;

  return (
    <div className="flex flex-col gap-2">
      {questions.map((q) => (
        <InjectedQuestionCard
          key={q.id}
          question={q}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
          showAskedKicker={showAskedKicker}
        />
      ))}
      {showTypingIndicator && <TypingDots />}
    </div>
  );
}
