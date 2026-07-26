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

function productionRuntime(): BackfillRuntime {
  const dialect = new PgDialect();
  const db = {
    async execute(query: SQL) {
      const statement = dialect.sqlToQuery(query).sql;
      if (statement.includes('ORDER BY i.created_at ASC, i.id ASC')) {
        // Before the fix this select used bare `status`; PostgreSQL rejects it
        // because both joined tables expose that column.
        if (!statement.includes('i.status AS status')) {
          throw new Error('column reference "status" is ambiguous');
        }
        return [];
      }
      if (statement.includes('GROUP BY 1')) return [];
      if (statement.includes('complete_analysis')) return [{ complete_analysis: 0, partial_analysis: 0 }];
      throw new Error('unexpected maintenance query');
    },
    async transaction(): Promise<never> {
      throw new Error('unexpected audit or intent write');
    },
  } as unknown as BackfillRuntime['db'];
  return {
    sql,
    db,
    getProfileContext: async () => { throw new Error('unexpected profile lookup'); },
  };
}

/**
 * Uses the maintained createRuntimeDeps assembly with a SQL-recording runtime.
 * It proves the package command's actual default query is unambiguous without
 * opening a socket, constructing a provider, or permitting any write path.
 */
export async function productionAssemblyDryRun(options: { dryRun: boolean }): Promise<BackfillDeps> {
  return createRuntimeDeps(options, undefined, async () => productionRuntime());
}

/** Emits a valid report but produces the documented candidate-level nonzero exit. */
export async function candidateDiagnostic(): Promise<BackfillDeps> {
  return noWriteDeps([candidate()], true);
}
