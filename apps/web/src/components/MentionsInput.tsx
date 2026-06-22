import { MentionsInput as ReactMentionsInput, Mention, SuggestionDataItem } from 'react-mentions';
import { useMentionableUsers, MentionableUser } from '@/hooks/useMentionableUsers';
import UserAvatar from '@/components/UserAvatar';

interface MentionsInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onSubmit?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputRef?: React.RefObject<any>;
  /** Show the suggestions dropdown above the input (for sticky-bottom inputs) */
  suggestionsAbove?: boolean;
}

// Custom styles for react-mentions to match existing design
const getMentionsInputStyle = (above?: boolean) => ({
  control: {
    backgroundColor: 'transparent',
    fontSize: 14,
    fontWeight: 'normal',
    minHeight: 32,
  },
  '&multiLine': {
    control: {
      minHeight: 32,
    },
    highlighter: {
      padding: '6px 0',
      border: 'none',
      lineHeight: '20px',
      wordBreak: 'break-word' as const,
      overflowWrap: 'break-word' as const,
    },
    input: {
      padding: '6px 0',
      border: 'none',
      outline: 'none',
      backgroundColor: 'transparent',
      color: '#000000',
      overflow: 'auto',
      lineHeight: '20px',
      wordBreak: 'break-word' as const,
      overflowWrap: 'break-word' as const,
    },
  },
  suggestions: {
    list: {
      backgroundColor: 'white',
      border: '1px solid #E9E9E9',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
      maxHeight: '200px',
      overflowY: 'auto' as const,
      position: 'absolute' as const,
      zIndex: 100,
      ...(above
        ? { bottom: '100%', marginBottom: '8px' }
        : { top: '100%', marginTop: '8px' }),
    },
    item: {
      padding: '2px 6px',
      cursor: 'pointer',
      '&focused': {
        backgroundColor: '#F5F5F5',
      },
    },
  },
});

// Style for highlighted mentions in the input
// Note: react-mentions overlays a highlighter on the input, the background shows through
const mentionStyle = {
  backgroundColor: '#EFE4F5',
};

function renderSuggestion(
  suggestion: SuggestionDataItem,
  _search: string,
  _highlightedDisplay: React.ReactNode,
  _index: number,
  focused: boolean
): React.ReactNode {
  const user = suggestion as MentionableUser & SuggestionDataItem;
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${
        focused ? 'bg-gray-100' : 'bg-white'
      }`}
    >
      <UserAvatar
        name={user.display}
        avatar={user.avatar}
        size={24}
        className="flex-shrink-0"
      />
      <span className="text-sm text-gray-900 truncate">{user.display}</span>
    </div>
  );
}

export function MentionsTextInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  onKeyDown,
  onSubmit,
  inputRef,
  suggestionsAbove,
}: MentionsInputProps) {
  const { searchUsers } = useMentionableUsers({ enabled: true });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (onSubmit) {
        onSubmit();
      } else {
        (e.target as HTMLElement).closest('form')?.requestSubmit();
      }
    }
    onKeyDown?.(e);
  };

  return (
    <ReactMentionsInput
      value={value}
      onChange={(e, newValue) => onChange(newValue)}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onKeyDown={handleKeyDown}
      style={getMentionsInputStyle(suggestionsAbove)}
      forceSuggestionsAboveCursor={suggestionsAbove}
      a11ySuggestionsListLabel="Suggested users"
      className="flex-1"
      inputRef={inputRef}
    >
      <Mention
        trigger="@"
        data={searchUsers}
        markup="@[__display__](__id__)"
        style={mentionStyle}
        displayTransform={(_id: string, display: string) => `@${display}`}
        renderSuggestion={renderSuggestion}
        appendSpaceOnAdd
      />
    </ReactMentionsInput>
  );
}

export default MentionsTextInput;
