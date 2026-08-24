import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IntentList from '../IntentList';

const baseIntent = {
  id: 'intent-1',
  payload: 'Find a hiring partner in Berlin',
  createdAt: '2026-08-20T10:00:00.000Z',
};

/**
 * The per-signal your-move badge. It reads one derived server flag and says
 * nothing on its own: no flag, no badge, and no zero state.
 */
describe('IntentList your-move badge', () => {
  it('marks a signal whose agent is holding a question', () => {
    render(<IntentList intents={[{ ...baseIntent, awaitingReply: true }]} />);
    expect(screen.getByText('your move')).toBeTruthy();
  });

  it('says nothing when the agent is not waiting on the owner', () => {
    render(<IntentList intents={[baseIntent, { ...baseIntent, id: 'intent-2', awaitingReply: false }]} />);
    expect(screen.queryByText('your move')).toBeNull();
  });
});
