import { describe, expect, it } from 'bun:test';
import { resolveMatchToOpportunity } from '../agent.graph.js';
import type { PersonalAgentMatch } from '../agent.types.js';

const candidate: PersonalAgentMatch = { ref: { kind: 'candidate', id: 'cand-1' }, label: 'B', status: 'found' };
const open: PersonalAgentMatch = { ref: { kind: 'opportunity', id: 'opp-1' }, label: 'A', status: 'negotiating' };

describe('resolveMatchToOpportunity', () => {
  it('passes an opportunity ref through without a write', async () => {
    let called = false;
    const result = await resolveMatchToOpportunity(
      { createAndOpen: async () => { called = true; return { status: 'failed' as const, reason: 'x' }; } },
      'alice', 'intent-1', open,
    );
    expect(result).toEqual({ status: 'existing', opportunityId: 'opp-1' });
    expect(called).toBe(false);
  });

  it('materializes a candidate ref', async () => {
    const result = await resolveMatchToOpportunity(
      { createAndOpen: async () => ({ status: 'created' as const, opportunityId: 'opp-9' }) },
      'alice', 'intent-1', candidate,
    );
    expect(result).toEqual({ status: 'created', opportunityId: 'opp-9' });
  });

  it('passes the candidate id and the signal through', async () => {
    const seen: unknown[] = [];
    await resolveMatchToOpportunity(
      { createAndOpen: async (userId, input) => { seen.push({ userId, ...input }); return { status: 'created' as const, opportunityId: 'o' }; } },
      'alice', 'intent-1', candidate,
    );
    expect(seen).toEqual([{ userId: 'alice', intentId: 'intent-1', candidateId: 'cand-1' }]);
  });

  it('returns failed rather than throwing when the write fails', async () => {
    const result = await resolveMatchToOpportunity(
      { createAndOpen: async () => ({ status: 'failed' as const, reason: 'deadlock' }) },
      'alice', 'intent-1', candidate,
    );
    expect(result.status).toBe('failed');
  });
});
