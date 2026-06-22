import { Zap, Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Suggestion } from '@/hooks/useSuggestions';

export interface SuggestionChipsProps {
  suggestions: Suggestion[];
  disabled: boolean;
  onSuggestionClick: (suggestion: Suggestion) => void;
}

/**
 * Horizontal list of suggestion chips above the chat input.
 * When disabled (e.g. while streaming), chips are dimmed and show not-allowed cursor.
 */
export function SuggestionChips({ suggestions, disabled, onSuggestionClick }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className={cn(
        'mb-3 flex items-center gap-2 overflow-x-auto scrollbar-hide',
        disabled && 'cursor-not-allowed'
      )}
      aria-busy={disabled}
    >
      {suggestions.map((suggestion, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSuggestionClick(suggestion)}
          disabled={disabled}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-gray-200 rounded-full text-xs text-[#3D3D3D] transition-colors shadow-sm whitespace-nowrap flex-shrink-0',
            disabled
              ? '!cursor-not-allowed opacity-50 hover:bg-white hover:border-gray-200'
              : 'cursor-pointer hover:bg-gray-50 hover:border-gray-300'
          )}
        >
          {suggestion.type === 'direct' ? (
            <Zap className="w-3 h-3 text-gray-400" />
          ) : (
            <Type className="w-3 h-3 text-gray-400" />
          )}
          {suggestion.label}
        </button>
      ))}
    </div>
  );
}
