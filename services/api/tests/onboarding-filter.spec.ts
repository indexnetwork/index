import { describe, it, expect } from 'bun:test';

describe('Discovery eligibility filtering in opportunity enrichment', () => {
  it('should NOT skip candidates with a profile embedding', () => {
    const profile = { embedding: [0.1, 0.2, 0.3] };
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(false);
  });

  it('should skip candidates without a profile embedding', () => {
    const profile = { embedding: null };
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(true);
  });

  it('should skip candidates with no profile at all', () => {
    const profile = null as { embedding: number[] | null } | null;
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(true);
  });

  it('should NOT skip direct-connection targets even without embedding', () => {
    const profile = null as { embedding: number[] | null } | null;
    const isDirectTarget = true;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(false);
  });

  it('should NOT skip ghost users regardless of embedding status', () => {
    const candidateUser = { id: 'ghost-1', name: 'Ghost', isGhost: true };
    const profile = null as { embedding: number[] | null } | null;
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !candidateUser?.isGhost && !profile?.embedding;
    expect(shouldSkip).toBe(false);
  });

  it('should still skip soft-deleted users regardless of embedding (separate guard)', () => {
    const candidateUser = {
      id: 'deleted-user-1',
      name: 'Deleted',
      deletedAt: '2026-02-01T00:00:00Z',
    };

    const shouldSkipDeleted = !!(candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt);
    expect(shouldSkipDeleted).toBe(true);
  });
});
