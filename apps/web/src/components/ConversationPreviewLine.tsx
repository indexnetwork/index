import type { ConversationPreview } from '@/lib/conversation-preview';

/**
 * One-line preview subtitle for a conversation-list row (IND-504).
 *
 * Real last messages render in the standard excerpt style (`text-gray-500`);
 * internal assessments keep their muted italic treatment; conversations with
 * no messages render a neutral `No messages yet` placeholder that is
 * deliberately more muted (italic, `text-gray-400`) than a real excerpt.
 * Every variant is truncated to a single line via Tailwind `truncate`.
 */
export default function ConversationPreviewLine({ preview }: { preview: ConversationPreview }) {
  if (preview.kind === 'empty') {
    return (
      <p data-testid="conversation-preview-empty" className="truncate text-sm font-normal italic text-gray-400">
        {preview.text}
      </p>
    );
  }

  return (
    <p data-testid="conversation-preview-message" className="truncate text-sm font-normal text-gray-500">
      {preview.kind === 'internal' && (
        <span className="mr-1 italic text-gray-400">Internal:</span>
      )}
      <span className={preview.kind === 'internal' ? 'italic text-gray-400' : undefined}>
        {preview.text.replace(/[*_~`#>]/g, '')}
      </span>
    </p>
  );
}
