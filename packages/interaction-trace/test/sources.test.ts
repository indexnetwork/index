import { describe, expect, test } from 'bun:test';
import { deriveHumanOutcome, deriveOutcomeClass, quoteInText, scrubNames } from '../src/sources.ts';

describe('quoteInText', () => {
  test('matches across whitespace, case and typographic quotes', () => {
    expect(quoteInText("A  keeps\nit private", "a keeps it private, mostly")).toBe(true);
    expect(quoteInText('it\u2019s fine', "It's fine here")).toBe(true);
  });

  test('rejects missing text and very short quotes', () => {
    expect(quoteInText('invented wording', 'something else entirely')).toBe(false);
    expect(quoteInText('the', 'the quick fox')).toBe(false);
  });
});

describe('scrubNames', () => {
  test('replaces whole-word names per seat and leaves short tokens alone', () => {
    const names = { A: ['Frank Castle'], B: ['Dekan Brown', 'Al'] };
    const out = scrubNames('Dekan Brown asked Frank about Dekanter and Al said hi', names);
    expect(out).toBe('[B] asked [A] about Dekanter and Al said hi');
  });
});

describe('deriveHumanOutcome', () => {
  test('agent declined or open means humans were not reached', () => {
    expect(deriveHumanOutcome({ agentVerdict: 'declined', opportunityStatus: 'rejected', committedCount: 0 })).toBe('not_reached');
    expect(deriveHumanOutcome({ agentVerdict: 'closed', opportunityStatus: 'expired', committedCount: 0 })).toBe('not_reached');
    expect(deriveHumanOutcome({ agentVerdict: 'open', opportunityStatus: 'negotiating', committedCount: 0 })).toBe('not_reached');
  });

  test('agreed negotiations resolve from commits and status', () => {
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'accepted', committedCount: 2 })).toBe('both_committed');
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'rejected', committedCount: 1 })).toBe('declined');
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'rejected', committedCount: 0 })).toBe('declined');
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'pending', committedCount: 1 })).toBe('one_committed');
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'expired', committedCount: 0 })).toBe('expired');
    expect(deriveHumanOutcome({ agentVerdict: 'agreed', opportunityStatus: 'pending', committedCount: 0 })).toBe('open');
  });
});

describe('deriveOutcomeClass', () => {
  test('classes follow agent verdict and human outcome', () => {
    expect(deriveOutcomeClass('agreed', 'both_committed', false)).toBe('confirmed_fit');
    expect(deriveOutcomeClass('agreed', 'declined', false)).toBe('assessment_failure');
    expect(deriveOutcomeClass('agreed', 'expired', false)).toBe('assessment_failure');
    expect(deriveOutcomeClass('agreed', 'open', false)).toBe('unresolved');
    expect(deriveOutcomeClass('declined', 'not_reached', false)).toBe('unresolved');
    expect(deriveOutcomeClass('declined', 'not_reached', true)).toBe('missed_opportunity');
    expect(deriveOutcomeClass('agreed', 'both_committed', true)).toBe('confirmed_fit');
  });
});
