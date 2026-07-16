import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuestionsProvider, useQuestions } from '../QuestionsContext';

const mocks = vi.hoisted(() => ({
  getPending: vi.fn(async () => [{
    id: 'global-1',
    detection: { mode: 'intent', sourceType: 'intent', sourceId: 'i-1', timestamp: 'now' },
    actors: [{ userId: 'user-1', role: 'subject' }],
    payload: { title: 'Role', prompt: 'Which?', options: [], multiSelect: false },
    status: 'pending',
    answer: null,
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  }]),
  getPendingCounts: vi.fn(async () => ({
    globalPending: 1,
    pushedPoolPending: 2,
    personalAgentPending: 3,
  })),
  answer: vi.fn(async () => ({ success: true })),
  dismiss: vi.fn(async () => {}),
}));

vi.mock('@/contexts/APIContext', () => ({
  useQuestionsService: () => mocks,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: { id: 'user-1' } }),
}));

function Probe() {
  const questions = useQuestions();
  return (
    <div>
      <span data-testid="global">{questions.globalPending}</span>
      <span data-testid="pushed">{questions.pushedPoolPending}</span>
      <span data-testid="personal">{questions.personalAgentPending}</span>
      <span data-testid="legacy">{questions.count}</span>
      <button onClick={() => void questions.answer('global-1', { selectedOptions: ['A'] })}>answer</button>
      <button onClick={() => void questions.dismiss('global-1')}>dismiss</button>
    </div>
  );
}

describe('QuestionsContext proactive pool counts', () => {
  it('keeps global and Personal Agent counts separate', async () => {
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(screen.getByTestId('personal')).toHaveTextContent('3'));
    expect(screen.getByTestId('global')).toHaveTextContent('1');
    expect(screen.getByTestId('pushed')).toHaveTextContent('2');
    expect(screen.getByTestId('legacy')).toHaveTextContent('1');
    expect(mocks.getPending).toHaveBeenCalledWith({
      noConversation: true,
      excludeModes: ['pool_discovery'],
    });
  });

  it('refreshes canonical counts after answer and dismiss', async () => {
    mocks.getPendingCounts.mockClear();
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'answer' }));
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(2));
    expect(mocks.answer).toHaveBeenCalledWith('global-1', { selectedOptions: ['A'] });

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(3));
    expect(mocks.dismiss).toHaveBeenCalledWith('global-1');
  });
});
