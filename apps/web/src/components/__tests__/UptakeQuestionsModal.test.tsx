import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import UptakeQuestionsModal from '../UptakeQuestionsModal';
import type { UptakeAcceptanceAdvisory } from '@/services/opportunities';

const advisory: UptakeAcceptanceAdvisory = {
  code: 'unresolved_uptake_questions',
  advisoryOnly: true,
  opportunityId: 'opp-1',
  acknowledgedUptakeQuestionIds: [],
  questions: [{
    id: 'q-1',
    title: 'Capacity',
    prompt: 'Can they deliver the pilot?',
    options: [{ label: 'Yes', description: 'They have capacity.' }],
    multiSelect: false,
  }],
};

describe('UptakeQuestionsModal', () => {
  it('renders an accessible dialog and continues with the exact advisory IDs', async () => {
    const onContinue = vi.fn(async () => {});
    render(
      <UptakeQuestionsModal
        advisory={advisory}
        onAnswer={vi.fn(async () => {})}
        onDismiss={vi.fn(async () => {})}
        onContinue={onContinue}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: 'Questions before connecting' })).toBeInTheDocument();
    expect(screen.getByText('Can they deliver the pilot?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue anyway' }));
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(['q-1']));
  });

  it('submits a selected answer through the question service callback', async () => {
    const onAnswer = vi.fn(async () => {});
    render(
      <UptakeQuestionsModal
        advisory={advisory}
        onAnswer={onAnswer}
        onDismiss={vi.fn(async () => {})}
        onContinue={vi.fn(async () => {})}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith('q-1', { selectedOptions: ['Yes'] }));
  });

  it('cancels without accepting', () => {
    const onCancel = vi.fn();
    render(
      <UptakeQuestionsModal
        advisory={advisory}
        onAnswer={vi.fn(async () => {})}
        onDismiss={vi.fn(async () => {})}
        onContinue={vi.fn(async () => {})}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
