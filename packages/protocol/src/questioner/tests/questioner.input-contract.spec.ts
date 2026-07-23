import { describe, expect, it } from 'bun:test';

import { isValidQuestionerInputContract, type QuestionerInput } from '../questioner.types.js';

const base = {
  userId: 'user-1',
  sourceType: 'opportunity',
  sourceId: 'opp-1',
};

const stalled: QuestionerInput = {
  ...base,
  mode: 'negotiation',
  purpose: 'stalled_followup',
  negotiation: {
    purpose: 'stalled_followup',
    recipientUserId: 'user-1',
    recipientIntentId: 'intent-1',
    opportunityId: 'opp-1',
    taskId: 'task-1',
    networkId: 'network-1',
  },
  context: {
    negotiationId: 'task-1',
    counterpartyHint: 'the other participant',
    indexContext: 'the selected network',
    outcomeReason: 'stalled',
    recipientIntent: 'Find a collaborator',
  },
};

const inflight: QuestionerInput = {
  ...base,
  mode: 'negotiation_inflight',
  purpose: 'inflight_consultation',
  negotiation: {
    purpose: 'inflight_consultation',
    recipientUserId: 'user-1',
    recipientIntentId: 'intent-1',
    opportunityId: 'opp-1',
    taskId: 'task-1',
    networkId: 'network-1',
  },
  context: {
    negotiationId: 'task-1',
    counterpartyHint: 'the other participant',
    indexContext: 'the selected network',
    disclosureSubject: 'budget range',
  },
};

const recovery: QuestionerInput = {
  mode: 'intent',
  purpose: 'recovery',
  userId: 'user-1',
  sourceType: 'intent',
  sourceId: 'intent-1',
  triggeredByIntentId: 'intent-1',
  context: {
    purpose: 'recovery',
    intentId: 'intent-1',
    payload: 'Find a collaborator',
    rejectedNegotiationCount: 2,
  },
};

const uptake: QuestionerInput = {
  ...base,
  mode: 'negotiation',
  purpose: 'uptake',
  negotiation: {
    purpose: 'uptake',
    recipientUserId: 'user-1',
    recipientIntentId: 'intent-1',
    opportunityId: 'opp-1',
    networkId: 'network-1',
    counterpartyUserId: 'counterparty-1',
    counterpartyIntentId: 'counterparty-intent-1',
    counterpartyFelicityAuthority: 45,
  },
  context: {
    purpose: 'uptake',
    negotiationId: 'opp-1',
    counterpartyHint: 'the other participant',
    indexContext: 'the selected network',
    proposedActivity: 'a potential collaboration that may require clarification before you decide',
  },
};

describe('QuestionerInput runtime negotiation discriminant', () => {
  it.each([stalled, inflight, uptake])('accepts each valid negotiation contract', (input) => {
    expect(isValidQuestionerInputContract(input)).toBe(true);
  });

  it('preserves the dedicated IND-506 recovery contract beside negotiation discriminants', () => {
    expect(isValidQuestionerInputContract(recovery)).toBe(true);
    expect(isValidQuestionerInputContract({
      ...recovery,
      triggeredByIntentId: 'different-intent',
    })).toBe(false);
    expect(isValidQuestionerInputContract({
      ...recovery,
      negotiation: stalled.negotiation,
    } as QuestionerInput)).toBe(false);
  });

  it.each([
    { ...inflight, mode: 'negotiation' },
    { ...stalled, mode: 'negotiation_inflight' },
    { ...uptake, mode: 'negotiation_inflight' },
    { ...uptake, negotiation: { ...uptake.negotiation, counterpartyIntentId: undefined } },
    { ...uptake, negotiation: { ...uptake.negotiation, counterpartyFelicityAuthority: undefined } },
    { ...uptake, context: { ...uptake.context, proposedActivity: 'Alice profile from private transcript' } },
  ] as unknown as QuestionerInput[])('rejects crossed or unsafe contracts', (input) => {
    expect(isValidQuestionerInputContract(input)).toBe(false);
  });
});
