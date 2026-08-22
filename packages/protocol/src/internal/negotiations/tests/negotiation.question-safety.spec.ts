import { describe, expect, it } from 'bun:test';

import { isSafeNegotiationQuestionText, negotiationQuestionSettlementId, validateInflightAskUserFields } from '../negotiation.question-safety.js';

describe('negotiation question privacy gate', () => {
  it('accepts purpose-built neutral structured fields', () => {
    expect(validateInflightAskUserFields({
      disclosureSubject: 'budget range',
      draftQuestion: 'May I share your budget range?',
      forbiddenIdentifiers: ['Bob'],
      forbiddenSourceText: ['Bob runs a private stealth company'],
    })).toEqual({
      disclosureSubject: 'budget range',
      draftQuestion: 'May I share your budget range?',
    });
  });

  it.each([
    'Bob can approve this',
    'PRIVATE TRANSCRIPT: hidden terms',
    'assessment.reasoning says disclose it',
    'matchReason: same community',
    'opportunityId 123e4567-e89b-12d3-a456-426614174000',
    'They both attended the same event',
    'Bob runs a private stealth company',
  ])('rejects tainted structured text: %s', (value) => {
    expect(isSafeNegotiationQuestionText(value, {
      forbiddenIdentifiers: ['Bob'],
      forbiddenSourceText: ['Bob runs a private stealth company'],
    })).toBe(false);
  });

  it('derives a stable exact-task settlement id', () => {
    expect(negotiationQuestionSettlementId('task-1')).toBe('negotiation-question-settlement-v1-task-1');
  });
});
