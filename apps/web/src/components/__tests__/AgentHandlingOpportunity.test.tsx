import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ComponentProps } from 'react';
import { describe, expect, test } from 'vitest';

import AgentHandlingOpportunity from '../AgentHandlingOpportunity';

const item = {
  opportunityId: 'opp-1', userId: 'maya', name: 'Maya Chen', avatar: null,
  status: 'negotiating' as const, mainText: '', cta: '', primaryActionLabel: '', secondaryActionLabel: '', mutualIntentsLabel: '',
};

function renderRow(props: Partial<ComponentProps<typeof AgentHandlingOpportunity>> = {}) {
  return render(<MemoryRouter><AgentHandlingOpportunity item={item} negotiation={undefined} {...props} /></MemoryRouter>);
}

describe('AgentHandlingOpportunity', () => {
  test('uses simple progress rather than presenter text before a turn', () => {
    renderRow();
    expect(screen.getByText('Preparing negotiation.')).toBeInTheDocument();
    expect(screen.getByText('Personal Agent')).toBeInTheDocument();
  });

  test('labels the latest shared turn from my agent', () => {
    renderRow({ negotiation: {
      taskId: 'task-1', conversationId: 'conversation-1', opportunityId: 'opp-1', opportunityStatus: 'negotiating', counterpartLabel: 'Maya Chen', round: 1,
      state: 'working', pause: null, latestActivity: { actor: 'yours', verb: 'question', text: 'What is the equity range?', createdAt: '2026-08-25T00:00:00.000Z' }, updatedAt: '2026-08-25T00:00:00.000Z',
    } });
    expect(screen.getByText('My Agent')).toBeInTheDocument();
    expect(screen.getByText('What is the equity range?')).toBeInTheDocument();
  });

  test('explains exactly what the waiting state depends on', () => {
    renderRow({ waiting: true, negotiation: {
      taskId: 'task-1', conversationId: 'conversation-1', opportunityId: 'opp-1', opportunityStatus: 'negotiating', counterpartLabel: 'Maya Chen', round: 1,
      state: 'paused', pause: { reason: 'needs_principal', by: 'theirs' }, latestActivity: { actor: 'theirs', verb: 'pause', text: null, createdAt: '2026-08-25T00:00:00.000Z' }, updatedAt: '2026-08-25T00:00:00.000Z',
    } });
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Waiting for their principal’s guidance.')).toBeInTheDocument();
  });

  test('does not expose a pause payload as a message', () => {
    renderRow({ negotiation: {
      taskId: 'task-1', conversationId: 'conversation-1', opportunityId: 'opp-1', opportunityStatus: 'negotiating', counterpartLabel: 'Maya Chen', round: 1,
      state: 'paused', pause: { reason: 'needs_principal', by: 'yours' }, latestActivity: { actor: 'yours', verb: 'pause', text: null, createdAt: '2026-08-25T00:00:00.000Z' }, updatedAt: '2026-08-25T00:00:00.000Z',
    } });
    expect(screen.getByText('Paused this negotiation.')).toBeInTheDocument();
  });
});
