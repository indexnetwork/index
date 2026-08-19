/**
 * The resolved-state banner's stalled copy, which used to make one claim for
 * four different ends: "The dialogue hit its 6-turn budget without agreement."
 *
 * That line was displayed over a transcript holding a single message, for a
 * negotiation whose responder had failed once — the turn budget was never
 * touched. What the banner says about how a negotiation ended is the only
 * account the owner gets, so each end says its own thing now, and the one
 * caused by our own failures says so.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ResolvedBanner from '../negotiations/ResolvedBanner';

describe('ResolvedBanner — stalled variants', () => {
  it('claims a spent turn budget only for turn_cap', () => {
    render(<ResolvedBanner variant="stalled" reason="turn_cap" turnCount={6} maxTurns={6} />);
    expect(screen.getByText('Stalled — agents ran out of turns')).toBeInTheDocument();
    expect(screen.getByText(/6-turn budget/)).toBeInTheDocument();
  });

  it('names an agent error for what it is, and never as an exhausted budget', () => {
    render(<ResolvedBanner variant="stalled" reason="agent_error" turnCount={1} maxTurns={6} />);
    expect(screen.getByText('Stalled — the agents hit an error')).toBeInTheDocument();
    expect(screen.queryByText(/turn budget/)).toBeNull();
    expect(screen.queryByText(/ran out of turns/)).toBeNull();
    // The owner is told whose fault it was, and not offered an answer prompt
    // for a question nobody asked.
    expect(screen.getByText(/fault on our side/)).toBeInTheDocument();
    expect(screen.queryByText(/Answering routes through your agent/)).toBeNull();
  });

  it('falls back to an honest generic line when no reason was recorded', () => {
    render(<ResolvedBanner variant="stalled" reason={null} turnCount={2} maxTurns={6} />);
    expect(screen.getByText('Stalled — the dialogue didn’t conclude')).toBeInTheDocument();
    expect(screen.queryByText(/turn budget/)).toBeNull();
  });

  it('keeps the timeout wording', () => {
    render(<ResolvedBanner variant="stalled" reason="timeout" turnCount={3} maxTurns={6} />);
    expect(screen.getByText('Stalled — the dialogue timed out')).toBeInTheDocument();
  });
});
