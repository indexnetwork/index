import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../questioner.adapter.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../drizzle/0105_add_negotiation_question_provenance_index.sql', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../../lib/drizzle/test-database-readiness.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../controllers/question.controller.ts', import.meta.url), 'utf8');
const inflightHandler = readFileSync(new URL('../../events/handlers/question.answer.negotiation-inflight.ts', import.meta.url), 'utf8');

describe('negotiation question routing static invariants', () => {
  it('splits negotiation intent scope from broad actor/trigger inference', () => {
    expect(source).toContain("NOT IN ('negotiation', 'negotiation_inflight')");
    expect(source).toContain("->'negotiation'->>'recipientUserId'");
    expect(source).toContain("->'negotiation'->>'recipientIntentId'");
    expect(source).toContain("->'negotiation'->>'version' = '1'");
    expect(source).toContain("question.detection.sourceId !== provenance.opportunityId");
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

  it('keeps passive exact-intent refetches out of visit-time pool mining', () => {
    expect(controller).toContain("rawPassive === 'true' && scope.scopeType !== 'intent'");
    expect(controller).toContain("rawPassive !== 'true'");
    expect(controller).toContain('maybeEnqueueVisitPoolMining');
  });

  it('settles only exact task cohorts and never looks up the latest task', () => {
    expect(source).toContain("->'negotiation'->>'taskId' = ${provenance.taskId}");
    expect(source).toContain("eq(tasks.updatedAt, new Date(provenance.taskUpdatedAt!))");
    expect(source).toContain('expireInflightQuestion');
    expect(source).not.toContain('getNegotiationTaskForOpportunity');
    expect(source).not.toContain('latest task');
    expect(inflightHandler).not.toContain('getNegotiationTaskForOpportunity');
    expect(inflightHandler).not.toContain('updateOpportunityMetadata');
  });
});
