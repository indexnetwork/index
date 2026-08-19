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

describe('ResolvedBanner — screened_out and what the thread can prove', () => {
  // The pre-contact copy was observed rendering directly beneath a two-hour-old
  // outreach: an error-stalled negotiation was re-screened on recovery, passed,
  // and flipped to `rejected`. The screen fix stops new rows from reaching that
  // state; the rows already in that state are still rendered by this component,
  // so the copy may not assert a history the thread contradicts.
  it('keeps the pre-contact copy when nothing was ever sent', () => {
    render(<ResolvedBanner variant="rejected" reason="screened_out" turnCount={null} maxTurns={6} contactMade={false} />);
    expect(screen.getByText('No opportunity — filtered out for you')).toBeInTheDocument();
    expect(screen.getByText(/filtered out before either side reached out/)).toBeInTheDocument();
    expect(screen.getByText(/never learns the details/)).toBeInTheDocument();
  });

  it('defaults to the pre-contact copy when the caller supplies no thread context', () => {
    render(<ResolvedBanner variant="rejected" reason="screened_out" turnCount={null} maxTurns={6} />);
    expect(screen.getByText(/filtered out before either side reached out/)).toBeInTheDocument();
  });

  it('drops every pre-contact claim when the thread holds messages', () => {
    render(<ResolvedBanner variant="rejected" reason="screened_out" turnCount={1} maxTurns={6} contactMade />);
    // Nothing is claimed about who reached out, who was notified, or what the
    // counterparty knows — only that it ended without agreement.
    expect(screen.getByText('This negotiation ended without agreement.')).toBeInTheDocument();
    expect(screen.queryByText(/before either side reached out/)).toBeNull();
    expect(screen.queryByText(/neither of you was notified/)).toBeNull();
    expect(screen.queryByText(/never learns the details/)).toBeNull();
    expect(screen.queryByText(/filtered out for you/)).toBeNull();
  });

  it('leaves the other rejected reasons untouched by the guard', () => {
    render(<ResolvedBanner variant="rejected" reason={null} turnCount={2} maxTurns={6} contactMade />);
    expect(screen.getByText(/Your agent withdrew after reviewing the opportunity/)).toBeInTheDocument();
    expect(screen.getByText(/never learns the details/)).toBeInTheDocument();
  });
});

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
