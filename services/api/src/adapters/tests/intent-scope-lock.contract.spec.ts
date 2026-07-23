import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { intentScopeAdvisoryLockKey } from '../intent-scope.atomic';

const questionerSource = readFileSync(
  new URL('../questioner.adapter.ts', import.meta.url),
  'utf8',
);
const opportunitySource = readFileSync(
  new URL('../opportunity.database.adapter.ts', import.meta.url),
  'utf8',
);
const chatDatabaseSource = readFileSync(
  new URL('../chat.database.adapter.ts', import.meta.url),
  'utf8',
);
const intentDatabaseSource = readFileSync(
  new URL('../intent.database.adapter.ts', import.meta.url),
  'utf8',
);
const answerHandlerSource = readFileSync(
  new URL('../../events/handlers/question.answer.intent.ts', import.meta.url),
  'utf8',
);
const mainSource = readFileSync(new URL('../../main.ts', import.meta.url), 'utf8');
const protocolIntentGraphSource = readFileSync(
  new URL('../../../../../packages/protocol/src/intent/intent.graph.ts', import.meta.url),
  'utf8',
);

function methodSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('intent-scope advisory lock contract', () => {
  it('keeps the established recipient+intent key without a second namespace', () => {
    expect(intentScopeAdvisoryLockKey('recipient-1', 'intent-1')).toBe('recipient-1:intent-1');
  });

  it('serializes recovery and exact-trigger opportunity persistence with the same helper', () => {
    const recovery = methodSlice(
      questionerSource,
      'async persistFreshRecoveryQuestion(',
      'async bindChatQuestionsToMessage(',
    );
    const opportunity = methodSlice(
      opportunitySource,
      'async persistIntentScopedOpportunityIfNetworkEligible(',
      'async updateOpportunityStatusIfNetworkEligible(',
    );

    expect(recovery).toContain('acquireIntentScopeAdvisoryLock(tx, userId, intentId)');
    expect(opportunity).toContain('acquireIntentScopeAdvisoryLock(');
    expect(opportunity).toContain('eligibility.ownerUserId');
    expect(opportunity).toContain('eligibility.triggerIntentId');
    expect(opportunity.indexOf('acquireIntentScopeAdvisoryLock('))
      .toBeLessThan(opportunity.indexOf('acquireIntentScopedPairLocks('));
    expect(opportunity.indexOf('acquireIntentScopeAdvisoryLock('))
      .toBeLessThan(opportunity.indexOf(".from(schema.intents)"));
  });

  it('serializes exact-trigger opportunity reactivation before every conflicting row lock', () => {
    const reactivation = methodSlice(
      opportunitySource,
      'async updateOpportunityStatusIfNetworkEligible(',
      'async compensateTasklessNegotiatingOpportunity(',
    );
    const advisory = reactivation.indexOf('acquireIntentScopeAdvisoryLock(');
    const intentRow = reactivation.indexOf('.from(schema.intents)', advisory);
    const opportunityMutation = reactivation.indexOf('.update(opportunities)', advisory);
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(reactivation).toContain('eligibility.ownerUserId');
    expect(reactivation).toContain('eligibility.triggerIntentId');
    expect(intentRow).toBeGreaterThan(advisory);
    expect(opportunityMutation).toBeGreaterThan(advisory);
  });

  it('threads lifecycle-aware recovery CAS data to both final locked intent writers', () => {
    expect(answerHandlerSource).toContain(
      'expectedIntentFingerprint: input.expectedIntentFingerprint',
    );
    expect(mainSource).toContain('expectedIntentFingerprint,');
    expect(protocolIntentGraphSource).toContain(
      'expectedIntentFingerprint: state.expectedIntentFingerprint',
    );
    expect(protocolIntentGraphSource).toContain('expectedIntentUserId: state.userId');

    for (const source of [chatDatabaseSource, intentDatabaseSource]) {
      const update = methodSlice(
        source,
        'async updateIntent(intentId:',
        'async archiveIntent(intentId:',
      );
      const rowLock = update.indexOf(".for('update')");
      const lifecycleGuard = update.indexOf('canApplyExpectedIntentUpdate(');
      const mutation = update.indexOf('tx.update(schema.intents)');
      expect(rowLock).toBeGreaterThanOrEqual(0);
      expect(lifecycleGuard).toBeGreaterThan(rowLock);
      expect(mutation).toBeGreaterThan(lifecycleGuard);
      expect(update).toContain('status: schema.intents.status');
      expect(update).toContain('archivedAt: schema.intents.archivedAt');
      expect(update).toContain('data.expectedIntentUserId');
    }
  });

  it('orders recovery answers and material edits as advisory, intent, then question', () => {
    const answer = methodSlice(
      questionerSource,
      'async answer(questionId:',
      'async dismiss(questionId:',
    );
    const answerAdvisory = answer.indexOf('acquireIntentScopeAdvisoryLock(tx, userId, intentId)');
    const answerIntent = answer.indexOf('.from(intents)', answerAdvisory);
    const answerQuestion = answer.indexOf('.from(questions)', answerIntent);
    expect(answerAdvisory).toBeGreaterThanOrEqual(0);
    expect(answerIntent).toBeGreaterThan(answerAdvisory);
    expect(answerQuestion).toBeGreaterThan(answerIntent);

    const material = methodSlice(
      questionerSource,
      'async handleMaterialIntentUpdate(',
      'async listPoolQuestionLabels(',
    );
    const materialAdvisory = material.indexOf(
      'acquireIntentScopeAdvisoryLock(tx, input.userId, input.intentId)',
    );
    const materialIntent = material.indexOf('.from(intents)', materialAdvisory);
    const materialQuestion = material.indexOf('tx.update(questions)', materialIntent);
    expect(materialAdvisory).toBeGreaterThanOrEqual(0);
    expect(materialIntent).toBeGreaterThan(materialAdvisory);
    expect(materialQuestion).toBeGreaterThan(materialIntent);
  });
});
