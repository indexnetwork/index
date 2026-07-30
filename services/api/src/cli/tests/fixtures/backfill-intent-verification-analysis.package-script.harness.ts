import { sql, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { createRuntimeDeps, type BackfillDeps, type BackfillRuntime, type Candidate } from '../../backfill-intent-verification-analysis';

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
      createdAt: '1970-01-01 00:00:00+00', updatedAt: '1970-01-01 00:00:00+00', archivedAt: null, lastVisitedAt: null, firstDiscoverySucceededAt: null, status: 'ACTIVE',
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

function productionRuntime(failure?: 'partitions' | 'candidate_listing'): BackfillRuntime {
  const dialect = new PgDialect();
  const db = {
    async execute(query: SQL) {
      const statement = dialect.sqlToQuery(query).sql;
      if (statement.includes('ORDER BY i.created_at ASC, i.id ASC')) {
        // The joined tables both expose status and created_at, so PostgreSQL
        // rejects either unqualified projection before a report is available.
        // created_at is additionally projected as exact text: the driver cannot
        // bind a Date control, and a Date round-trip would drop microseconds.
        if (!statement.includes('i.status AS status') || !statement.includes('i.created_at::text AS created_at')) {
          throw new Error('candidate projection is ambiguous');
        }
        if (failure === 'candidate_listing') throw new Error('fixture candidate-listing failure must not be emitted');
        return [{
          id: 'fixture-intent', user_id: 'fixture-owner', payload: 'fixture payload', source_id: 'fixture-proposal',
          source_type: 'discovery_form', proposal_confirmed: true, semantic_entropy: 1, referential_anchor: null,
          intent_mode: 'ATTRIBUTIVE', speech_act_type: null, felicity_authority: null, felicity_sincerity: null,
          felicity_clarity: null, summary: null, is_incognito: false, embedding: null,
          created_at: '1970-01-01 00:00:00+00', updated_at: '1970-01-01 00:00:00+00', archived_at: null, last_visited_at: null,
          first_discovery_succeeded_at: null, status: 'ACTIVE',
        }];
      }
      if (statement.includes('GROUP BY 1')) {
        if (failure === 'partitions') throw new Error('fixture partition failure must not be emitted');
        return [{ partition: 'proposal_confirm_default_only', count: 1 }];
      }
      if (statement.includes('complete_analysis')) return [{ complete_analysis: 7, partial_analysis: 2 }];
      throw new Error('unexpected maintenance query');
    },
    async transaction(): Promise<never> {
      throw new Error('unexpected audit or intent write');
    },
  } as unknown as BackfillRuntime['db'];
  return {
    sql,
    db,
    getProfileContext: async (userId) => userId === 'fixture-owner' ? { displayName: 'Fixture profile' } : null,
  };
}

/**
 * Uses the maintained createRuntimeDeps assembly with a SQL-recording runtime.
 * It proves the package command's complete default query/profile sequence is
 * unambiguous without opening a socket, constructing a provider, or permitting
 * any write path.
 */
export async function productionAssemblyDryRun(options: { dryRun: boolean }): Promise<BackfillDeps> {
  return createRuntimeDeps(options, undefined, async () => productionRuntime());
}

/** Forces the real partition-count runtime boundary without a database socket. */
export async function productionPartitionFailure(options: { dryRun: boolean }): Promise<BackfillDeps> {
  return createRuntimeDeps(options, undefined, async () => productionRuntime('partitions'));
}

/** Forces the real candidate-listing runtime boundary without a database socket. */
export async function productionCandidateListingFailure(options: { dryRun: boolean }): Promise<BackfillDeps> {
  return createRuntimeDeps(options, undefined, async () => productionRuntime('candidate_listing'));
}

/** Emits a valid report but produces the documented candidate-level nonzero exit. */
export async function candidateDiagnostic(): Promise<BackfillDeps> {
  return noWriteDeps([candidate()], true);
}
