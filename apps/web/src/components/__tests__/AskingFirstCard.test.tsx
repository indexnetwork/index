/**
 * The radar's "asking you first" card — the turn-0 third verdict on the surface
 * where the user watches their signal (#1445 follow-up).
 *
 * Three properties are load-bearing rather than cosmetic: the card says the
 * counterparty was never contacted (without it, a card naming someone reads as
 * though an approach were already underway), it links to the signal's DM
 * instead of answering in place (the DM is the only surface with the answer
 * plumbing), and it renders honestly when the park recorded no context.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import AskingFirstCard from '../negotiations/AskingFirstCard';
import { askingFirstReasonLabel, type AskingFirstState } from '../negotiations/asking-first';

const state: AskingFirstState = {
  intentId: 'intent-7',
  reason: 'unresolved_owner_constraint',
  whatFit: 'Consumer-AI founder with strong general AI depth.',
  askedAt: '2026-08-18T09:30:00.000Z',
};

function renderCard(overrides: Partial<AskingFirstState> = {}) {
  return render(
    <MemoryRouter>
      <AskingFirstCard state={{ ...state, ...overrides }} counterpartName="Ashley" />
    </MemoryRouter>,
  );
}

describe('askingFirstReasonLabel', () => {
  it('phrases the one category a pre-contact park can carry', () => {
    expect(askingFirstReasonLabel('unresolved_owner_constraint'))
      .toBe('how your own criteria bound this search');
  });

  it('says nothing for a category this state never carries', () => {
    // The mid-flight categories describe consults that happened after contact,
    // so inventing copy for them would describe a card that cannot render.
    expect(askingFirstReasonLabel('consequential_disclosure_permission')).toBeNull();
    expect(askingFirstReasonLabel('repeated_non_convergence')).toBeNull();
    expect(askingFirstReasonLabel(undefined)).toBeNull();
  });
});

describe('AskingFirstCard', () => {
  it('states what it is, mirroring the passed card', () => {
    renderCard();

    const card = screen.getByTestId('asking-first-card');
    expect(card).toHaveTextContent('Your agent wants to ask you first');
    expect(card).toHaveTextContent('Asking you · before any contact');
    expect(card).toHaveTextContent('what fit');
    expect(card).toHaveTextContent('Consumer-AI founder with strong general AI depth.');
    expect(card).toHaveTextContent('asking about');
    expect(card).toHaveTextContent('how your own criteria bound this search');
  });

  it('says the counterparty was not contacted, naming them', () => {
    renderCard();

    expect(screen.getByTestId('asking-first-card'))
      .toHaveTextContent('Ashley was not contacted and cannot see this.');
  });

  it('links to the signal’s DM, where the question is answered', () => {
    renderCard();

    const link = screen.getByRole('link', { name: "Answer in this signal's DM" });
    expect(link.getAttribute('href')).toBe('/i/intent-7');
  });

  it('offers no answer UI of its own', () => {
    // The DM is the answer surface: it holds the transcript, the settlement
    // coordinates, and the retirement rules. A second one would fork them.
    renderCard();

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('drops the evidence rows when the park recorded none', () => {
    renderCard({ reason: undefined, whatFit: undefined });

    const card = screen.getByTestId('asking-first-card');
    expect(card).toHaveTextContent('Your agent wants to ask you first');
    expect(card).toHaveTextContent('Ashley was not contacted and cannot see this.');
    expect(card).not.toHaveTextContent('what fit');
    expect(card).not.toHaveTextContent('asking about');
    expect(screen.getByRole('link', { name: "Answer in this signal's DM" })).toBeTruthy();
  });
});
