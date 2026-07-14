import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

interface OptionRowProps {
  name: string;
  value: string;
  /** "radio" for single-select, "checkbox" for multi-select. */
  type: 'radio' | 'checkbox';
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  /**
   * Render the label as the main line with the description as a muted
   * sub-line (chip-style options with counts, e.g. pool discriminators).
   * Default keeps the legacy single-line `description || label` rendering.
   */
  showSubline?: boolean;
}

/**
 * A single selectable answer row. Renders a concise, vertically-centered line
 * with a custom navy indicator (filled dot for radio, check for checkbox).
 * The native input is kept for accessibility but visually hidden.
 */
export function OptionRow({
  name,
  value,
  type,
  label,
  description,
  checked,
  disabled,
  onChange,
  showSubline,
}: OptionRowProps) {
  return (
    <label
      className={cn(
        'group relative flex items-center gap-3 rounded-lg border px-3.5 py-2.5 transition-colors cursor-pointer',
        checked
          ? 'border-[#041729] bg-[#041729]/[0.035]'
          : 'border-[#E8E8E8] hover:border-gray-300 hover:bg-gray-50',
        disabled && 'opacity-50 cursor-not-allowed hover:border-[#E8E8E8] hover:bg-transparent',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        // Invisible but coextensive with the row — NOT sr-only. A clipped 1px
        // sr-only input has a degenerate rect, so focusing it on click made the
        // browser "reveal" it by scrolling ancestor containers, including the
        // overflow-hidden app shell (which users cannot scroll back) — the
        // whole page appeared to go blank. Filling the row keeps the focus
        // target where the user already is, so focus-scroll is a no-op.
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className={cn(
          'flex h-[18px] w-[18px] shrink-0 items-center justify-center border transition-colors',
          type === 'radio' ? 'rounded-full' : 'rounded-[5px]',
          checked
            ? 'border-[#041729] bg-[#041729]'
            : 'border-gray-300 bg-white group-hover:border-gray-400',
        )}
      >
        {checked && type === 'radio' && (
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
        )}
        {checked && type === 'checkbox' && (
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        )}
      </span>
      <span
        className={cn(
          'flex min-w-0 flex-col text-sm leading-snug',
          checked ? 'font-medium text-gray-900' : 'text-gray-700',
        )}
      >
        {showSubline ? (
          <>
            <span>{label}</span>
            {description && description !== label && (
              <span className="text-xs font-normal text-gray-500">{description}</span>
            )}
          </>
        ) : (
          description || label
        )}
      </span>
    </label>
  );
}
