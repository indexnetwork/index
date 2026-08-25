import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IntentCycleInspector from '../IntentCycleInspector';
import type { IntentCycleSnapshot } from '@/services/conversation';
import type { DiscoveryProgress } from '@/services/intents';

const cycle = (number: number): IntentCycleSnapshot => ({
  round: {
    number,
    size: number === 0 ? null : 2,
    kickoffStartedAt: number === 0 ? null : '2026-08-24T12:00:00.000Z',
    working: number === 0 ? 0 : 2,
    paused: 0,
  },
  negotiations: [],
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
  ] as const)('shows %s discovery during round zero', (status, chip) => {
    render(
      <IntentCycleInspector
        intentId="intent-1"
        cycle={cycle(0)}
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

  it('shows durable discovery progress while round zero waits for kickoff', () => {
    render(
      <IntentCycleInspector
        intentId="intent-1"
        cycle={cycle(0)}
        loading={false}
        error={false}
        discoveryProgress={progress}
        networks={networks}
      />,
    );

    expect(screen.getByText('Waiting for kickoff')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-warmup')).toBeInTheDocument();
    expect(screen.getAllByText(/2 matches handed to the PersonalAgent/)).toHaveLength(2);
    expect(screen.queryByText('No negotiation round has been started.')).toBeNull();
  });

  it('removes discovery progress and preserves the existing cycle state after kickoff', () => {
    render(
      <IntentCycleInspector
        intentId="intent-1"
        cycle={cycle(1)}
        loading={false}
        error={false}
        discoveryProgress={progress}
        networks={networks}
      />,
    );

    expect(screen.queryByTestId('discovery-warmup')).toBeNull();
    expect(screen.getByText('Round 1 negotiating')).toBeInTheDocument();
    expect(screen.getByText('2 active · 0 paused')).toBeInTheDocument();
  });
});
