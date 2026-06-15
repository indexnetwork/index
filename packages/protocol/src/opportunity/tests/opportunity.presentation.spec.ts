/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { presentOpportunity, truncateAtBoundary } from '../opportunity.presentation.js';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';

describe('presentOpportunity', () => {
  const baseOpp: Opportunity = {
    id: 'opp-1',
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { networkId: 'idx-1', userId: 'alice', role: 'agent' },
      { networkId: 'idx-1', userId: 'bob', role: 'patient' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'The source user (Alice) has deep React expertise while the candidate (Bob) is building a frontend-heavy product, making this a strong technical collaboration opportunity.',
      confidence: 0.85,
    },
    context: { networkId: 'idx-1' },
    confidence: '0.85',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  test('agent role: title and description for viewer as agent', () => {
    const result = presentOpportunity(
      baseOpp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('You can help Bob');
    expect(result.description).toContain('Bob might benefit from connecting with you');
    expect(result.callToAction).toBe('View Opportunity');
  });

  test('patient role: title and description for viewer as patient', () => {
    const result = presentOpportunity(
      baseOpp,
      'bob',
      { id: 'alice', name: 'Alice', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('Alice might be able to help you');
    expect(result.description).toContain("Alice has skills that align");
  });

  test('throws when viewer is not an actor', () => {
    expect(() =>
      presentOpportunity(
        baseOpp,
        'charlie',
        { id: 'alice', name: 'Alice', avatar: null },
        null,
        'card'
      )
    ).toThrow('Viewer is not an actor in this opportunity');
  });

  test('notification format truncates long description', () => {
    const longSummary = 'A'.repeat(150);
    const opp: Opportunity = {
      ...baseOpp,
      interpretation: { ...baseOpp.interpretation, reasoning: longSummary },
    };
    const result = presentOpportunity(
      opp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'notification'
    );
    expect(result.description.length).toBeLessThanOrEqual(100);
    if (result.description.length >= 100) {
      expect(result.description.slice(-3)).toBe('...');
    }
  });
});

describe('truncateAtBoundary', () => {
  test('returns text unchanged when within the limit', () => {
    const text = 'Short and sweet.';
    expect(truncateAtBoundary(text, 300)).toBe(text);
  });

  test('never cuts mid-word', () => {
    const text =
      "Eric is a computational neuroscientist with a background in engineering and explicitly develops systems for humans to better understand and interact with AI. His focus on individual cognition makes this a strong match.";
    const out = truncateAtBoundary(text, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    // The last token must be a complete word from the source, not a fragment.
    const lastWord = out.replace(/[\u2026.!?]+$/, '').trim().split(/\s+/).pop() ?? '';
    expect(text).toContain(lastWord);
  });

  test('prefers a sentence boundary when one is available', () => {
    const text =
      'You both work on developer tooling. They are hiring a founding engineer right now and could use your distributed-systems background.';
    const out = truncateAtBoundary(text, 60);
    expect(out).toBe('You both work on developer tooling.');
  });

  test('falls back to a word boundary with an ellipsis', () => {
    const text =
      'Acomplicatedrunonphrasewithoutanyearlysentencebreak that keeps going well past the limit and onward';
    const out = truncateAtBoundary(text, 40);
    expect(out.length).toBeLessThanOrEqual(41); // body + ellipsis char
    expect(out.endsWith('\u2026')).toBe(true);
  });
});
