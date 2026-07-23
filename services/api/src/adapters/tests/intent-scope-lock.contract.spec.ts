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
