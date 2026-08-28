import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';

import IntentCycleInspector from '../IntentCycleInspector';
import type { IntentCycleSnapshot } from '@/services/conversation';
import type { DiscoveryProgress } from '@/services/intents';

const negotiation = (taskId: string, batchId: string): IntentCycleSnapshot['negotiations'][number] => ({
  taskId, conversationId: `conversation-${taskId}`, opportunityId: `opportunity-${taskId}`,
  opportunityStatus: 'negotiating', counterpartLabel: 'Counterpart', batchId,
  state: 'working', pause: null, latestActivity: null,
  updatedAt: '2026-08-24T12:00:00.000Z',
});

const cycle = (batchId: string | null): IntentCycleSnapshot => ({
  batch: { id: batchId, active: batchId === null ? 0 : 2, paused: 0 },
  negotiations: batchId === null ? [] : [negotiation('task-1', batchId), negotiation('task-2', batchId)],
});

const progress: DiscoveryProgress = {
  status: 'completed',
  attempt: 1,
  maxAttempts: 3,
  assignedCommunityCount: 2,
  processedCommunityCount: 2,
  possibleOverlapCount: 3,
  conversationsStartedCount: 2,
  queuedAt: '2026-08-24T11:58:00.000Z',
  startedAt: '2026-08-24T11:59:00.000Z',
  completedAt: '2026-08-24T12:00:00.000Z',
  updatedAt: '2026-08-24T12:00:00.000Z',
};

const networks = [
  { id: 'network-1', title: 'Builders' },
  { id: 'network-2', title: 'Climate Founders' },
];

describe('IntentCycleInspector discovery progress', () => {
  it.each([
    ['queued', 'queued'],
    ['running', 'scanning'],
  ] as const)('shows %s discovery before the first batch', (status, chip) => {
    render(
      <IntentCycleInspector
        intentId="intent-1"
        cycle={cycle(null)}
        loading={false}
        error={false}
        discoveryProgress={{
          ...progress,
          status,
          startedAt: status === 'queued' ? null : progress.startedAt,
          completedAt: null,
        }}
        networks={networks}
      />,
    );

    expect(screen.getByText('Waiting for kickoff')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-warmup-status')).toHaveTextContent(chip);
  });

  it('shows durable discovery progress while the intent waits for kickoff', () => {
    render(
      <IntentCycleInspector
        intentId="intent-1"
        cycle={cycle(null)}
        loading={false}
        error={false}
        discoveryProgress={progress}
        networks={networks}
      />,
    );

    expect(screen.getByText('Waiting for kickoff')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-warmup')).toBeInTheDocument();
    expect(screen.getAllByText(/2 matches handed to the PersonalAgent/)).toHaveLength(2);
  });

  it('removes discovery progress and preserves the existing cycle state after kickoff', () => {
    render(
      <MemoryRouter><IntentCycleInspector
        intentId="intent-1"
        cycle={cycle('batch-1')}
        loading={false}
        error={false}
        discoveryProgress={progress}
        networks={networks}
      /></MemoryRouter>,
    );

    expect(screen.queryByTestId('discovery-warmup')).toBeNull();
    expect(screen.getByText('Batch negotiating')).toBeInTheDocument();
    expect(screen.getByText('2 active · 0 paused')).toBeInTheDocument();
  });

  it('keeps a batch negotiating while a submitted task is active', () => {
    render(
      <MemoryRouter><IntentCycleInspector
        intentId="intent-1"
        cycle={{
          batch: { id: 'batch-1', active: 1, paused: 0 },
          negotiations: [{
            taskId: 'task-1', conversationId: 'conversation-1', opportunityId: 'opportunity-1',
            opportunityStatus: 'negotiating', counterpartLabel: 'Counterpart', batchId: 'batch-1',
            state: 'submitted', pause: null, latestActivity: null,
            updatedAt: '2026-08-24T12:00:00.000Z',
          }],
        }}
        loading={false}
        error={false}
      /></MemoryRouter>,
    );

    expect(screen.getByText('Batch negotiating')).toBeInTheDocument();
    expect(screen.queryByText('Batch ready to reflect')).toBeNull();
  });
});
