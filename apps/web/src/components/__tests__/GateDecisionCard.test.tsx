import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import GateDecisionCard from '../negotiations/GateDecisionCard';
import { resolveGateDecision, type GateDecision } from '../negotiations/gate-decision';
import { contactTurns, type TranscriptTurn } from '../negotiations/negotiation-turns';

const screenDecision: GateDecision = {
  source: 'screen',
  decision: 'pass',
  reasoning: 'Alice is raising a seed round, not hiring — this is not the help you asked for.',
  counterpartyPremiseFit: 'Fundraising focus, no engineering need stated.',
  intentAlignment: 'No overlap with your open backend role.',
  screenedAt: '2026-07-24T11:00:00.000Z',
};

describe('resolveGateDecision (IND-610)', () => {
  const screenedOut = { turnCount: 0, outcomeReason: 'screened_out', screenDecision };

  it('shows the card on a zero-turn screened_out negotiation with reasoning', () => {
    expect(resolveGateDecision(screenedOut)).toBe(screenDecision);
  });

  it('shows nothing to a non-owner, who is never given a screenDecision', () => {
    expect(resolveGateDecision({ ...screenedOut, screenDecision: null })).toBeNull();
    expect(resolveGateDecision({ ...screenedOut, screenDecision: undefined })).toBeNull();
  });

  it('stays hidden when the negotiation actually happened', () => {
    // Turns exist: the rail tells the story, and a "did not reach out" card
    // would flatly contradict it.
    expect(resolveGateDecision({ ...screenedOut, turnCount: 2 })).toBeNull();
  });

  it('stays hidden for a shadow-mode pass that did not block the negotiation', () => {
    // decision === 'pass' but the outcome is not screened_out — outreach did
    // happen, so claiming otherwise would be a lie.
    expect(resolveGateDecision({ ...screenedOut, outcomeReason: null })).toBeNull();
    expect(resolveGateDecision({ ...screenedOut, outcomeReason: 'turn_cap' })).toBeNull();
  });

  it('falls back to the generic banner when there is no reasoning to show', () => {
    expect(resolveGateDecision({
      ...screenedOut,
      screenDecision: { ...screenDecision, reasoning: '   ' },
    })).toBeNull();
  });

  it('shows the card when the only turn is the client\'s own pre-contact pause', () => {
    // A needs_principal pause is private, not contact — the page computes
    // turnCount from contactTurns(), not the raw transcript length.
    const needsPrincipalOnly: TranscriptTurn[] = [{
      id: 't1', sessionId: 's1', senderId: 'agent:own', createdAt: '2026-07-24T12:00:00.000Z',
      verb: 'pause', pauseReason: 'needs_principal', pausePayload: { question: 'Does the location constraint bind?' },
      chipKey: 'needs_principal', text: 'Does the location constraint bind?', suggestedRoles: null,
    }];
    expect(resolveGateDecision({
      turnCount: contactTurns(needsPrincipalOnly).length,
      outcomeReason: 'screened_out',
      screenDecision,
    })).toBe(screenDecision);
  });
});

describe('GateDecisionCard (IND-610)', () => {
  it('shows the reasoning and both evidence lines for a screen-node pass', () => {
    render(<GateDecisionCard decision={screenDecision} counterpartName="Alice" />);

    const card = screen.getByTestId('gate-decision-card');
    expect(card).toHaveTextContent('Your agent did not reach out');
    expect(card).toHaveTextContent('Passed · before any contact');
    expect(card).toHaveTextContent('Alice is raising a seed round');
    expect(card).toHaveTextContent('what fit');
    expect(card).toHaveTextContent('Fundraising focus, no engineering need stated.');
    expect(card).toHaveTextContent('intent');
    expect(card).toHaveTextContent('No overlap with your open backend role.');
  });

  it('always states the one-sidedness, naming the counterparty', () => {
    render(<GateDecisionCard decision={screenDecision} counterpartName="Alice" />);
    expect(screen.getByTestId('gate-decision-card'))
      .toHaveTextContent('Alice was not contacted and cannot see this.');
  });

  it('renders without evidence rows for an opening-turn refusal, which has none', () => {
    // Work item 2 collapses a turn-0 withdraw into the same `screened_out`
    // outcome, but it never runs the screen node, so `evidence.*` is null.
    render(
      <GateDecisionCard
        decision={{
          source: 'outcome',
          decision: 'pass',
          reasoning: 'Not worth spending your name on this one.',
          counterpartyPremiseFit: null,
          intentAlignment: null,
          screenedAt: null,
        }}
        counterpartName="Alice"
      />,
    );

    const card = screen.getByTestId('gate-decision-card');
    expect(card).toHaveTextContent('Not worth spending your name on this one.');
    expect(card).toHaveTextContent('Alice was not contacted and cannot see this.');
    expect(card).not.toHaveTextContent('what fit');
    expect(card).not.toHaveTextContent('intent    ');
  });

  it('is not a message bubble — it is a labelled non-turn region', () => {
    const { container } = render(<GateDecisionCard decision={screenDecision} counterpartName="Alice" />);
    const card = screen.getByTestId('gate-decision-card');
    expect(card.tagName).toBe('SECTION');
    expect(card).toHaveAttribute('aria-label', "Your agent's outreach decision");
    // House style for this surface: no own/other alignment classes.
    expect(container.querySelector('.justify-end, .ml-auto, .self-end')).toBeNull();
  });
});
