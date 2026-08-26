import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';

import OpportunityCard from '@/components/chat/OpportunityCardInChat';

describe('OpportunityCard presenter subtitle', () => {
  test('normalizes the internal domain term in the presenter subtitle', () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          card={{
            opportunityId: 'opp-terminology',
            userId: 'user-2',
            name: 'Taylor',
            mainText: 'A promising connection.',
            primaryActionLabel: 'Connect',
            secondaryActionLabel: 'Skip',
            mutualIntentsLabel: '2 mutual intents',
            status: 'pending',
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('2 mutual signals')).toBeInTheDocument();
    expect(screen.queryByText('2 mutual intents')).not.toBeInTheDocument();
  });
});
