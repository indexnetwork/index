import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ConsultationCard, formatConsultationTimeLeft } from '../PendingQuestions/ConsultationCard';
import type { PendingQuestion } from '@/services/questions';

const CREATED_AT = '2026-07-24T12:00:00.000Z';
const createdAtMs = new Date(CREATED_AT).getTime();

function consultation(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: 'q-1',
    detection: {
      mode: 'negotiation_inflight',
      sourceType: 'opportunity',
      sourceId: 'opportunity-1',
      timestamp: CREATED_AT,
    },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: {
      title: 'Consultation',
      prompt: 'How much time could you realistically give a collaboration?',
      options: [],
      multiSelect: false,
    },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: CREATED_AT,
    conversationId: null,
    ...overrides,
  };
}

describe('formatConsultationTimeLeft', () => {
  it('formats hours remaining in the 24h window', () => {
    expect(formatConsultationTimeLeft(CREATED_AT, createdAtMs + 30 * 60_000)).toBe('23h left');
  });

  it('formats minutes remaining under an hour', () => {
    expect(formatConsultationTimeLeft(CREATED_AT, createdAtMs + 23 * 3_600_000 + 15 * 60_000)).toBe('45m left');
  });

  it('clamps to one minute once the window has lapsed', () => {
    expect(formatConsultationTimeLeft(CREATED_AT, createdAtMs + 25 * 3_600_000)).toBe('1m left');
  });

  it('returns an empty label for an unparseable creation time', () => {
    expect(formatConsultationTimeLeft('not-a-date', createdAtMs)).toBe('');
  });
});

describe('ConsultationCard', () => {
  it('renders the priority framing: navy chip, question, countdown, privacy line', () => {
    render(
      <ConsultationCard
        question={consultation()}
        onAnswer={vi.fn()}
        now={createdAtMs + 60 * 60_000}
      />,
    );
    expect(screen.getByTestId('consultation-card')).toBeInTheDocument();
    expect(screen.getByText('Your move')).toBeInTheDocument();
    expect(screen.getByText('Your agent is asking')).toBeInTheDocument();
    expect(screen.getByText('How much time could you realistically give a collaboration?')).toBeInTheDocument();
    expect(screen.getByTestId('consultation-countdown')).toHaveTextContent('23h left');
    expect(screen.getByText('Only your agent sees this — it decides what to disclose.')).toBeInTheDocument();
  });

  it('submits the inline answer as free text', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<ConsultationCard question={consultation()} onAnswer={onAnswer} now={createdAtMs} />);

    fireEvent.change(screen.getByLabelText('Answer your agent'), {
      target: { value: 'A few hours a month, async only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('q-1', {
        selectedOptions: [],
        freeText: 'A few hours a month, async only',
      }),
    );
  });

  it('submits on Enter', async () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(<ConsultationCard question={consultation()} onAnswer={onAnswer} now={createdAtMs} />);

    const input = screen.getByLabelText('Answer your agent');
    fireEvent.change(input, { target: { value: 'Yes, tell them yes' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(onAnswer).toHaveBeenCalledWith('q-1', {
        selectedOptions: [],
        freeText: 'Yes, tell them yes',
      }),
    );
  });

  it('keeps Send disabled until an answer is typed', () => {
    render(<ConsultationCard question={consultation()} onAnswer={vi.fn()} now={createdAtMs} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
