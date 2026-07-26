import type { BackfillDeps, Candidate } from '../../backfill-intent-verification-analysis';

const partitions = {
  proposal_confirm_default_only: 0,
  proposal_confirm_partial_missing: 0,
  legacy_discovery_missing_analysis: 0,
  other_missing_analysis: 0,
};

function candidate(): Candidate {
  return {
    id: 'fixture-intent', userId: 'fixture-owner', payload: 'fixture', sourceId: null, sourceType: 'fixture', proposalConfirmed: false,
    semanticEntropy: 1, referentialAnchor: null, intentMode: 'ATTRIBUTIVE', speechActType: null,
    felicityAuthority: null, felicitySincerity: null, felicityClarity: null,
    control: {
      userId: 'fixture-owner', payload: 'fixture', summary: null, isIncognito: false, sourceId: null, sourceType: 'fixture', embedding: null,
      createdAt: new Date(0), updatedAt: new Date(0), archivedAt: null, lastVisitedAt: null, firstDiscoverySucceededAt: null, status: 'ACTIVE',
    },
  };
}

function noWriteDeps(candidates: Candidate[], failProfile = false): BackfillDeps {
  const noWrite = async (): Promise<never> => { throw new Error('unexpected write or verifier call'); };
  return {
    listCandidates: async () => candidates,
    countCandidates: async () => partitions,
    countControls: async () => ({ completeAnalysis: 0, partialAnalysis: 0 }),
    getProfileContext: async () => {
      if (failProfile) throw new Error('fixture candidate diagnostic');
      return null;
    },
    verify: noWrite,
    getAttemptStatus: noWrite,
    beginRun: noWrite,
    recordAttempt: noWrite,
    applyAnalysis: noWrite,
    finishRun: noWrite,
  };
}

/** Hermetic dependency source for the real package-script process boundary. */
export async function emptyDryRun(): Promise<BackfillDeps> {
  return noWriteDeps([]);
}

/** Emits a valid report but produces the documented candidate-level nonzero exit. */
export async function candidateDiagnostic(): Promise<BackfillDeps> {
  return noWriteDeps([candidate()], true);
}
