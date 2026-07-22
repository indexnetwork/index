import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { NotificationProvider, useNotifications } from '@/contexts/NotificationContext';

function NotificationHarness({ onUndo }: { onUndo: () => Promise<void> }) {
  const { addNotification } = useNotifications();
  return (
    <button
      type="button"
      onClick={() => addNotification({
        type: 'intent_broadcast',
        title: 'Broadcasting Signal',
        message: 'Find protocol collaborators',
        duration: 60_000,
        onAction: onUndo,
      })}
    >
      Create notification
    </button>
  );
}

describe('NotificationContext async actions', () => {
  test('failed undo remains retryable with explicit feedback, then dismisses only after success', async () => {
    const onUndo = vi.fn()
      .mockRejectedValueOnce(new Error('archive unavailable'))
      .mockResolvedValueOnce(undefined);

    render(
      <NotificationProvider>
        <NotificationHarness onUndo={onUndo} />
      </NotificationProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create notification' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Undo failed: archive unavailable');
    expect(screen.getByRole('button', { name: 'Undo' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.queryByText('Find protocol collaborators')).toBeNull());
    expect(onUndo).toHaveBeenCalledTimes(2);
  });
});
