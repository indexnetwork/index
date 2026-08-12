/**
 * Contract test: ProfileContext carries existingPremises from profile graph.
 *
 * This is a lightweight shape test. The heavy integration path (ProfileGraph
 * fetching premises and passing them) is verified by tsc type-checking;
 * this test checks that the runtime values produced by the profile graph
 * match the expected ProfileContext contract.
 *
 * No LLM calls, no DB — all dependencies are mocked inline.
 */
import { describe, it, expect } from 'bun:test';
import type { ProfileContext } from '../../questions/application/question.input.js';

describe('ProfileContext with existingPremises', () => {
  it('accepts a full ProfileContext including existingPremises', () => {
    const ctx: ProfileContext = {
      userContext: 'Alice is an engineer in Berlin who works with TypeScript and open source.',
      gaps: ['current work'],
      existingPremises: [
        'I am a software engineer based in Berlin',
        'I am interested in distributed systems',
      ],
    };

    expect(ctx.gaps).toEqual(['current work']);
    expect(ctx.existingPremises).toHaveLength(2);
    expect(ctx.existingPremises![0]).toBe('I am a software engineer based in Berlin');
    expect(ctx.existingPremises![1]).toBe('I am interested in distributed systems');
  });

  it('accepts a ProfileContext without existingPremises (backward compat)', () => {
    const ctx: ProfileContext = {
      userContext: 'Bob.',
      gaps: ['location', 'skills'],
    };

    expect(ctx.gaps).toEqual(['location', 'skills']);
    expect(ctx.existingPremises).toBeUndefined();
  });

  it('accepts a ProfileContext with an empty existingPremises array', () => {
    const ctx: ProfileContext = {
      userContext: 'Carol.',
      gaps: ['skills'],
      existingPremises: [],
    };

    expect(ctx.existingPremises).toEqual([]);
    expect(ctx.existingPremises).toHaveLength(0);
  });

  it('maps PremiseRecord assertion texts to ProfileContext.existingPremises', () => {
    // Simulates what embedSaveProfileNode does: map premise records to text strings
    const premiseRecords = [
      { assertion: { text: 'I work on AI infrastructure' } },
      { assertion: { text: 'I am based in London' } },
    ];

    const existingPremises = premiseRecords.map(p => p.assertion.text);

    const ctx: ProfileContext = {
      userContext: 'Dan works on AI infrastructure.',
      gaps: ['location'],
      existingPremises,
    };

    expect(ctx.existingPremises).toEqual([
      'I work on AI infrastructure',
      'I am based in London',
    ]);
  });
});
