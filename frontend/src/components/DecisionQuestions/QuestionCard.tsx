import { useState } from 'react';
import { cn } from '@/lib/utils';
import { OptionRow } from './OptionRow';
import type { Question } from './types';
import type { Answer } from './flatten';

interface QuestionCardProps {
  questionId: string;
  question: Question;
  answer: Answer | null;
  disabled: boolean;
  onAnswerChange: (next: Answer) => void;
}

const OTHER_VALUE = '__other__';

export function QuestionCard({
  questionId,
  question,
  answer,
  disabled,
  onAnswerChange,
}: QuestionCardProps) {
  const selectedLabels =
    answer?.kind === 'selection' ? answer.selectedLabels : [];

  // Local state: tracks the Other text as the user types.
  // Initialized from the answer prop; subsequent updates come from the input.
  const [otherText, setOtherText] = useState(
    answer?.kind === 'other' ? answer.text : '',
  );

  // "Other" is selected when the parent answer says so (controlled),
  // OR when the user just clicked it this render cycle (local click flag).
  // We store local click state so the text input appears immediately on click
  // without waiting for the parent to re-render with the new answer prop.
  const [localOtherSelected, setLocalOtherSelected] = useState(false);
  const otherSelected = answer?.kind === 'other' || localOtherSelected;

  const toggleSelection = (label: string, nextChecked: boolean) => {
    // Selecting a named option clears local other state
    if (nextChecked) setLocalOtherSelected(false);
    if (question.multiSelect) {
      const next = nextChecked
        ? [...selectedLabels, label]
        : selectedLabels.filter((l) => l !== label);
      onAnswerChange({ kind: 'selection', selectedLabels: next });
    } else if (nextChecked) {
      onAnswerChange({ kind: 'selection', selectedLabels: [label] });
    }
  };

  return (
    <div
      className={cn(
        'rounded-md p-4 flex flex-col gap-3 bg-[#F8F8F8]',
        disabled && 'opacity-60',
      )}
    >
      <span className="inline-block self-start text-[10px] uppercase tracking-wider font-bold bg-white border border-[#E8E8E8] rounded-sm px-2 py-0.5 text-gray-900">
        {question.title}
      </span>
      <p className="text-[14px] text-[#3D3D3D] leading-relaxed">{question.prompt}</p>

      <div className="flex flex-col gap-1.5">
        {question.options.map((opt) => (
          <OptionRow
            key={opt.label}
            name={questionId}
            value={opt.label}
            type={question.multiSelect ? 'checkbox' : 'radio'}
            label={opt.label}
            description={opt.description}
            checked={selectedLabels.includes(opt.label)}
            disabled={disabled}
            onChange={(checked) => toggleSelection(opt.label, checked)}
          />
        ))}

        <OptionRow
          name={questionId}
          value={OTHER_VALUE}
          type={question.multiSelect ? 'checkbox' : 'radio'}
          label="Other (specify)"
          description="Type your own answer."
          checked={otherSelected}
          disabled={disabled}
          onChange={(checked) => {
            setLocalOtherSelected(checked);
            if (checked) {
              onAnswerChange({ kind: 'other', text: otherText });
            } else {
              onAnswerChange({ kind: 'selection', selectedLabels });
            }
          }}
        />

        {otherSelected && (
          <input
            type="text"
            placeholder="Specify..."
            value={otherText}
            disabled={disabled}
            onChange={(e) => {
              setOtherText(e.target.value);
              onAnswerChange({ kind: 'other', text: e.target.value });
            }}
            className="text-[14px] text-[#3D3D3D] bg-white border border-[#E8E8E8] rounded-md px-3 py-2 focus:outline-none focus:border-[#3D3D3D]"
          />
        )}
      </div>
    </div>
  );
}
