import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../questioner.adapter.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../drizzle/0106_add_negotiation_question_provenance_index.sql', import.meta.url), 'utf8');
const recoveryMigration = readFileSync(new URL('../../../drizzle/0105_add_recovery_question_uniqueness.sql', import.meta.url), 'utf8');
const continuationMigration = readFileSync(new URL('../../../drizzle/0107_add_negotiation_continuation_successor_uniqueness.sql', import.meta.url), 'utf8');
const continuationAtomic = readFileSync(new URL('../negotiation-continuation.atomic.ts', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../../lib/drizzle/test-database-readiness.ts', import.meta.url), 'utf8');
const runExisting = readFileSync(new URL('../../queues/negotiations/run-existing.queue.ts', import.meta.url), 'utf8');
const negotiationGraph = readFileSync(new URL('../../../../../packages/protocol/src/internal/negotiations/negotiation.graph.ts', import.meta.url), 'utf8');
const negotiationGraphFinalize = readFileSync(new URL('../../../../../packages/protocol/src/internal/negotiations/negotiation.graph.finalize.ts', import.meta.url), 'utf8');
const opportunityService = readFileSync(new URL('../../services/opportunity.service.ts', import.meta.url), 'utf8');

describe('negotiation question routing static invariants', () => {
  it('drops the per-generator intent-scope disjunction with the read surface', () => {
    // The findByStatus scope disjunction (one SQL branch per retired
    // generator) went with the pending-question reads; the surviving
    // settlement paths bind rows by exact task provenance only.
    expect(source).not.toContain("NOT IN ('negotiation', 'negotiation_inflight')");
    expect(source).not.toContain('findByStatus');
    expect(source).toContain("->'negotiation'->>'taskId'");
  });

  it('revalidates exact owner, lifecycle, assignment, membership, actor, and task bindings', () => {
    for (const invariant of [
      'eq(intents.userId, candidate.recipientUserId)',
      "eq(intents.status, 'ACTIVE')",
      'eq(intentNetworks.networkId, candidate.networkId)',
      'isNull(networkMembers.deletedAt)',
      'eq(networks.isPersonal, false)',
      "exact_actor->>'intent' = ${candidate.recipientIntentId}",
      "exact_actor->>'networkId' = ${candidate.networkId}",
      "${tasks.metadata}->'participantBindings'",
      "${tasks.metadata}->'turnContext'->'askUserBinding'",
    ]) expect(source).toContain(invariant);
  });

  it('ships one named all-status idempotency constraint and readiness gate', () => {
    expect(migration).toContain('DROP INDEX "questions_uptake_recipient_source_uniq"');
    expect(migration).toContain('CREATE UNIQUE INDEX "questions_negotiation_provenance_uniq"');
    expect(migration).toContain("COALESCE(\"detection\"->'negotiation'->>'taskId', '')");
    expect(migration).toContain("->'negotiation'->>'questionOrdinal'");
    expect(readiness).toContain("'public.questions_negotiation_provenance_uniq'");
    expect(readiness).not.toContain("'public.questions_uptake_recipient_source_uniq'");
  });

  it('settles only exact task cohorts and never looks up the latest task', () => {
    expect(source).toContain('eq(tasks.id, candidate.taskId!)');
    expect(source).toContain('eq(tasks.state, expectedTaskState)');
    expect(source).toContain('expireInflightQuestion');
    expect(source).not.toContain('getNegotiationTaskForOpportunity');
  });

  it('settles zero-row/final-reject/expiry-before-persist paths through the task binding', () => {
    const expiry = source.slice(source.indexOf('async expireInflightQuestion'), source.indexOf('async claimNegotiationContinuationExecution'));
    expect(expiry).toContain("metadata?.turnContext");
    expect(expiry).toContain("task.state !== 'input_required'");
    expect(expiry).not.toContain('if (rows.length === 0) return null');
    expect(expiry).toContain("state: 'canceled'");
    expect(source).toContain('resolveNegotiationAdmission(candidate');
  });

  it('uses fenced exact-successor settlements and keeps timeout recovery armed', () => {
    expect(source).toContain("'{questionSettlement}'");
    expect(source).toContain('claimNegotiationContinuationExecution');
    expect(source).toContain('completeNegotiationContinuationExecution');
    expect(runExisting).toContain('negotiation-resume-${data.settlementId}');
    expect(runExisting).toContain('negotiationContinuation: execution');
    expect(runExisting).toContain('no positive successor receipt');
    expect(negotiationGraph).toContain('state.continuationExecution');
    expect(negotiationGraphFinalize).toContain('continuationReceipt');
  });

  it('uses a database-enforced successor identity plus a token/fence guard for every continuation effect', () => {
    expect(continuationMigration).toContain('CREATE UNIQUE INDEX "tasks_negotiation_continuation_settlement_uniq"');
    expect(readiness).toContain("'public.tasks_negotiation_continuation_settlement_uniq'");
    expect(continuationMigration).toContain('"metadata"->>\'resumeFromTaskId\'');
    expect(continuationMigration).toContain('"metadata"->>\'continuationSettlementId\'');
    expect(continuationAtomic).toContain('CONTINUATION_EXECUTION_LEASE_MS');
    expect(continuationAtomic).toContain('const fence = (existingExecution?.fence ?? 0) + 1');
    expect(continuationAtomic).toContain('assertContinuationExecutionEffect');
    expect(continuationAtomic).toContain('loadPrivateConsultation');
    expect(continuationAtomic).toContain('parkContinuationExecution');
    expect(runExisting).toContain('parkNegotiationContinuationExecution');
    expect(continuationAtomic.indexOf('const consultation = await loadPrivateConsultation')).toBeLessThan(
      continuationAtomic.indexOf('const successors = await tx.select()'),
    );
  });

  it('locks the whole stable cohort before provenance rows for sibling-answer and answer-timeout races', () => {
    const body = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    for (const section of [
      body('async expireInflightQuestion(', 'async settleInflightNegotiationAnswerFromDm('),
      body('async settleInflightNegotiationAnswerFromDm(', 'async recordOpportunityUserAnswer('),
    ]) {
      const advisory = section.indexOf('lockNegotiationQuestionAdvisory');
      const cohort = section.indexOf('lockNegotiationQuestionCohort', advisory);
      const provenance = section.indexOf('lockNegotiationSettlementRows', cohort);
      expect(advisory).toBeGreaterThan(-1);
      expect(cohort).toBeGreaterThan(advisory);
      expect(provenance).toBeGreaterThan(cohort);
    }

  });

  it('keeps only the settlement, evidence, and void-on-contact reads over the questions table', () => {
    // The pending/answered read surface is retired; the remaining table
    // touches are the leftover-row void, the settlement paths' leftover
    // dismissals, and the Lens C answered-history read.
    expect(source).toContain('voidLeftoverQuestion');
    expect(source).toContain('getAnsweredNegotiationQuestionsForOpportunity');
    expect(source).not.toContain('findPending');
    expect(source).not.toContain('findAnswered');
    expect(source).not.toContain('countPending');
  });

  it('keeps the historical uniqueness constraints in place while the table survives', () => {
    expect(recoveryMigration).toContain('questions_recovery_recipient_intent_fingerprint_uniq');
    expect(migration).not.toContain('questions_recovery_recipient_intent_fingerprint_uniq');
    expect(readiness).toContain("'public.questions_recovery_recipient_intent_fingerprint_uniq'");
    expect(readiness).toContain("'public.questions_negotiation_provenance_uniq'");
  });
});
