import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';

import OpportunityCard from '@/components/chat/OpportunityCardInChat';

describe('OpportunityCard pool adjustment treatment', () => {
  test('shows only the chosen side in a muted gray deprioritized chip', () => {
    render(
      <MemoryRouter>
        <OpportunityCard
          card={{
            opportunityId: 'opp-1',
            userId: 'user-2',
            name: 'Taylor',
            mainText: 'A promising connection.',
            primaryActionLabel: 'Connect',
            secondaryActionLabel: 'Skip',
            status: 'pending',
            deprioritizedReason: 'Builders vs advisors: you chose Builders',
          }}
        />
      </MemoryRouter>,
    );

    const chip = screen.getByText('Deprioritized — you chose Builders');
    expect(chip).toHaveClass('bg-gray-100', 'text-gray-500', 'border-gray-200');
    expect(chip).not.toHaveClass('text-red-500', 'text-amber-500');
    expect(screen.queryByText(/Builders vs advisors/)).not.toBeInTheDocument();
  });
});
