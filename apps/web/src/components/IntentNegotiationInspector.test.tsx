import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import IntentNegotiationInspector from './IntentNegotiationInspector';
import type { IntentCycleNegotiationDetail } from '@/services/conversation';

const now = new Date('2026-07-21T12:00:00.000Z');

function detail(reason: IntentCycleNegotiationDetail['task']['pause']['reason']): IntentCycleNegotiationDetail {
  return {
    intent: { id: 'intent-1', payload: 'Find a collaborator' },
    task: {
      id: 'task-1', conversationId: 'conversation-1', opportunityId: 'opportunity-1', batchId: 'batch-1',
      state: 'paused', updatedAt: new Date(now.getTime() - 10 * 60 * 60 * 1000).toISOString(), brief: null,
      pause: { reason, by: 'yours' },
    },
    transcript: [], outcome: null,
  };
}

describe('IntentNegotiationInspector', () => {
  afterEach(() => vi.useRealTimers());

  test('shows the remaining expiry time for an eligible paused negotiation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    render(<IntentNegotiationInspector detail={detail('needs_principal')} />);

    expect(screen.getByText('Expires in 2h 0m')).toBeInTheDocument();
  });

  test('omits expiry time for a non-expiring pause reason', () => {
    render(<IntentNegotiationInspector detail={detail('ready_for_verdict')} />);

    expect(screen.queryByText(/Expires in/)).not.toBeInTheDocument();
  });

  test('does not present an agent failure as counterparty silence', () => {
    render(<IntentNegotiationInspector detail={detail('open_failed')} />);

    expect(screen.getByText(/Paused · agent response failed · your agent/)).toBeInTheDocument();
  });
});
