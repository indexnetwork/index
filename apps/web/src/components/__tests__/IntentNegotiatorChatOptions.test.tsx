import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn(async () => {});
let conversationMessageHandler: ((event: { conversationId: string; message: { role: string } }) => void) | undefined;
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
    subscribeConversationMessage: (handler: typeof conversationMessageHandler) => {
      conversationMessageHandler = handler;
      return () => { conversationMessageHandler = undefined; };
    },
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
      onLiveInvalidation={() => {}}
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
    conversationMessageHandler = undefined;
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
        timelineEntries={[
          { id: 'act-1', event: { kind: 'matches_ready' }, act: { tool: 'message_user', text: 'I opened the conversation.' }, createdAt: '2026-08-21T10:00:00.000Z' },
          { id: 'act-2', event: { kind: 'matches_ready' }, act: { tool: 'kickoff', round: 3, attempted: 4, opened: 2, failed: 2 }, createdAt: '2026-08-21T10:01:00.000Z' },
          { id: 'act-3', event: { kind: 'all_paused' }, act: { tool: 'promote', negotiationId: 'neg-1', opportunityId: 'opp-1', reasoning: 'Strong fit.', outcome: 'resolved' }, createdAt: '2026-08-21T10:02:00.000Z' },
          { id: 'act-4', event: { kind: 'all_paused' }, act: { tool: 'reject', negotiationId: 'neg-2', opportunityId: 'opp-2', reasoning: 'Timing does not work.', outcome: 'error' }, createdAt: '2026-08-21T10:03:00.000Z' },
          { id: 'act-5', event: { kind: 'user_message' }, act: { tool: 'note_dossier', text: 'Prefers remote work.', entryId: 'dossier-1' }, createdAt: '2026-08-21T10:04:00.000Z' },
          { id: 'act-6', event: { kind: 'user_message' }, act: { tool: 'retire_dossier', entryId: 'dossier-2', retired: false }, createdAt: '2026-08-21T10:05:00.000Z' },
          { id: 'act-7', event: { kind: 'user_message' }, act: { tool: 'accept_opportunity', opportunityId: 'opp-3', outcome: 'accepted', counterparty: 'Riley' }, createdAt: '2026-08-21T10:06:00.000Z' },
          { id: 'act-8', event: { kind: 'matches_ready' }, act: { tool: 'kickoff', round: 4, attempted: 1, opened: 1, failed: 0 }, createdAt: '2026-08-21T10:07:00.000Z' },
          { id: 'act-9', event: { kind: 'matches_ready' }, act: { tool: 'kickoff', round: 5, attempted: 3, opened: 0, failed: 3 }, createdAt: '2026-08-21T10:08:00.000Z' },
        ]}
        timelineLoading={false}
        timelineError={false}
        opportunityStatusMap={{}}
        opportunityActionLoading={{}}
        onOpportunityAction={() => {}}
      onUnavailable={() => {}}
        onLiveInvalidation={() => {}}
      />,
    );
    const trace = await screen.findByTestId('personal-agent-debug-trace');
    expect(trace).toHaveTextContent('PersonalAgent debug trace');
    expect(trace).toHaveTextContent('matches_ready → message_user · Delivered');
    expect(trace).toHaveTextContent('I opened the conversation.');
    expect(trace).toHaveTextContent('matches_ready → kickoff · Partial');
    expect(trace).toHaveTextContent('round 3 · 4 attempted · 2 opened · 2 failed');
    expect(trace).toHaveTextContent('matches_ready → kickoff · Completed');
    expect(trace).toHaveTextContent('matches_ready → kickoff · Failed');
    expect(trace).toHaveTextContent('all_paused → promote · Resolved');
    expect(trace).toHaveTextContent('negotiation neg-1 · opportunity opp-1 · Strong fit.');
    expect(trace).toHaveTextContent('all_paused → reject · Failed');
    expect(trace).toHaveTextContent('user_message → note_dossier · Saved');
    expect(trace).toHaveTextContent('user_message → retire_dossier · Not retired');
    expect(trace).toHaveTextContent('user_message → accept_opportunity · accepted');
    expect(trace).toHaveTextContent('opportunity opp-3 · Riley');
  });

  it('reconciles an agent SSE message for its session, but ignores another session', async () => {
    const onLiveInvalidation = vi.fn();
    render(
      <IntentNegotiatorChat
        intentId="intent-1"
        timelineEntries={[]}
        timelineLoading={false}
        timelineError={false}
        opportunityStatusMap={{}}
        opportunityActionLoading={{}}
        onOpportunityAction={() => {}}
        onUnavailable={() => {}}
        onLiveInvalidation={onLiveInvalidation}
      />,
    );
    await waitFor(() => expect(conversationMessageHandler).toBeTypeOf('function'));
    chatState.loadSession.mockClear();

    conversationMessageHandler?.({ conversationId: 'session-other', message: { role: 'agent' } });
    await Promise.resolve();
    expect(chatState.loadSession).not.toHaveBeenCalled();
    expect(onLiveInvalidation).not.toHaveBeenCalled();

    conversationMessageHandler?.({ conversationId: 'session-1', message: { role: 'agent' } });
    await waitFor(() => expect(chatState.loadSession).toHaveBeenCalledWith('session-1'));
    expect(onLiveInvalidation).toHaveBeenCalledTimes(1);
  });
});
