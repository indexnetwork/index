import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PendingQuestion } from '@/services/questions';
import { InjectedQuestions } from '../InjectedQuestions';

function makeQuestion({
  id = 'question-1',
  prompt = 'Which direction should we take?',
  multiSelect = false,
  evidence,
}: {
  id?: string;
  prompt?: string;
  multiSelect?: boolean;
  evidence?: string;
} = {}): PendingQuestion {
  return {
    id,
    detection: {
      mode: 'intent',
      sourceType: 'intent',
      sourceId: 'intent-1',
      timestamp: '2026-07-18T12:00:00.000Z',
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: {
      title: 'Direction',
      prompt,
      multiSelect,
      evidence,
      options: [
        { label: 'First choice', description: 'The first option description.' },
        { label: 'Second choice', description: 'The second option description.' },
      ],
    },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    conversationId: null,
  };
}

const onDismiss = vi.fn(async () => {});

describe('InjectedQuestions', () => {
  it('renders all questions by default with lettered option and Other rows', () => {
    render(
      <InjectedQuestions
        questions={[
          makeQuestion(),
          makeQuestion({ id: 'question-2', prompt: 'What timing works?' }),
        ]}
        onAnswer={vi.fn(async () => {})}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByText('Which direction should we take?')).toBeVisible();
    expect(screen.getByText('What timing works?')).toBeVisible();
    expect(screen.getAllByText('A')).toHaveLength(2);
    expect(screen.getAllByText('B')).toHaveLength(2);
    expect(screen.getAllByText('C')).toHaveLength(2);
    expect(screen.getAllByText('The first option description.')).toHaveLength(2);
    expect(screen.getAllByText('Write a custom response.')).toHaveLength(2);
  });

  it('gives transparent-input option rows a visible focus-within treatment', () => {
    render(
      <InjectedQuestions
        questions={[makeQuestion()]}
        onAnswer={vi.fn(async () => {})}
        onDismiss={onDismiss}
      />,
    );

    const option = screen.getByRole('radio', { name: /First choice/ });
    const row = option.closest('label');

    expect(row).toHaveClass(
      'focus-within:border-[#4091BB]',
      'focus-within:ring-2',
      'focus-within:ring-[#4091BB]/30',
      'focus-within:ring-offset-1',
    );
    option.focus();
    expect(option).toHaveFocus();
  });

  it('submits the selected single option only after Submit is clicked', async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <InjectedQuestions
        questions={[makeQuestion()]}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /First choice/ }));
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('question-1', {
        selectedOptions: ['First choice'],
      });
    });
  });

  it('submits every selected label for a multi-select question', async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <InjectedQuestions
        questions={[makeQuestion({ multiSelect: true })]}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /First choice/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Second choice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('question-1', {
        selectedOptions: ['First choice', 'Second choice'],
      });
    });
  });

  it('submits trimmed free text from the lettered Other row', async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <InjectedQuestions
        questions={[makeQuestion()]}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Other \(specify\)/ }));
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: '  A custom answer  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(onAnswer).toHaveBeenCalledWith('question-1', {
        selectedOptions: [],
        freeText: 'A custom answer',
      });
    });
  });

  it('pages one question at a time, advances after submit, and clamps when the list changes', async () => {
    const first = makeQuestion();
    const second = makeQuestion({ id: 'question-2', prompt: 'What timing works?' });
    const onAnswer = vi.fn(async () => {});
    const { rerender } = render(
      <InjectedQuestions
        questions={[first, second]}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
        paginate
      />,
    );

    const firstHeading = screen.getByRole('heading', { name: first.payload.prompt });
    expect(firstHeading).toBeVisible();
    expect(firstHeading).not.toHaveFocus();
    expect(screen.getByText(second.payload.prompt)).not.toBeVisible();
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    const secondHeading = screen.getByRole('heading', { name: second.payload.prompt });
    expect(secondHeading).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Previous question' }));
    expect(screen.getByRole('heading', { name: first.payload.prompt })).toHaveFocus();

    fireEvent.click(screen.getByRole('radio', { name: /First choice/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: second.payload.prompt })).toHaveFocus();
    });
    expect(screen.getByRole('button', { name: 'Previous question' })).toBeEnabled();

    rerender(
      <InjectedQuestions
        questions={[first]}
        onAnswer={onAnswer}
        onDismiss={onDismiss}
        paginate
      />,
    );

    expect(screen.getByText(first.payload.prompt)).toBeVisible();
    expect(screen.getByRole('radio', { name: /First choice/ })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Previous question' })).not.toBeInTheDocument();
  });

  it('moves focus after a successful paged dismiss', async () => {
    const first = makeQuestion();
    const second = makeQuestion({ id: 'question-2', prompt: 'What timing works?' });
    const handleDismiss = vi.fn(async () => {});
    render(
      <InjectedQuestions
        questions={[first, second]}
        onAnswer={vi.fn(async () => {})}
        onDismiss={handleDismiss}
        paginate
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => {
      expect(handleDismiss).toHaveBeenCalledWith(first.id);
      expect(screen.getByRole('heading', { name: second.payload.prompt })).toHaveFocus();
    });
  });

  it('preserves evidence and the follow-up typing indicator', () => {
    render(
      <InjectedQuestions
        questions={[makeQuestion({ evidence: 'Based on 18 matching people' })]}
        onAnswer={vi.fn(async () => {})}
        onDismiss={onDismiss}
        showTypingIndicator
        paginate
      />,
    );

    expect(screen.getByTestId('question-evidence-chip')).toHaveTextContent(
      'Based on 18 matching people',
    );
    expect(screen.getByTestId('question-chain-typing')).toHaveAccessibleName(
      'Your agent is preparing a follow-up',
    );
  });
});
