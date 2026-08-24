import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn(async () => {});
const chatState = {
  messages: [] as Array<Record<string, unknown>>,
  isLoading: false,
  sendMessage,
  stopStream: vi.fn(),
  loadSession: vi.fn(async () => true),
  loadPreviousMessages: vi.fn(async () => {}),
  hasPreviousSession: false,
  isLoadingPreviousMessages: false,
  clearChat: vi.fn(),
  sessionId: 'session-1',
};

vi.mock('@/contexts/AIChatContext', () => ({ useAIChat: () => chatState }));
vi.mock('@/contexts/ConversationContext', () => ({
  useConversation: () => ({
    subscribeQuestionRegeneration: () => () => {},
    subscribePersonalAgentTurnCompleted: () => () => {},
  }),
}));
vi.mock('@/lib/api', () => ({
  apiClient: {
    post: vi.fn(async () => ({
      session: { id: 'session-1' },
      created: false,
      agent: { id: 'agent-1', name: 'Ada', description: null },
    })),
    patch: vi.fn(async () => ({})),
  },
}));
vi.mock('@/components/chat/AssistantMessageContent', () => ({
  default: ({ content }: { content: string }) => <p>{content}</p>,
}));

import IntentNegotiatorChat from '../IntentNegotiatorChat';

function agentMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-agent',
    role: 'assistant',
    content: 'What should I push hardest on?',
    timestamp: new Date('2026-08-21T10:00:00.000Z'),
    options: ['Hiring speed', 'Comp banding'],
    ...overrides,
  };
}

function renderChat() {
  return render(
    <IntentNegotiatorChat
      intentId="intent-1"
      timelineEntries={[]}
      timelineLoading={false}
      timelineError={false}
      opportunityStatusMap={{}}
      opportunityActionLoading={{}}
      onOpportunityAction={() => {}}
      onUnavailable={() => {}}
    />,
  );
}

/**
 * Option chips are canned replies: they render under an unanswered agent
 * question and, when tapped, go out through the ordinary send path — the same
 * one typing uses. Nothing about them is a separate answer channel.
 */
describe('IntentNegotiatorChat option chips', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    chatState.isLoading = false;
    chatState.messages = [agentMessage()];
  });

  it('sends the tapped chip as an ordinary user message', async () => {
    renderChat();
    const chip = await screen.findByRole('button', { name: 'Hiring speed' });
    await userEvent.click(chip);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Hiring speed'));
  });

  it('drops the chips once anything answers the question', async () => {
    chatState.messages = [
      agentMessage(),
      { id: 'msg-user', role: 'user', content: 'Hiring speed', timestamp: new Date('2026-08-21T10:01:00.000Z') },
    ];
    renderChat();
    await screen.findByText('Hiring speed');
    expect(screen.queryByRole('button', { name: 'Hiring speed' })).toBeNull();
  });

  it('renders nothing extra for a message that offered no chips', async () => {
    chatState.messages = [agentMessage({ options: undefined })];
    renderChat();
    await screen.findByText('What should I push hardest on?');
    expect(screen.queryByTestId('negotiator-chat-options')).toBeNull();
  });

  it('shows the owner-scoped PersonalAgent trace inside the DM', async () => {
    render(
      <IntentNegotiatorChat
        intentId="intent-1"
        timelineEntries={[{
          id: 'act-1',
          event: { kind: 'matches_ready' },
          act: { tool: 'message_user', text: 'I opened the conversation.' },
          createdAt: '2026-08-21T10:00:00.000Z',
        }]}
        timelineLoading={false}
        timelineError={false}
        opportunityStatusMap={{}}
        opportunityActionLoading={{}}
        onOpportunityAction={() => {}}
        onUnavailable={() => {}}
      />,
    );
    const trace = await screen.findByTestId('personal-agent-debug-trace');
    expect(trace).toHaveTextContent('PersonalAgent debug trace');
    expect(trace).toHaveTextContent('matches_ready');
    expect(trace).toHaveTextContent('message_user');
  });
});
