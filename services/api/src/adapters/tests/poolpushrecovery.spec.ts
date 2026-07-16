import { describe, expect, test } from 'bun:test';

import { evaluatePoolPushRecipient, isRecoverablePoolPushDetection, terminalizePoolPushRequestDetection, type AdapterQuestionDetection } from '../questioner.adapter';

const NOW = '2026-07-16T12:00:00.000Z';

function requestedDetection(): AdapterQuestionDetection {
  return {
    mode: 'pool_discovery',
    sourceType: 'intent',
    sourceId: 'intent-1',
    triggeredBy: 'intent-1',
    timestamp: NOW,
    pushRequestedAt: NOW,
    pushRequestStatus: 'requested',
  };
}

function claimedDetection(): AdapterQuestionDetection {
  return {
    ...requestedDetection(),
    push: {
      version: 1,
      source: 'pool_discovery',
      recipientId: 'user-1',
      intentId: 'intent-1',
      cycleKey: 'run:run-1',
      messageId: 'question-1',
      surfaces: ['personal_agent_badge', 'negotiator_dm'],
      claimedAt: NOW,
      deliveryStatus: 'claimed',
    },
  };
}

describe('pool push request recovery state', () => {
  test('permanent unclaimed rejection becomes terminal while transient gates stay requested', () => {
    const requested = requestedDetection();
    expect(isRecoverablePoolPushDetection(requested)).toBe(true);

    const suppressed = terminalizePoolPushRequestDetection(requested, 'visited', NOW);
    expect(suppressed).toMatchObject({
      pushRequestStatus: 'suppressed',
      pushRequestReason: 'visited',
      pushRequestSuppressedAt: NOW,
    });
    expect(isRecoverablePoolPushDetection(suppressed)).toBe(false);

    // daily_budget and new_claim_disabled never call terminalization, so both
    // storage-backed retry paths retain this exact requested state.
    expect(isRecoverablePoolPushDetection(requested)).toBe(true);
  });

  test('permanent claimed rejection suppresses the claim and exits recovery', () => {
    const claimed = claimedDetection();
    expect(isRecoverablePoolPushDetection(claimed)).toBe(true);
    const suppressed = terminalizePoolPushRequestDetection(claimed, 'intent_lifecycle', NOW);
    expect(suppressed.push?.deliveryStatus).toBe('suppressed');
    expect(suppressed.push?.suppressedAt).toBe(NOW);
    expect(isRecoverablePoolPushDetection(suppressed)).toBe(false);
  });
});

describe('pool push authoritative recipient', () => {
  const actors = [{ userId: 'user-1', role: 'subject' as const }];

  test('mismatched job user cannot suppress a valid claim', () => {
    expect(evaluatePoolPushRecipient(actors, claimedDetection().push, 'attacker')).toEqual({
      kind: 'ineligible',
      reason: 'recipient_mismatch',
    });
  });

  test('claim recipient conflict is suppressible even when the job user cannot match the malformed claim', () => {
    const malformedPush = { ...claimedDetection().push!, recipientId: 'user-2' };
    expect(evaluatePoolPushRecipient(actors, malformedPush, 'user-1')).toEqual({
      kind: 'suppress_claim',
      reason: 'conflicting_claim',
    });
  });
});
