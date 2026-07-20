/**
 * Question variants — full-width interview card, sidebar card, in-chat interview.
 * Every variant has two states: UNANSWERED (interactive lettered options,
 * Submit / Dismiss) and ANSWERED (locked selection, answer summary, no actions).
 * Follows the InjectedQuestions design language: evidence chip, lettered A/B/C
 * option rows with selected states, "Other (specify)", dark primary Submit.
 */
import { useState } from 'react';
import { Check, HelpCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AnswerBody, PendingQuestion } from '@/services/questions';
import { LetterBadge, optionLetter, Pill, timeAgo } from './shared';

/** The library consumes the service question shape directly. */
export type LibraryQuestion = PendingQuestion;

/** True when the question carries a resolved answer worth rendering. */
function answeredAnswer(question: LibraryQuestion) {
  return question.status === 'answered' && question.answer ? question.answer : null;
}

interface OptionRowProps {
  letter: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  compact?: boolean;
  onToggle?: () => void;
}

/** One lettered option row — interactive when onToggle is set, read-only otherwise. */
function OptionRow({ letter, label, description, checked, disabled, compact, onToggle }: OptionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled || !onToggle}
      onClick={onToggle}
      aria-pressed={checked}
      className={cn(
        'group flex w-full items-start rounded-lg border text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30',
        compact ? 'gap-2 px-2.5 py-1.5' : 'gap-3 px-3 py-2.5',
        checked
          ? 'border-[#041729] bg-[#041729]/[0.045] shadow-sm'
          : 'border-gray-200 bg-white',
        onToggle && !disabled && !checked && 'hover:border-gray-300 hover:bg-gray-50',
        (disabled || !onToggle) && 'cursor-default',
      )}
    >
      <LetterBadge
        letter={letter}
        checked={checked}
        className={cn(compact ? 'mt-px h-4 w-4 text-[9px]' : 'mt-0.5', !checked && onToggle && !disabled && 'group-hover:bg-[#041729] group-hover:text-white')}
      />
      <span className="flex min-w-0 flex-col leading-snug">
        <span className={cn(checked ? 'font-medium text-gray-950' : 'text-gray-900', compact ? 'text-[13px]' : 'text-sm')}>
          {label}
        </span>
        {description && description !== label && !compact && (
          <span className="mt-0.5 text-xs font-normal text-gray-500">{description}</span>
        )}
      </span>
      {checked && !onToggle && <Check className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
    </button>
  );
}

/** Read-only answer summary shown in the ANSWERED state. */
function AnsweredState({ question, compact }: { question: LibraryQuestion; compact?: boolean }) {
  const answer = answeredAnswer(question);
  if (!answer) return null;
  return (
    <div className={cn('flex flex-col', compact ? 'gap-1' : 'gap-1.5')}>
      {answer.selectedOptions.map((label) => {
        const index = question.payload.options.findIndex((o) => o.label === label);
        const option = index >= 0 ? question.payload.options[index] : null;
        return (
          <OptionRow
            key={label}
            letter={optionLetter(index >= 0 ? index : 0)}
            label={label}
            description={option?.description}
            checked
            compact={compact}
          />
        );
      })}
      {answer.freeText && (
        <div
          className={cn(
            'rounded-lg border border-[#041729] bg-[#041729]/[0.045] shadow-sm',
            compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2.5 text-sm',
          )}
        >
          <span className="font-medium text-gray-950">{answer.freeText}</span>
          <span className="mt-0.5 block text-xs font-normal text-gray-500">Written answer</span>
        </div>
      )}
    </div>
  );
}

/** Emerald "Answered · 2h ago" pill shown in place of actions. */
function AnsweredPill({ question }: { question: LibraryQuestion }) {
  const answer = answeredAnswer(question);
  return (
    <Pill tone="emerald">
      <Check className="h-3 w-3" />
      Answered{answer?.answeredAt ? ` · ${timeAgo(answer.answeredAt)}` : ''}
    </Pill>
  );
}

