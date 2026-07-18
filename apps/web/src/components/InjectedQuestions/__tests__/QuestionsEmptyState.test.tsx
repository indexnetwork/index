/**
 * IND-439 visibility-audit slice — intent Questions panel empty state.
 *
 * The empty state must be a neutral informational message (no warning or
 * deprioritization cues) telling the user why no questions are shown.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { QuestionsEmptyState } from '../QuestionsEmptyState';

describe('QuestionsEmptyState', () => {
  it('renders the friendly informational copy', () => {
    render(<QuestionsEmptyState />);
    const state = screen.getByTestId('questions-empty-state');
    expect(state.textContent).toContain('No open questions right now');
    expect(state.textContent).toContain('your agent asks when new matches need a decision');
  });

  it('stays neutral — no red/amber warning styling', () => {
    render(<QuestionsEmptyState />);
    const state = screen.getByTestId('questions-empty-state');
    expect(state.className).not.toMatch(/red|amber|orange|yellow|warn/i);
    expect(state.className).toContain('text-gray-500');
  });

  it('accepts additional class names for surface-specific layout', () => {
    render(<QuestionsEmptyState className="mt-2" />);
    expect(screen.getByTestId('questions-empty-state').className).toContain('mt-2');
  });
});
