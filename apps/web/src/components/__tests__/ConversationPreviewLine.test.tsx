import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConversationPreviewLine from '../ConversationPreviewLine';
import { EMPTY_CONVERSATION_PREVIEW } from '@/lib/conversation-preview';

describe('ConversationPreviewLine', () => {
  it('renders a real last message with standard excerpt styling', () => {
    render(<ConversationPreviewLine preview={{ kind: 'message', text: 'I noticed your interest in g…' }} />);
    const line = screen.getByTestId('conversation-preview-message');
    expect(line).toHaveTextContent('I noticed your interest in g…');
    expect(line.className).toContain('text-gray-500');
    expect(line.className).not.toContain('italic');
  });

  it('renders the empty-state placeholder distinctly more muted than a real message', () => {
    render(<ConversationPreviewLine preview={{ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW }} />);
    const line = screen.getByTestId('conversation-preview-empty');
    expect(line).toHaveTextContent('No messages yet');
    // More muted than a real excerpt: lighter color AND italic.
    expect(line.className).toContain('text-gray-400');
    expect(line.className).toContain('italic');
    expect(line.className).not.toContain('text-gray-500');
    expect(screen.queryByTestId('conversation-preview-message')).not.toBeInTheDocument();
  });

  it('truncates every variant to a single line', () => {
    const { rerender } = render(
      <ConversationPreviewLine preview={{ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW }} />,
    );
    expect(screen.getByTestId('conversation-preview-empty').className).toContain('truncate');

    rerender(<ConversationPreviewLine preview={{ kind: 'message', text: 'a very long message '.repeat(20) }} />);
    expect(screen.getByTestId('conversation-preview-message').className).toContain('truncate');
  });

  it('keeps the muted italic treatment for internal assessment excerpts', () => {
    render(<ConversationPreviewLine preview={{ kind: 'internal', text: 'Assessment: strong fit' }} />);
    const line = screen.getByTestId('conversation-preview-message');
    expect(line).toHaveTextContent('Internal:');
    expect(line).toHaveTextContent('Assessment: strong fit');
    expect(line.querySelector('span.italic')).not.toBeNull();
  });

  it('renders no raw evaluator reasoning or matchReason text', () => {
    render(
      <div>
        <ConversationPreviewLine preview={{ kind: 'empty', text: EMPTY_CONVERSATION_PREVIEW }} />
        <ConversationPreviewLine preview={{ kind: 'message', text: 'Hello there' }} />
      </div>,
    );
    expect(screen.queryByText(/reasoning/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/matchReason/i)).not.toBeInTheDocument();
  });

  it('strips markdown emphasis characters from real messages', () => {
    render(<ConversationPreviewLine preview={{ kind: 'message', text: '**bold** _note_' }} />);
    expect(screen.getByTestId('conversation-preview-message')).toHaveTextContent('bold note');
  });
});
