/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { presentOpportunity } from '../opportunity.presentation.js';
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
