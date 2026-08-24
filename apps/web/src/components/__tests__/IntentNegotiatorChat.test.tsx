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
    ...overrides,
  };
}

const decisionQuestions = [
  {
    title: 'Sofia',
    prompt: 'Does your design-partner experience include a scalable SaaS transition?',
    options: [
      { label: 'Yes, directly', description: 'I led that transition.' },
      { label: 'Not yet', description: 'My experience is still services-led.' },
    ],
    multiSelect: false,
  },
  {
    title: 'Aisha',
    prompt: 'What product domain are you building in?',
    options: [
      { label: 'AI', description: 'AI product or infrastructure.' },
      { label: 'Dev tools', description: 'Developer tooling.' },
    ],
    multiSelect: false,
  },
];

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

describe('IntentNegotiatorChat', () => {
  beforeEach(() => {
    sendMessage.mockClear();
    chatState.isLoading = false;
    chatState.messages = [agentMessage()];
    conversationMessageHandler = undefined;
  });

  it('renders numbered decision choices and submits flattened answers through chat', async () => {
    chatState.messages = [agentMessage({ decisionQuestions })];
    renderChat();
    await userEvent.click(await screen.findByRole('radio', { name: /Yes, directly/i }));
    await userEvent.click(screen.getByRole('radio', { name: /AI/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(
      'Sofia (Does your design-partner experience include a scalable SaaS transition?): Yes, directly\n' +
      'Aisha (What product domain are you building in?): AI',
    ));
    expect(screen.getByText('Submitted.')).toBeInTheDocument();
  });

  it('disables a historical question form once a later message exists', async () => {
    chatState.messages = [
      agentMessage({ decisionQuestions }),
      {
        id: 'msg-user',
        role: 'user',
        content: 'I have already answered these.',
        timestamp: new Date('2026-08-21T10:01:00.000Z'),
      },
    ];
    renderChat();

    expect(await screen.findByText('Submitted.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Yes, directly/i })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('shows the latest agent activity until response text arrives', async () => {
    chatState.messages = [agentMessage({ content: '', isStreaming: true, agentActivityLabel: 'Reviewing your signal' })];
    const view = renderChat();
    expect(await screen.findByRole('status')).toHaveTextContent('Reviewing your signal');

    chatState.messages = [agentMessage({ content: '', isStreaming: true, agentActivityLabel: 'Checking Sofia and Aisha' })];
    view.rerender(
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
    expect(screen.getByRole('status')).toHaveTextContent('Checking Sofia and Aisha');

    chatState.messages = [agentMessage({ content: 'Here is what I found.', isStreaming: true })];
    view.rerender(
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
    expect(screen.queryByTestId('negotiator-agent-activity')).toBeNull();
    expect(screen.getByText('Here is what I found.')).toBeInTheDocument();
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
