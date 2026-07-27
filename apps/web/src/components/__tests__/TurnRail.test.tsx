import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import TurnRail from '../negotiations/TurnRail';
import type { TranscriptTurn } from '../negotiations/negotiation-turns';

vi.mock('@/components/UserAvatar', () => ({
  default: () => <div data-testid="avatar" />,
}));

const NOW = new Date('2026-07-24T12:00:00.000Z').getTime();

function turn(id: string, action: string | null, text: string, senderId = 'agent:me'): TranscriptTurn {
  return {
    id,
    sessionId: 'session-1',
    senderId,
    createdAt: '2026-07-24T11:00:00.000Z',
    action,
    text,
    suggestedRoles: null,
  };
}

const turns = [
  turn('t-ask', 'ask_user', 'Their agent asked about your availability. What should I say?'),
  turn('t-next', 'counter', 'We can offer an async collaboration.', 'agent:peer'),
];

const participantInfo = new Map([
  ['agent:me', { ownerName: 'Viewer', avatar: null }],
  ['agent:peer', { ownerName: 'Mira Chen', avatar: null }],
]);

function renderRail(missedWindowTurnId?: string | null) {
  return render(
    <TurnRail
      turns={turns}
      ownAgentId="agent:me"
      participantInfo={participantInfo}
      counterpartName="Mira Chen"
      now={NOW}
      missedWindowTurnId={missedWindowTurnId}
    />,
  );
}

describe('TurnRail missed-window decay (IND-559)', () => {
  it('renders no decay line by default', () => {
    renderRail();
    expect(screen.queryByTestId('consultation-window-missed')).not.toBeInTheDocument();
  });

  it('renders the quiet decay line right after the ask_user turn', () => {
    renderRail('t-ask');
    const line = screen.getByTestId('consultation-window-missed');
    expect(line).toHaveTextContent('Window missed — negotiation continued without an answer.');

    // Anchored after the consultation turn, before the negotiation continues.
    const askText = screen.getByText(/Their agent asked about your availability/);
    const nextText = screen.getByText(/We can offer an async collaboration/);
    expect(askText.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(nextText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
