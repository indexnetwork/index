import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuestionsProvider, useQuestions } from '../QuestionsContext';

function pending(id: string, userId = 'user-1') {
  return {
    id,
    detection: { mode: 'intent' as const, sourceType: 'intent', sourceId: 'i-1', timestamp: 'now' },
    actors: [{ userId, role: 'subject' as const }],
    payload: { title: 'Role', prompt: 'Which?', options: [], multiSelect: false },
    status: 'pending' as const,
    answer: null,
    expiresAt: null,
    createdAt: 'now',
    conversationId: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  getPending: vi.fn(),
  getPendingCounts: vi.fn(),
  answer: vi.fn(async () => ({ success: true })),
  dismiss: vi.fn(async () => {}),
}));

vi.mock('@/contexts/APIContext', () => ({
  useQuestionsService: () => mocks,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: mocks.user }),
}));

function Probe() {
  const questions = useQuestions();
  return (
    <div>
      <span data-testid="rows">{questions.questions.map((question) => question.id).join(',')}</span>
      <span data-testid="global">{questions.globalPending}</span>
      <span data-testid="pushed">{questions.pushedPoolPending}</span>
      <span data-testid="personal">{questions.personalAgentPending}</span>
      <span data-testid="legacy">{questions.count}</span>
      <span data-testid="revision">{questions.pendingRevision}</span>
      <button onClick={() => void questions.answer('global-1', { selectedOptions: ['A'] })}>answer</button>
      <button onClick={() => void questions.dismiss('global-1')}>dismiss</button>
      <button onClick={() => void questions.refresh()}>refresh</button>
    </div>
  );
}

beforeEach(() => {
  mocks.user = { id: 'user-1' };
  mocks.getPending.mockReset().mockResolvedValue([pending('global-1')]);
  mocks.getPendingCounts.mockReset().mockResolvedValue({
    globalPending: 1,
    pushedPoolPending: 2,
    personalAgentPending: 3,
  });
  mocks.answer.mockClear();
  mocks.dismiss.mockClear();
});

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

  it('changes the invalidation revision only when the authoritative pending id set changes', async () => {
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('global-1'));
    const initial = screen.getByTestId('revision').textContent;

    mocks.getPending.mockResolvedValueOnce([{ ...pending('global-1'), payload: { ...pending('global-1').payload, prompt: 'Changed copy' } }]);
    mocks.getPendingCounts.mockResolvedValueOnce({ globalPending: 9, pushedPoolPending: 0, personalAgentPending: 9 });
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('global')).toHaveTextContent('9'));
    expect(screen.getByTestId('revision').textContent).toBe(initial);

    mocks.getPending.mockResolvedValueOnce([pending('global-1'), pending('new-question')]);
    mocks.getPendingCounts.mockResolvedValueOnce({ globalPending: 2, pushedPoolPending: 0, personalAgentPending: 2 });
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('new-question'));
    expect(screen.getByTestId('revision').textContent).not.toBe(initial);
  });

  it('drops a lifecycle-stale negotiation id from the revision even when counts copy is unchanged', async () => {
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('global-1'));
    const initial = screen.getByTestId('revision').textContent;

    mocks.getPending.mockResolvedValueOnce([]);
    mocks.getPendingCounts.mockResolvedValueOnce({ globalPending: 1, pushedPoolPending: 2, personalAgentPending: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe(''));
    expect(screen.getByTestId('revision').textContent).not.toBe(initial);
  });

  it('refreshes canonical counts after answer and dismiss', async () => {
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'answer' }));
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(2));
    expect(mocks.answer).toHaveBeenCalledWith('global-1', { selectedOptions: ['A'] });

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }));
    await waitFor(() => expect(mocks.getPendingCounts).toHaveBeenCalledTimes(3));
    expect(mocks.dismiss).toHaveBeenCalledWith('global-1');
  });

  it('does not let user A responses overwrite reset or user B state', async () => {
    const aRows = deferred<ReturnType<typeof pending>[]>();
    const aCounts = deferred<{ globalPending: number; pushedPoolPending: number; personalAgentPending: number }>();
    mocks.getPending.mockReset()
      .mockImplementationOnce(() => aRows.promise)
      .mockResolvedValueOnce([pending('user-b-row', 'user-2')]);
    mocks.getPendingCounts.mockReset()
      .mockImplementationOnce(() => aCounts.promise)
      .mockResolvedValueOnce({ globalPending: 4, pushedPoolPending: 5, personalAgentPending: 9 });

    const view = render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(mocks.getPending).toHaveBeenCalledTimes(1));
    mocks.user = { id: 'user-2' };
    view.rerender(<QuestionsProvider><Probe /></QuestionsProvider>);

    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('user-b-row'));
    expect(screen.getByTestId('personal')).toHaveTextContent('9');

    aRows.resolve([pending('stale-user-a-row')]);
    aCounts.resolve({ globalPending: 7, pushedPoolPending: 7, personalAgentPending: 14 });
    await Promise.resolve();
    expect(screen.getByTestId('rows')).toHaveTextContent('user-b-row');
    expect(screen.getByTestId('rows')).not.toHaveTextContent('stale-user-a-row');
    expect(screen.getByTestId('personal')).toHaveTextContent('9');
  });

  it('keeps only the newest same-user refresh generation', async () => {
    render(<QuestionsProvider><Probe /></QuestionsProvider>);
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('global-1'));

    const oldRows = deferred<ReturnType<typeof pending>[]>();
    const oldCounts = deferred<{ globalPending: number; pushedPoolPending: number; personalAgentPending: number }>();
    mocks.getPending.mockImplementationOnce(() => oldRows.promise)
      .mockResolvedValueOnce([pending('newest-row')]);
    mocks.getPendingCounts.mockImplementationOnce(() => oldCounts.promise)
      .mockResolvedValueOnce({ globalPending: 2, pushedPoolPending: 1, personalAgentPending: 3 });

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(screen.getByTestId('rows')).toHaveTextContent('newest-row'));

    oldRows.resolve([pending('stale-row')]);
    oldCounts.resolve({ globalPending: 8, pushedPoolPending: 8, personalAgentPending: 16 });
    await Promise.resolve();
    expect(screen.getByTestId('rows')).toHaveTextContent('newest-row');
    expect(screen.getByTestId('rows')).not.toHaveTextContent('stale-row');
    expect(screen.getByTestId('personal')).toHaveTextContent('3');
  });
});
