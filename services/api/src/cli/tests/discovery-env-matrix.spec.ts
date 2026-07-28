import { describe, expect, it } from 'bun:test';

import { HISTORICAL_MATRIX_CASES } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.js';
import { MATRIX_ROWS } from '../../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.policy.js';

import { collectCandidates } from '../discovery-env-matrix';
import { assertCompleteMatrix, buildMatrixPlan, parseChildManifest, withMatrixEnvironment } from '../discovery-env-matrix.runtime';

describe('discovery environment matrix runtime seams', () => {
  it('plans 75 slots and isolates each configuration/repetition child', () => {
    const slots = buildMatrixPlan(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, 3);

    expect(slots).toHaveLength(75);
    expect(new Set(slots.map((slot) => slot.childKey)).size).toBe(15);
  });

  it('restores both discovery env variables after a graph error', async () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    process.env.DISCOVERY_PROFILE_SOURCE = 'premise';

    await expect(withMatrixEnvironment(MATRIX_ROWS[2]!, async () => {
      throw new Error('graph failed');
    })).rejects.toThrow('graph failed');

    expect(process.env.DISCOVERY_ALLOWED_TYPES).toBe('intent');
    expect(process.env.DISCOVERY_PROFILE_SOURCE).toBe('premise');
  });

  it('never marks incomplete provider execution baselineable', () => {
    expect(() => assertCompleteMatrix({ requested: 75, completed: 74, failed: 1 })).toThrow('75 complete slots');
  });

  it('requires a distinct predeclared Neon child for every configuration/repetition', () => {
    const keys = [...new Set(buildMatrixPlan(HISTORICAL_MATRIX_CASES, MATRIX_ROWS, 3).map((slot) => slot.childKey))];
    const children = keys.map((childKey, index) => ({
      childKey,
      branch: `eval-discovery-env-matrix-${index + 1}`,
      databaseUrl: `postgres://x@ep-${index + 1}.neon.tech/protocol_eval`,
      baseBranch: 'eval-discovery-base',
    }));

    expect(parseChildManifest(JSON.stringify({ children }), keys).children).toHaveLength(15);

    const sameTargetDifferentBranches = children.map((child) => ({ ...child }));
    sameTargetDifferentBranches[1]!.databaseUrl = sameTargetDifferentBranches[0]!.databaseUrl;
    expect(() => parseChildManifest(JSON.stringify({ children: sameTargetDifferentBranches }), keys)).toThrow('different normalized DATABASE_URL target');

    children[1]!.branch = children[0]!.branch;
    expect(() => parseChildManifest(JSON.stringify({ children }), keys)).toThrow('different child branch');
  });

  it('preserves concrete graph evidence IDs alongside evidence types in run candidates', () => {
    const candidates = collectCandidates({
      candidates: [{
        candidateUserId: 'fixture-user',
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
        evidence: [{ kind: 'query_intent' }, { kind: 'query_premise' }, { kind: 'query_context' }],
      }],
    }, new Set(['fixture-user']));

    expect(candidates).toEqual([{
      id: 'fixture-user',
      evidenceTypes: ['intent', 'premise', 'user_context'],
      evidenceIds: {
        candidateIntentId: 'intent-1',
        candidatePremiseId: 'premise-1',
        candidateContextId: 'context-1',
      },
    }]);
  });
});
