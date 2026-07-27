import { useEffect } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NegotiationsInbox from '../NegotiationsInbox';
import type { ConversationSummary } from '@/services/conversation';

const viewer = { id: 'me', name: 'Viewer' };

function negotiation(
  id: string,
  counterpartName: string,
  input: {
    state?: NonNullable<ConversationSummary['negotiation']>['state'];
    action?: string;
    senderId?: string;
    turnCount?: number;
  } = {},
): ConversationSummary {
  return {
    id,
    participants: [
      { participantId: 'agent:me', participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: 'Viewer' },
      { participantId: `agent:${id}-peer`, participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: counterpartName },
    ],
    lastMessage: {
      parts: [{ kind: 'data', data: { action: input.action ?? 'counter' } }],
      senderId: input.senderId ?? `agent:${id}-peer`,
      createdAt: '2026-07-24T11:00:00.000Z',
    },
    metadata: null,
    via: [],
    unreadCount: 0,
    lastMessageAt: '2026-07-24T11:00:00.000Z',
    createdAt: '2026-07-24T10:00:00.000Z',
    negotiation: {
      taskId: `${id}-task`,
      state: input.state ?? 'working',
      statusTimestamp: '2026-07-24T11:00:00.000Z',
      opportunityId: `${id}-opportunity`,
      opportunityStatus: 'negotiating',
      acceptedByViewer: false,
      turnCount: input.turnCount ?? 1,
      maxTurns: 6,
      signalCount: 2,
      outcome: null,
      updatedAt: '2026-07-24T11:00:00.000Z',
    },
  };
}

const answerNegotiation = negotiation('question', 'Mira Chen', {
  state: 'input_required',
  action: 'ask_user',
  senderId: 'agent:me',
});

const mocks = vi.hoisted(() => ({
  negotiations: [] as ConversationSummary[],
  features: { negotiatorChat: true } as { negotiatorChat?: boolean } | undefined,
  apiGet: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuthContext: () => ({ user: viewer, features: mocks.features }),
}));

vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    negotiations: mocks.negotiations,
    isConnected: true,
    refreshNegotiations: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiClient: { get: mocks.apiGet, post: vi.fn() },
}));

const currentPath = { value: '/' };

function LocationProbe() {
  const { pathname } = useLocation();
  useEffect(() => {
    currentPath.value = pathname;
  }, [pathname]);
  return null;
}

function renderInbox() {
  return render(
    <MemoryRouter initialEntries={['/negotiations']}>
      <LocationProbe />
      <NegotiationsInbox />
    </MemoryRouter>,
  );
}

describe('NegotiationsInbox answer-row deep links (IND-558)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentPath.value = '/negotiations';
    mocks.features = { negotiatorChat: true };
    mocks.apiGet.mockResolvedValue({ sessions: [{ id: 'negotiator-session' }] });
  });

  it('routes answer rows to the negotiator DM when the session exists', async () => {
    mocks.negotiations = [answerNegotiation];
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Open negotiation with Mira Chen' }));
    await waitFor(() => expect(currentPath.value).toBe('/d/negotiator-session'));
    expect(mocks.apiGet).toHaveBeenCalledWith('/chat/sessions?persona=negotiator');
  });

  it('falls back to /questions when no negotiator session exists', async () => {
    mocks.negotiations = [answerNegotiation];
    mocks.apiGet.mockResolvedValue({ sessions: [] });
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Open negotiation with Mira Chen' }));
    await waitFor(() => expect(currentPath.value).toBe('/questions'));
  });

  it('falls back to /questions when the negotiator chat flag is off', async () => {
    mocks.negotiations = [answerNegotiation];
    mocks.features = { negotiatorChat: false };
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Open negotiation with Mira Chen' }));
    await waitFor(() => expect(currentPath.value).toBe('/questions'));
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });

  it('routes live rows to the transcript', async () => {
    mocks.negotiations = [negotiation('live', 'Aisha Khan', { turnCount: 3 })];
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: 'Open negotiation with Aisha Khan' }));
    await waitFor(() => expect(currentPath.value).toBe('/chat/live'));
  });
});
