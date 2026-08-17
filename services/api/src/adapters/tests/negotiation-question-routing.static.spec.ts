import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../questioner.adapter.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../../drizzle/0106_add_negotiation_question_provenance_index.sql', import.meta.url), 'utf8');
const recoveryMigration = readFileSync(new URL('../../../drizzle/0105_add_recovery_question_uniqueness.sql', import.meta.url), 'utf8');
const continuationMigration = readFileSync(new URL('../../../drizzle/0107_add_negotiation_continuation_successor_uniqueness.sql', import.meta.url), 'utf8');
const continuationAtomic = readFileSync(new URL('../negotiation-continuation.atomic.ts', import.meta.url), 'utf8');
const uptakeGuard = readFileSync(new URL('../../lib/opportunity/uptake-acceptance.guard.ts', import.meta.url), 'utf8');
const readiness = readFileSync(new URL('../../lib/drizzle/test-database-readiness.ts', import.meta.url), 'utf8');
const publicProjection = readFileSync(new URL('../../lib/question/question.public.ts', import.meta.url), 'utf8');
const controller = readFileSync(new URL('../../controllers/question.controller.ts', import.meta.url), 'utf8');
const inflightHandler = readFileSync(new URL('../../events/handlers/question.answer.negotiation-inflight.ts', import.meta.url), 'utf8');
const runExisting = readFileSync(new URL('../../queues/negotiations/run-existing.queue.ts', import.meta.url), 'utf8');
const negotiationGraph = readFileSync(new URL('../../../../../packages/protocol/src/negotiations/negotiation.graph.ts', import.meta.url), 'utf8');
const questionerQueue = readFileSync(new URL('../../queues/questioner.queue.ts', import.meta.url), 'utf8');
const uptakeService = readFileSync(new URL('../../services/uptake-question.service.ts', import.meta.url), 'utf8');
const opportunityService = readFileSync(new URL('../../services/opportunity.service.ts', import.meta.url), 'utf8');
const baseTriggerContract = JSON.parse(readFileSync(
  new URL('./fixtures/negotiation-question-trigger.base.json', import.meta.url),
  'utf8',
)) as {
  sourceCommit: string;
  ordinaryProducerModeOccurrences: number;
  inflightProducerModeOccurrences: number;
  requiresPriorAskUserGuard: boolean;
  requiresOrdinaryStallGuard: boolean;
  maximumGeneratorQuestionsBeforeInd507: number;
  maximumUptakeQuestionsBeforeInd507: number;
  opportunityServiceNegotiationGraphImports: number;
};

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

  it('preserves the recorded origin/dev producer trigger frequency and does not raise cardinality', () => {
    expect(baseTriggerContract.sourceCommit).toBe('417c710de160bce0fadafd73f3bce0fc2d5e8deb');
    expect(negotiationGraph.match(/mode: 'negotiation'/g)).toHaveLength(baseTriggerContract.ordinaryProducerModeOccurrences);
    expect(negotiationGraph.match(/mode: 'negotiation_inflight'/g)).toHaveLength(baseTriggerContract.inflightProducerModeOccurrences);
    expect(negotiationGraph.includes('!hasPriorAskUser(state.messages, ownUser.id)')).toBe(baseTriggerContract.requiresPriorAskUserGuard);
    expect(negotiationGraph.includes('!hasOpportunity && !isRejectLikeAction(lastTurn?.action) && state.turnCount > 0')).toBe(baseTriggerContract.requiresOrdinaryStallGuard);
    expect(negotiationGraph).not.toContain('|| turn.message');
    expect(negotiationGraph).not.toContain('|| turn.assessment.reasoning');
    expect(questionerQueue).toContain("data.purpose === 'uptake'\n      ? result.questions.slice(0, 1)");
    expect(questionerQueue).toContain("? result.questions.slice(0, 2)");
    expect(2).toBeLessThanOrEqual(baseTriggerContract.maximumGeneratorQuestionsBeforeInd507);
    expect(1).toBe(baseTriggerContract.maximumUptakeQuestionsBeforeInd507);
    expect(uptakeService).toContain('NEGOTIATION_QUESTION_GENERIC_UPTAKE_ACTIVITY');
    expect(uptakeService).not.toContain('counterpartyIntent.summary?.trim()');
    expect(uptakeService).not.toContain('counterpartyIntent.payload.trim()');
    expect(opportunityService.match(/NegotiationGraph/g) ?? []).toHaveLength(baseTriggerContract.opportunityServiceNegotiationGraphImports);
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
    expect(inflightHandler).not.toContain('getNegotiationTaskForOpportunity');
    expect(inflightHandler).not.toContain('updateOpportunityMetadata');
  });

  it('settles zero-row/final-reject/expiry-before-persist paths through the task binding', () => {
    const expiry = source.slice(source.indexOf('async expireInflightQuestion'), source.indexOf('async claimNegotiationContinuationExecution'));
    expect(expiry).toContain("metadata?.turnContext");
    expect(expiry).toContain("task.state !== 'input_required'");
    expect(expiry).not.toContain('if (rows.length === 0) return null');
    expect(expiry).toContain("state: 'canceled'");
    expect(source).toContain('resolveNegotiationAdmission(first');
  });

  it('uses fenced exact-successor settlements and keeps timeout recovery armed', () => {
    expect(source).toContain("'{questionSettlement}'");
    expect(source).toContain('claimNegotiationContinuationExecution');
    expect(source).toContain('completeNegotiationContinuationExecution');
    expect(runExisting).toContain('negotiation-resume-${data.settlementId}');
    expect(runExisting).toContain('negotiationContinuation: execution');
    expect(runExisting).toContain('no positive successor receipt');
    expect(negotiationGraph).toContain('state.continuationExecution');
    expect(negotiationGraph).toContain('continuationReceipt');
    expect(inflightHandler).not.toContain('cancelAskUserExpiry');
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

  it('uses canonical filtered reads for uptake acceptance and persists exact counterparty provenance', () => {
    expect(uptakeGuard).toContain('new QuestionerAdapter(db).findPending');
    expect(uptakeGuard).toContain("purpose: 'uptake'");
    expect(source).toContain('candidate.counterpartyUserId');
    expect(source).toContain('counterparty_intent.id');
    expect(source).toContain('counterparty_intent.felicity_authority');
    expect(source).toContain('currentUptakeAuthorityThreshold()');
    expect(source).toContain('counterparty_assignment');
    expect(uptakeService).toContain('counterpartyUserId');
    expect(uptakeService).toContain('counterpartyIntentId');
  });

  it('locks the whole stable cohort before provenance rows for sibling-answer and answer-timeout races', () => {
    const body = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    for (const section of [
      body('async answer(', 'async dismiss('),
      body('async dismiss(', 'async expireInflightQuestion('),
      body('async expireInflightQuestion(', 'async claimNegotiationContinuationExecution'),
    ]) {
      const advisory = section.indexOf('lockNegotiationQuestionAdvisory');
      const cohort = section.indexOf('lockNegotiationQuestionCohort', advisory);
      const provenance = section.indexOf('lockNegotiationSettlementRows', cohort);
      expect(advisory).toBeGreaterThan(-1);
      expect(cohort).toBeGreaterThan(advisory);
      expect(provenance).toBeGreaterThan(cohort);
    }
    expect(source).toContain('.orderBy(questions.id)');
  });

  it('validates unscoped pending rows/counts and separates historical inflight validation', () => {
    expect(source).toContain("status === 'pending'");
    expect(source).toContain('validateHistoricalNegotiationQuestion(question, userId)');
    expect(source).toContain("const rows = await this.findPending(userId, { noConversation: true })");
    expect(source).toContain('return derivePendingQuestionCounts(rows)');
    expect(source).toContain('isExpectedHistoricalNegotiationSettlement(question.status, question.id, settlement)');
  });

  it('preserves IND-506 recovery locks, migration, producer isolation, and privacy beside IND-507', () => {
    expect(recoveryMigration).toContain('questions_recovery_recipient_intent_fingerprint_uniq');
    expect(migration).not.toContain('questions_recovery_recipient_intent_fingerprint_uniq');
    expect(readiness).toContain("'public.questions_recovery_recipient_intent_fingerprint_uniq'");
    expect(readiness).toContain("'public.questions_negotiation_provenance_uniq'");
    expect(publicProjection).toContain('recovery: _recovery');
    expect(publicProjection).toContain('negotiation: _negotiation');

    const answer = source.slice(source.indexOf('async answer('), source.indexOf('async dismiss('));
    const recoveryBranch = answer.indexOf("initialDetection.purpose === 'recovery'");
    const recoveryAdvisory = answer.indexOf('acquireIntentScopeAdvisoryLock', recoveryBranch);
    const recoveryIntent = answer.indexOf('.from(intents)', recoveryAdvisory);
    const recoveryQuestion = answer.indexOf('.from(questions)', recoveryIntent);
    const negotiationAdvisory = answer.indexOf('lockNegotiationQuestionAdvisory', recoveryQuestion);
    const negotiationCohort = answer.indexOf('lockNegotiationQuestionCohort', negotiationAdvisory);
    expect(recoveryBranch).toBeGreaterThan(-1);
    expect(recoveryAdvisory).toBeGreaterThan(recoveryBranch);
    expect(recoveryIntent).toBeGreaterThan(recoveryAdvisory);
    expect(recoveryQuestion).toBeGreaterThan(recoveryIntent);
    expect(negotiationAdvisory).toBeGreaterThan(recoveryQuestion);
    expect(negotiationCohort).toBeGreaterThan(negotiationAdvisory);

    const recoveryGuard = questionerQueue.indexOf("data.purpose === 'recovery'");
    const negotiationContract = questionerQueue.indexOf('isValidQuestionerInputContract(data)', recoveryGuard);
    expect(recoveryGuard).toBeGreaterThan(-1);
    expect(negotiationContract).toBeGreaterThan(recoveryGuard);
  });
});
