import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import NegotiationTaskIndex from '../NegotiationTaskIndex';
import type { NegotiationTaskIndexEntry } from '@/services/conversation';

function entry(input: Partial<NegotiationTaskIndexEntry> & { id: string }): NegotiationTaskIndexEntry {
  return {
    intentId: `${input.id}-intent`,
    intentLabel: input.intentLabel ?? 'Find a collaborator',
    taskId: `${input.id}-task`,
    conversationId: `${input.id}-conversation`,
    opportunityId: `${input.id}-opportunity`,
    opportunityStatus: input.opportunityStatus ?? 'negotiating',
    counterpartLabel: input.counterpartLabel ?? 'Mira Chen',
    round: input.round ?? 1,
    state: input.state ?? 'working',
    pause: input.pause ?? null,
    latestActivity: input.latestActivity ?? { actor: 'theirs', verb: 'counter', createdAt: '2026-07-24T11:00:00.000Z' },
    updatedAt: input.updatedAt ?? '2026-07-24T11:00:00.000Z',
  };
}

describe('NegotiationTaskIndex', () => {
  it('shows posture groups and human labels instead of task ids', () => {
    render(
      <MemoryRouter>
        <NegotiationTaskIndex
          loading={false}
          error={false}
          entries={[
            entry({
              id: 'guidance',
              counterpartLabel: 'Yankı Ekin Yüksel',
              intentLabel: 'Sell a Robinson R22 helicopter',
              state: 'paused',
              pause: { reason: 'needs_principal', by: 'yours' },
              latestActivity: { actor: 'yours', verb: 'pause', createdAt: '2026-07-24T11:00:00.000Z' },
            }),
            entry({
              id: 'rejected',
              counterpartLabel: 'Yankı Ekin Yüksel',
              intentLabel: 'Find a technical co-founder',
              state: 'completed',
              opportunityStatus: 'rejected',
              pause: { reason: 'ready_for_verdict', by: 'theirs' },
              latestActivity: { actor: 'theirs', verb: 'pause', createdAt: '2026-07-24T10:00:00.000Z' },
            }),
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Negotiations' })).toBeInTheDocument();
    expect(screen.getByText('1 your move · 0 in progress · 1 resolved')).toBeInTheDocument();
    expect(screen.getByText('Your move · 1')).toBeInTheDocument();
    expect(screen.getByText('Resolved · 1')).toBeInTheDocument();
    expect(screen.getByText('Needs your input')).toBeInTheDocument();
    expect(screen.getByText('No match')).toBeInTheDocument();
    expect(screen.getByText(/your agent asked for guidance/)).toBeInTheDocument();
    expect(screen.queryByText(/Inspect seat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/task completed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ready for verdict/)).not.toBeInTheDocument();
    expect(screen.queryByText(/guidance-task/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open negotiation with Yankı Ekin Yüksel about Sell a Robinson R22 helicopter' })).toHaveAttribute(
      'href',
      '/i/guidance-intent/negotiations/guidance-task',
    );
  });

  it('shows an empty state when there are no seats', () => {
    render(
      <MemoryRouter>
        <NegotiationTaskIndex entries={[]} loading={false} error={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No negotiations yet')).toBeInTheDocument();
  });
});
