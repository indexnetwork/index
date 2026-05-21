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
}

export function OptionRow({
  name,
  value,
  type,
  label,
  description,
  checked,
  disabled,
  onChange,
}: OptionRowProps) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-md border border-[#E8E8E8] bg-white cursor-pointer',
        'hover:bg-[#F0F0F0] transition-colors',
        checked && 'bg-[#F0F0F0] border-[#041729]',
        disabled && 'opacity-50 cursor-not-allowed hover:bg-white',
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 accent-[#041729]"
      />
      <span className="flex flex-col">
        <span className="text-sm font-bold text-gray-900">{label}</span>
        <span className="text-[11px] text-[#3D3D3D]">{description}</span>
      </span>
    </label>
  );
}
