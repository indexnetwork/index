import { describe, expect, it } from 'vitest';

import { EMPTY_CONVERSATION_PREVIEW, resolveConversationPreview } from '@/lib/conversation-preview';

describe('resolveConversationPreview', () => {
  it('selects the real last message as the preview when one exists', () => {
    const preview = resolveConversationPreview({
      lastMessage: 'I noticed your interest in graph databases',
      lastMessageIsInternal: false,
    });
    expect(preview).toEqual({ kind: 'message', text: 'I noticed your interest in graph databases' });
  });

  it('selects the neutral placeholder when the conversation has no messages', () => {
    const preview = resolveConversationPreview({ lastMessage: '', lastMessageIsInternal: false });
    expect(preview).toEqual({ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW });
    expect(preview.text).toBe('No messages yet');
  });

  it('selects the placeholder for whitespace-only last messages', () => {
    const preview = resolveConversationPreview({ lastMessage: '   \n ', lastMessageIsInternal: false });
    expect(preview.kind).toBe('empty');
  });

  it.each([
    '***',
    '** **',
    '___',
    '`',
    '```',
    '  ***  \n ',
    '~~ ~~',
    '# >',
  ])('selects the placeholder for markdown-only last message %j', (lastMessage) => {
    const preview = resolveConversationPreview({ lastMessage, lastMessageIsInternal: false });
    expect(preview).toEqual({ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW });
  });

  it('keeps a real excerpt that survives markdown stripping as a message, pre-stripped', () => {
    const preview = resolveConversationPreview({ lastMessage: '**bold** _note_', lastMessageIsInternal: false });
    expect(preview).toEqual({ kind: 'message', text: 'bold note' });
  });

  it('strips markdown markers but preserves real content around them', () => {
    const preview = resolveConversationPreview({
      lastMessage: '  > I noticed your **interest** in `graphs`  ',
      lastMessageIsInternal: false,
    });
    expect(preview).toEqual({ kind: 'message', text: 'I noticed your interest in graphs' });
  });

  it('marks internal assessment excerpts as internal, not empty', () => {
    const preview = resolveConversationPreview({
      lastMessage: 'Assessment: strong complementary fit',
      lastMessageIsInternal: true,
    });
    expect(preview).toEqual({ kind: 'internal', text: 'Assessment: strong complementary fit' });
  });

  it('resolves markdown-only internal messages to the placeholder, not a blank internal line', () => {
    const preview = resolveConversationPreview({ lastMessage: '***', lastMessageIsInternal: true });
    expect(preview).toEqual({ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW });
  });

  it('never surfaces raw evaluator reasoning fields — only the placeholder', () => {
    // The conversation-list DTO carries opportunity linkage (`via`) but no
    // presenter-produced text. Even if raw evaluator fields were smuggled
    // onto the input object, they must not leak into the preview.
    const smuggled = {
      lastMessage: '',
      lastMessageIsInternal: false,
      interpretation: { reasoning: 'RAW_EVALUATOR_REASONING' },
      matchReason: 'RAW_MATCH_REASON',
    };
    const preview = resolveConversationPreview(smuggled);
    expect(preview.kind).toBe('empty');
    expect(preview.text).toBe(EMPTY_CONVERSATION_PREVIEW);
    expect(preview.text).not.toContain('RAW_EVALUATOR_REASONING');
    expect(preview.text).not.toContain('RAW_MATCH_REASON');
  });
});
