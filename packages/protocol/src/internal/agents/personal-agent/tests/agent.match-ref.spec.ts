import { describe, expect, it } from 'bun:test';
import { matchRefId, opportunityRef } from '../agent.types.js';

describe('match refs', () => {
  it('reads one id regardless of kind', () => {
    expect(matchRefId({ ref: { kind: 'opportunity', id: 'opp-1' }, label: 'A', status: 'negotiating' }))
      .toBe('opp-1');
    expect(matchRefId({ ref: { kind: 'candidate', id: 'cand-1' }, label: 'B', status: 'found' }))
      .toBe('cand-1');
  });

  it('opportunityRef builds an opportunity-kind ref', () => {
    expect(opportunityRef('opp-2')).toEqual({ kind: 'opportunity', id: 'opp-2' });
  });
});