interface QuestionCardProps {
  question: LibraryQuestion;
  onAnswer?: (questionId: string, body: AnswerBody) => void | Promise<void>;
  onDismiss?: (questionId: string) => void | Promise<void>;
  className?: string;
}

/**
 * 1 · Full-width question card — the complete interview surface: evidence,
 * prompt, lettered options with descriptions, Submit / Dismiss. In the
 * ANSWERED state the selection is locked and actions are replaced by an
 * "Answered" pill.
 */
export function QuestionCard({ question, onAnswer, onDismiss, className }: QuestionCardProps) {
  const answer = answeredAnswer(question);
  const [selected, setSelected] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { payload } = question;

  const toggle = (label: string) => {
    setOtherSelected(false);
    setOtherText('');
    if (payload.multiSelect) {
      setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
    } else {
      setSelected((prev) => (prev.includes(label) ? [] : [label]));
    }
  };

  const submit = async () => {
    if ((selected.length === 0 && (!otherSelected || otherText.trim().length === 0)) || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer?.(
        question.id,
        otherSelected
          ? { selectedOptions: [], freeText: otherText.trim() }
          : { selectedOptions: selected },
      );
    } finally {
      setSubmitting(false);
    }
  };

  const dismiss = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onDismiss?.(question.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-4 sm:p-5', className)}>
      {payload.evidence && (
        <div className="mb-2">
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
            {`◎ ${payload.evidence}`}
          </span>
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-snug text-gray-900">{payload.prompt}</h3>
          {!answer && payload.multiSelect && <p className="mt-1 text-xs text-gray-400">Select all that apply.</p>}
        </div>
        {answer && <AnsweredPill question={question} />}
      </div>

      <div className="mt-4">
        {answer ? (
          <AnsweredState question={question} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {payload.options.map((option, index) => (
              <OptionRow
                key={option.label}
                letter={optionLetter(index)}
                label={option.label}
                description={option.description}
                checked={selected.includes(option.label)}
                disabled={submitting}
                onToggle={() => toggle(option.label)}
              />
            ))}
            <OptionRow
              letter={optionLetter(payload.options.length)}
              label="Other (specify)"
              description="Write a custom response."
              checked={otherSelected}
              disabled={submitting}
              onToggle={() => {
                setOtherSelected((previous) => !previous);
                setSelected([]);
              }}
            />
            {otherSelected && (
              <input
                type="text"
                placeholder="Type your answer..."
                value={otherText}
                disabled={submitting}
                onChange={(event) => setOtherText(event.target.value)}
                className="mt-0.5 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:border-[#041729] focus:outline-none focus:ring-2 focus:ring-[#041729]/10"
              />
            )}
          </div>
        )}
      </div>

      {!answer && (onAnswer || onDismiss) && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {onDismiss && (
            <button
              type="button"
              disabled={submitting}
              onClick={dismiss}
              className="rounded-sm border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#3D3D3D] transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
          {onAnswer && (
            <button
              type="button"
              disabled={(selected.length === 0 && (!otherSelected || otherText.trim().length === 0)) || submitting}
              onClick={submit}
              className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 2 · Sidebar question card — prompt + option-letter preview + a single
 * "Answer" affordance. In the ANSWERED state the chosen answer is shown
 * instead of the option preview.
 */
interface QuestionSidebarCardProps {
  question: LibraryQuestion;
  onOpen?: (question: LibraryQuestion) => void;
  className?: string;
}

export function QuestionSidebarCard({ question, onOpen, className }: QuestionSidebarCardProps) {
  const answer = answeredAnswer(question);
  const { payload } = question;
  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4091BB]" />
          <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-gray-900 line-clamp-2">
            {payload.prompt}
          </p>
        </div>
        {answer && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
      </div>
      {answer ? (
        <p className="mt-2 pl-[22px] text-[13px] leading-snug text-gray-600 line-clamp-2">
          <span className="font-medium text-gray-900">
            {answer.selectedOptions[0] ?? answer.freeText}
          </span>
          {answer.selectedOptions.length > 1 && ` +${answer.selectedOptions.length - 1}`}
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-[22px]">
          {payload.options.slice(0, 4).map((option, index) => (
            <span
              key={option.label}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600"
            >
              <LetterBadge letter={optionLetter(index)} className="h-3.5 w-3.5 text-[8px]" />
              <span className="max-w-[90px] truncate">{option.label}</span>
            </span>
          ))}
          {payload.options.length > 4 && (
            <span className="text-[10px] text-gray-400 font-ibm-plex-mono">+{payload.options.length - 4}</span>
          )}
        </div>
      )}
      {!answer && onOpen && (
        <div className="mt-2.5 pl-[22px]">
          <button
            type="button"
            onClick={() => onOpen(question)}
            className="rounded-sm bg-[#041729] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#0a2d4a]"
          >
            Answer
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 3 · In-chat question — the actual interview rendered compactly inside the
 * chat flow (no chip collapse): prompt, lettered options, Submit / Dismiss.
 * In the ANSWERED state the selection is locked in place.
 */
export function QuestionInChat({ question, onAnswer, onDismiss, className }: QuestionCardProps) {
  const answer = answeredAnswer(question);
  const [selected, setSelected] = useState<string[]>([]);
  const [otherSelected, setOtherSelected] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { payload } = question;

  const toggle = (label: string) => {
    setOtherSelected(false);
    setOtherText('');
    if (payload.multiSelect) {
      setSelected((prev) => (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]));
    } else {
      setSelected((prev) => (prev.includes(label) ? [] : [label]));
    }
  };

  const submit = async () => {
    if ((selected.length === 0 && (!otherSelected || otherText.trim().length === 0)) || submitting) return;
    setSubmitting(true);
    try {
      await onAnswer?.(
        question.id,
        otherSelected
          ? { selectedOptions: [], freeText: otherText.trim() }
          : { selectedOptions: selected },
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-3 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#4091BB]" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold leading-snug text-gray-900">{payload.prompt}</p>
            {!answer && payload.multiSelect && <p className="mt-0.5 text-[11px] text-gray-400">Select all that apply.</p>}
          </div>
        </div>
        {answer && <AnsweredPill question={question} />}
      </div>

      <div className="mt-2.5">
        {answer ? (
          <AnsweredState question={question} compact />
        ) : (
          <div className="flex flex-col gap-1">
            {payload.options.map((option, index) => (
              <OptionRow
                key={option.label}
                letter={optionLetter(index)}
                label={option.label}
                checked={selected.includes(option.label)}
                disabled={submitting}
                compact
                onToggle={() => toggle(option.label)}
              />
            ))}
            <OptionRow
              letter={optionLetter(payload.options.length)}
              label="Other (specify)"
              checked={otherSelected}
              disabled={submitting}
              compact
              onToggle={() => {
                setOtherSelected((previous) => !previous);
                setSelected([]);
              }}
            />
            {otherSelected && (
              <input
                type="text"
                placeholder="Type your answer..."
                value={otherText}
                disabled={submitting}
                onChange={(event) => setOtherText(event.target.value)}
                className="mt-0.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-[#041729] focus:outline-none focus:ring-2 focus:ring-[#041729]/10"
              />
            )}
          </div>
        )}
      </div>

      {!answer && (onAnswer || onDismiss) && (
        <div className="mt-2.5 flex items-center justify-end gap-1.5">
          {onDismiss && (
            <button
              type="button"
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await onDismiss(question.id);
                } finally {
                  setSubmitting(false);
                }
              }}
              className="rounded-sm border border-gray-300 px-2.5 py-1 text-[11px] font-medium text-[#3D3D3D] transition-colors hover:bg-gray-100 disabled:opacity-50"
            >
              Dismiss
            </button>
          )}
          {onAnswer && (
            <button
              type="button"
              disabled={(selected.length === 0 && (!otherSelected || otherText.trim().length === 0)) || submitting}
              onClick={submit}
              className="rounded-sm bg-[#041729] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
