import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import IntentList from '../IntentList';

vi.mock('../DebugCopyButton', () => ({
  DebugCopyButton: () => <button type="button" aria-label="Copy debug JSON">Debug</button>,
}));

describe('IntentList pending questions', () => {
  it('shows API counts and orders active intents newest-first ahead of paused intents', () => {
    const { container } = render(
      <IntentList
        intents={[
          {
            id: 'paused-newest',
            payload: 'Paused newest',
            createdAt: '2026-07-19T12:00:00.000Z',
            status: 'PAUSED',
            pendingQuestionCount: 0,
          },
          {
            id: 'active-older',
            payload: 'Active older',
            createdAt: '2026-07-17T12:00:00.000Z',
            status: 'ACTIVE',
            pendingQuestionCount: 2,
          },
          {
            id: 'active-newer',
            payload: 'Active newer',
            createdAt: '2026-07-18T12:00:00.000Z',
            status: 'ACTIVE',
            pendingQuestionCount: 1,
          },
        ]}
      />,
    );

    expect(screen.getByTestId('intent-pending-question-badge-active-newer')).toHaveTextContent('1 to answer');
    expect(screen.getByTestId('intent-pending-question-badge-active-older')).toHaveTextContent('2 to answer');
    expect(screen.queryByTestId('intent-pending-question-badge-paused-newest')).not.toBeInTheDocument();
    expect(screen.getByTestId('intent-live-indicator-active-newer')).toHaveTextContent('live');
    expect(screen.getByTestId('intent-live-indicator-active-older')).toHaveTextContent('live');
    expect(screen.queryByTestId('intent-live-indicator-paused-newest')).not.toBeInTheDocument();
    expect([...container.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
      'Active newer',
      'Active older',
      'Paused newest',
    ]);
  });

  it('preserves source, archive, and row click actions', () => {
    const onIntentClick = vi.fn();
    const onOpenIntentSource = vi.fn();
    const onArchiveIntent = vi.fn();
    const intent = {
      id: 'intent-actions',
      payload: 'Intent with actions',
      createdAt: '2026-07-18T12:00:00.000Z',
      status: 'ACTIVE',
      pendingQuestionCount: 1,
      sourceType: 'link' as const,
      sourceValue: 'https://example.com/source',
    };

    render(
      <IntentList
        intents={[intent]}
        onIntentClick={onIntentClick}
        onOpenIntentSource={onOpenIntentSource}
        onArchiveIntent={onArchiveIntent}
      />,
    );

    fireEvent.click(screen.getByText('Intent with actions'));
    expect(onIntentClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Copy debug JSON' }));
    expect(onIntentClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Open Source'));
    expect(onIntentClick).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle('Archive'));
    expect(onIntentClick).toHaveBeenCalledTimes(1);

    expect(onIntentClick).toHaveBeenCalledWith(intent);
    expect(onOpenIntentSource).toHaveBeenCalledTimes(1);
    expect(onOpenIntentSource).toHaveBeenCalledWith(intent);
    expect(onArchiveIntent).toHaveBeenCalledTimes(1);
    expect(onArchiveIntent).toHaveBeenCalledWith(intent);

    const layout = screen.getByTestId('intent-card-layout-intent-actions');
    expect(layout).toHaveClass('flex-col', 'sm:pointer-fine:flex-row');

    const actions = screen.getByTestId('intent-actions-intent-actions');
    // Base/small/touch presentation is visible on its own row. Only larger
    // fine-pointer layouts may hide it, and hidden controls reject pointer taps.
    expect(actions).not.toHaveClass('opacity-0', 'pointer-events-none');
    expect(actions).toHaveClass(
      'sm:pointer-fine:opacity-0',
      'sm:pointer-fine:pointer-events-none',
      'sm:pointer-fine:group-hover:opacity-100',
      'sm:pointer-fine:group-hover:pointer-events-auto',
      'sm:pointer-fine:group-focus-within:opacity-100',
      'sm:pointer-fine:group-focus-within:pointer-events-auto',
    );
  });

  it('isolates remove clicks from the intent row action', () => {
    const onIntentClick = vi.fn();
    const onRemoveIntent = vi.fn();
    const intent = {
      id: 'intent-remove',
      payload: 'Removable intent',
      createdAt: '2026-07-18T12:00:00.000Z',
      status: 'ACTIVE',
    };

    render(
      <IntentList
        intents={[intent]}
        onIntentClick={onIntentClick}
        onRemoveIntent={onRemoveIntent}
      />,
    );

    fireEvent.click(screen.getByTitle('Remove'));

    expect(onRemoveIntent).toHaveBeenCalledOnce();
    expect(onRemoveIntent).toHaveBeenCalledWith(intent);
    expect(onIntentClick).not.toHaveBeenCalled();
  });
});
