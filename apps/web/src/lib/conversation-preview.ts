/**
 * Conversation-list preview line resolution (IND-504).
 *
 * Rows in the conversation list show a one-line excerpt of the last message.
 * Rows whose conversation has no messages rendered a visually empty subtitle;
 * this helper gives every row a deterministic preview descriptor.
 *
 * Presentation safety: the conversation-list DTO (`ConversationSummary`) does
 * not carry canonical `OpportunityPresenter`-produced text for the linked
 * opportunity, and fetching it would require per-row presenter work, so empty
 * rows fall back to a grammatical neutral placeholder. Raw evaluator fields
 * (`interpretation.reasoning`, `matchReason`) are never accepted here — the
 * input shape has no slot for them, and the placeholder is emitted instead of
 * any heuristic or fabricated text.
 */

/** Neutral placeholder shown for conversations with no messages yet. */
export const EMPTY_CONVERSATION_PREVIEW = 'No messages yet';

/** Input for preview resolution: the row's last-message state only. */
export interface ConversationPreviewInput {
  /** Plain-text content of the last message, or an empty string when none. */
  lastMessage: string;
  /** Whether the last message is an internal (non-user-facing) assessment. */
  lastMessageIsInternal: boolean;
}

/**
 * Resolved preview descriptor for one conversation row.
 * - `message`: a real last message, rendered with normal excerpt styling.
 * - `internal`: an internal assessment excerpt, rendered muted + italic.
 * - `empty`: no messages yet, rendered as a muted placeholder.
 *
 * `text` is markdown-stripped and trimmed, ready to render as-is.
 */
export type ConversationPreview =
  | { kind: 'message'; text: string }
  | { kind: 'internal'; text: string }
  | { kind: 'empty'; text: typeof EMPTY_CONVERSATION_PREVIEW };

/** Strips markdown emphasis/structure characters for a one-line plain-text excerpt. */
export const stripMarkdownMarkers = (text: string): string => text.replace(/[*_~`#>]/g, '');

/**
 * Resolves the preview line for a conversation row.
 *
 * Emptiness is evaluated on the markdown-stripped, whitespace-trimmed text, so
 * markdown-only strings (e.g. `***`, `** **`, `` ` ``) resolve to the `empty`
 * placeholder instead of rendering blank after stripping.
 *
 * @param input - The row's last-message state
 * @returns The preview descriptor; `empty` rows always get the neutral
 *   placeholder, never fabricated or evaluator-reasoning text
 */
export function resolveConversationPreview(input: ConversationPreviewInput): ConversationPreview {
  const text = stripMarkdownMarkers(input.lastMessage).trim();
  if (!text) {
    return { kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW };
  }
  return { kind: input.lastMessageIsInternal ? 'internal' : 'message', text };
}
