import { describe, expect, it } from 'bun:test';
import type { CreateOpportunityData } from '@indexnetwork/protocol';

import { buildPoolCandidateContexts } from '../context.shared';
import type { PoolCandidateContextDeps } from '../context.shared';

const owner = 'owner-1';

function opportunity(counterpart: string, reasoning: string): CreateOpportunityData {
  return {
    detection: { source: 'opportunity_graph', timestamp: '2026-07-16T10:00:00.000Z' },
    actors: [
      { userId: owner, role: 'patient' },
      { userId: 'introducer-1', role: 'introducer' },
      { userId: counterpart, role: 'agent' },
    ],
    interpretation: { category: 'collaboration', reasoning, confidence: 0.8 },
    context: {},
    confidence: '0.8',
  };
}

function deps(overrides: Partial<PoolCandidateContextDeps> = {}): PoolCandidateContextDeps {
  return {
    getProfile: async (userId) => ({
      identity: { name: `Name ${userId}`, bio: `Bio ${userId}`, location: '' },
      context: '',
    }),
    getPremisesForUser: async (userId) => [{
      id: `premise-${userId}`,
      userId,
      assertion: { text: `Premise ${userId}`, polarity: 'positive' },
    }] as Awaited<ReturnType<PoolCandidateContextDeps['getPremisesForUser']>>,
    ...overrides,
  };
}

describe('buildPoolCandidateContexts', () => {
  it('preserves caller order and uses the non-owner, non-introducer counterpart', async () => {
    const result = await buildPoolCandidateContexts(owner, [
      { id: 'newborn-4', opportunity: opportunity('candidate-b', 'Second match') },
      { id: 'newborn-2', opportunity: opportunity('candidate-a', 'First match') },
    ], deps());

    expect(result.map((candidate) => candidate.id)).toEqual(['newborn-4', 'newborn-2']);
    expect(result[0].publicContext).toContain('Name candidate-b');
    expect(result[0].publicContext).not.toContain('Second match');
    expect(result[0].publicContext).toContain('Premise candidate-b');
    expect(result[0].publicContext).not.toContain('introducer-1');
  });

  it('fails open on optional profile and premise lookup errors', async () => {
    const result = await buildPoolCandidateContexts(owner, [
      { id: 'newborn-0', opportunity: opportunity('candidate-a', 'Safe bounded match') },
    ], deps({
      getProfile: async () => { throw new Error('profile unavailable'); },
      getPremisesForUser: async () => { throw new Error('premises unavailable'); },
    }));

    expect(result).toEqual([{ id: 'newborn-0', publicContext: '', score: 0.8 }]);
  });

  it('omits legacy evaluator reasoning from discriminator evidence context', async () => {
    const result = await buildPoolCandidateContexts(owner, [
      {
        id: 'legacy-unsafe',
        opportunity: opportunity(
          'candidate-a',
          'Alice attended Edge Esmeralda. Their technical skills complement each other.',
        ),
      },
    ], deps());

    expect(result[0].publicContext).not.toContain('attended Edge Esmeralda');
    expect(result[0].publicContext).not.toContain('technical skills complement');
    expect(result[0].publicContext).not.toContain('Match:');
  });

  it('omits entries without a counterpart instead of changing neighboring ids', async () => {
    const ownerOnly = opportunity(owner, 'Owner only');
    ownerOnly.actors = [{ userId: owner, role: 'patient' }];
    const result = await buildPoolCandidateContexts(owner, [
      { id: 'newborn-0', opportunity: ownerOnly },
      { id: 'newborn-1', opportunity: opportunity('candidate-a', 'Candidate match') },
    ], deps());

    expect(result.map((candidate) => candidate.id)).toEqual(['newborn-1']);
  });
});
