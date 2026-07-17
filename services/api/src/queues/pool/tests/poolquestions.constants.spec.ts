import { describe, expect, it } from 'bun:test';

import type { QuestionPoolSnapshot } from '@indexnetwork/protocol';

import { POOL_QUESTION_FRESHNESS_THRESHOLD, extractAssignmentOpportunityIds, extractSnapshotOpportunityIds, isPoolArtifactFresh, setJaccard } from '../poolquestions.constants';

function snapshot(assignments: string[], opportunityIds?: string[]): QuestionPoolSnapshot {
  return {
    poolSize: assignments.length,
    ...(opportunityIds ? { opportunityIds } : {}),
    minedAt: '2026-07-20T00:00:00.000Z',
    intentFingerprint: 'fingerprint-v1',
    discriminator: {
      label: 'Role',
      questionSeed: 'Which role?',
      sides: ['Builder', 'Advisor'],
      sideCounts: { Builder: assignments.length, Advisor: 0 },
      voi: 0.8,
      evidenceRate: 1,
      assignments: assignments.map((opportunityId) => ({ opportunityId, side: 'Builder' })),
    },
    alternates: [],
  };
}

describe('pool question freshness helpers', () => {
  it('uses one canonical inclusive 0.7 Jaccard boundary', () => {
    expect(POOL_QUESTION_FRESHNESS_THRESHOLD).toBe(0.7);
    expect(setJaccard(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      ['1', '2', '3', '4', '5', '6', '7'],
    )).toBe(0.7);
    expect(isPoolArtifactFresh(
      snapshot(['1', '2', '3', '4', '5', '6', '7']),
      'fingerprint-v1',
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    )).toBe(true);
  });

  it('deduplicates IDs and fails closed for either empty set', () => {
    expect(setJaccard(['a', 'a', 'b'], ['a', 'b', 'b'])).toBe(1);
    expect(setJaccard([], [])).toBe(0);
    expect(setJaccard(['a'], [])).toBe(0);
    expect(extractAssignmentOpportunityIds(snapshot(['a', 'a', 'b']))).toEqual(['a', 'b']);
  });

  it('uses stored opportunityIds for cadence and assignment IDs for legacy snapshots', () => {
    expect(extractSnapshotOpportunityIds(snapshot(['a'], ['pool-a', 'pool-a', 'pool-b'])))
      .toEqual(['pool-a', 'pool-b']);
    expect(extractSnapshotOpportunityIds(snapshot(['a', 'a', 'b']))).toEqual(['a', 'b']);
  });

  it('rejects below threshold, changed fingerprint, missing fingerprint, and empty assignments', () => {
    const fresh = snapshot(['1', '2', '3', '4', '5', '6', '7']);
    expect(isPoolArtifactFresh(fresh, 'fingerprint-v1', ['1', '2', '3', '4', '5', '6', '8', '9', '10']))
      .toBe(false);
    expect(isPoolArtifactFresh(fresh, 'fingerprint-v2', ['1', '2', '3', '4', '5', '6', '7']))
      .toBe(false);
    delete fresh.intentFingerprint;
    expect(isPoolArtifactFresh(fresh, 'fingerprint-v1', ['1', '2', '3', '4', '5', '6', '7']))
      .toBe(false);
    expect(isPoolArtifactFresh(snapshot([]), 'fingerprint-v1', ['1'])).toBe(false);
  });
});
