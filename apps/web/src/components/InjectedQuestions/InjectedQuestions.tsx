import { useState, useCallback, useLayoutEffect, useRef, type Ref } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PendingQuestion, AnswerBody } from '@/services/questions';
import { QuestionInChat } from '@/components/library/question';

const OTHER_VALUE = '__other__';

function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

interface LetteredOptionRowProps {
  name: string;
  value: string;
  type: 'radio' | 'checkbox';
  letter: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

/** A compact, full-width selectable row with the intent-page A/B/C language. */
function LetteredOptionRow({
  name,
  value,
  type,
  letter,
  label,
  description,
  checked,
  disabled,
  onChange,
}: LetteredOptionRowProps) {
  return (
    <label
      className={cn(
        'group relative flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-all focus-within:border-[#4091BB] focus-within:ring-2 focus-within:ring-[#4091BB]/30 focus-within:ring-offset-1',
        checked
          ? 'border-[#041729] bg-[#041729]/[0.045] shadow-sm'
          : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50',
        disabled && 'cursor-not-allowed opacity-50 hover:border-gray-200 hover:bg-white',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 focus-visible:outline-none disabled:cursor-not-allowed"
      />
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors',
          checked
            ? 'bg-[#041729] text-white'
            : 'bg-gray-100 text-gray-500 group-hover:bg-[#041729] group-hover:text-white',
        )}
      >
        {letter}
      </span>
      <span className="flex min-w-0 flex-col leading-snug">
        <span className={cn('text-sm', checked ? 'font-medium text-gray-950' : 'text-gray-900')}>
          {label}
        </span>
        {description && description !== label && (
          <span className="mt-0.5 text-xs font-normal text-gray-500">{description}</span>
        )}
      </span>
    </label>
  );
}

interface InjectedQuestionCardProps {
  question: PendingQuestion;
  onAnswer: (questionId: string, body: AnswerBody) => Promise<void>;
  onDismiss: (questionId: string) => Promise<void>;
  showPager?: boolean;
  canPrevious?: boolean;
  canNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  headingRef?: Ref<HTMLHeadingElement>;
}

function InjectedQuestionCard({
  question,
  onAnswer,
  onDismiss,
  showPager,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  headingRef,
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
      {payload.evidence && (
        <div className="mb-2">
          <span
            data-testid="question-evidence-chip"
            className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500"
          >
            {`\u25CE ${payload.evidence}`}
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="rounded-sm text-[15px] font-semibold leading-snug text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#4091BB]/40 focus:ring-offset-2"
          >
            {payload.prompt}
          </h3>
          {payload.multiSelect && (
            <p className="mt-1 text-xs text-gray-400">Select all that apply.</p>
          )}
        </div>
        {showPager && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Previous question"
              disabled={!canPrevious || submitting}
              onClick={onPrevious}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4091BB]/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Next question"
              disabled={!canNext || submitting}
              onClick={onNext}
              className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4091BB]/40 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-1.5">
        {payload.options.map((opt, index) => (
          <LetteredOptionRow
            key={opt.label}
            name={questionId}
            value={opt.label}
            type={payload.multiSelect ? 'checkbox' : 'radio'}
            letter={optionLetter(index)}
            label={opt.label}
            description={opt.description}
            checked={selectedLabels.includes(opt.label)}
            disabled={submitting}
            onChange={(checked) => toggleSelection(opt.label, checked)}
          />
        ))}
        <LetteredOptionRow
          name={questionId}
          value={OTHER_VALUE}
          type={payload.multiSelect ? 'checkbox' : 'radio'}
          letter={optionLetter(payload.options.length)}
          label="Other (specify)"
          description="Write a custom response."
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
  /** Show one question at a time with previous/next controls. Defaults to all questions. */
  paginate?: boolean;
  /** Render compact, in-chat question interviews instead of full intent-page cards. */
  variant?: 'full' | 'chat';
}

export function InjectedQuestions({
  questions,
  onAnswer,
  onDismiss,
  showTypingIndicator,
  paginate = false,
  variant = 'full',
}: InjectedQuestionsProps) {
  const [pagedQuestionId, setPagedQuestionId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const handledFocusRequestRef = useRef(0);
  const activeQuestionHeadingRef = useRef<HTMLHeadingElement>(null);
  const requestedIndex = pagedQuestionId
    ? questions.findIndex((question) => question.id === pagedQuestionId)
    : -1;
  const currentIndex = questions.length === 0 ? 0 : Math.max(requestedIndex, 0);
  const currentQuestionId = questions[currentIndex]?.id;
  const showQuestionAndFocus = useCallback((questionId: string) => {
    setPagedQuestionId(questionId);
    setFocusRequest((request) => request + 1);
  }, []);
  const selectQuestionAfter = useCallback((questionId: string) => {
    const answeredIndex = questions.findIndex((question) => question.id === questionId);
    const nextQuestion = questions[answeredIndex + 1] ?? questions[answeredIndex - 1];
    if (nextQuestion) showQuestionAndFocus(nextQuestion.id);
  }, [questions, showQuestionAndFocus]);

  useLayoutEffect(() => {
    if (
      !paginate
      || focusRequest === handledFocusRequestRef.current
      || !currentQuestionId
    ) return;
    handledFocusRequestRef.current = focusRequest;
    activeQuestionHeadingRef.current?.focus();
  }, [currentQuestionId, focusRequest, paginate]);

  const handleAnswer = useCallback(async (questionId: string, body: AnswerBody) => {
    await onAnswer(questionId, body);
    if (paginate) selectQuestionAfter(questionId);
  }, [onAnswer, paginate, selectQuestionAfter]);

  const handleDismiss = useCallback(async (questionId: string) => {
    await onDismiss(questionId);
    if (paginate) selectQuestionAfter(questionId);
  }, [onDismiss, paginate, selectQuestionAfter]);

  if (questions.length === 0 && !showTypingIndicator) return null;

  return (
    <div className="flex flex-col gap-2">
      {questions.map((question, index) => (
        <div key={question.id} hidden={variant === 'full' && paginate && index !== currentIndex}>
          {variant === 'chat' ? (
            <QuestionInChat
              question={question}
              onAnswer={handleAnswer}
              onDismiss={handleDismiss}
            />
          ) : (
            <InjectedQuestionCard
              question={question}
              onAnswer={handleAnswer}
              onDismiss={handleDismiss}
              showPager={paginate && questions.length > 1 && index === currentIndex}
              canPrevious={currentIndex > 0}
              canNext={currentIndex < questions.length - 1}
              onPrevious={() => {
                const previousQuestion = questions[currentIndex - 1];
                if (previousQuestion) showQuestionAndFocus(previousQuestion.id);
              }}
              onNext={() => {
                const nextQuestion = questions[currentIndex + 1];
                if (nextQuestion) showQuestionAndFocus(nextQuestion.id);
              }}
              headingRef={index === currentIndex ? activeQuestionHeadingRef : undefined}
            />
          )}
        </div>
      ))}
      {showTypingIndicator && <TypingDots />}
    </div>
  );
}
