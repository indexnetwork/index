import { describe, expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { QuestionerAdapter, evaluatePoolPushRecipient, isRecoverablePoolPushDetection, poolPushCycleClaimPredicate, terminalizePoolPushRequestDetection, type AdapterQuestionDetection } from '../questioner.adapter';

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
  test('recovery selection atomically rotates by least recent attempt with never-attempted first', async () => {
    let captured: SQL | undefined;
    const adapter = new QuestionerAdapter({
      execute: async (query: SQL) => {
        captured = query;
        return [];
      },
    } as never);

    expect(await adapter.listRecoverablePoolQuestionPushRequests(17)).toEqual([]);
    const rendered = new PgDialect().sqlToQuery(captured!);
    const query = rendered.sql.replace(/\s+/g, ' ').trim();

    expect(rendered.params).toEqual([17]);
    expect(query).toContain("WHERE recovery_candidate.detection->>'pushRequestStatus' = 'requested'");
    expect(query).toContain("recovery_candidate.detection->'push'->>'deliveryStatus' = 'claimed'");
    expect(query).toContain("ORDER BY recovery_candidate.detection->>'pushRecoveryAttemptedAt' ASC NULLS FIRST, recovery_candidate.detection->>'pushRequestedAt' ASC NULLS FIRST, recovery_candidate.created_at ASC, recovery_candidate.id ASC LIMIT $1 FOR UPDATE SKIP LOCKED");
    expect(query).toContain("UPDATE questions AS recovery_question SET detection = jsonb_set( recovery_question.detection, '{pushRecoveryAttemptedAt}'");
    expect(query).toContain('FROM selected WHERE recovery_question.id = selected.id RETURNING');
    expect(query).not.toContain("ORDER BY recovery_candidate.detection->>'pushRequestedAt' ASC NULLS FIRST");
  });

  test('same-cycle lookup keys only authoritative stamped push metadata', () => {
    const rendered = new PgDialect().sqlToQuery(
      poolPushCycleClaimPredicate('user-1', 'intent-1', 'run:run-1'),
    );
    expect(rendered.params).toEqual(['user-1', 'intent-1', 'run:run-1']);
    expect(rendered.sql.replace(/\s+/g, ' ').trim()).toBe(
      '("questions"."detection"->\'push\'->>\'recipientId\' = $1 and "questions"."detection"->\'push\'->>\'intentId\' = $2 and "questions"."detection"->\'push\'->>\'cycleKey\' = $3 and "questions"."detection"->>\'mode\' = \'pool_discovery\' and "questions"."detection"->\'push\'->>\'claimedAt\' IS NOT NULL)',
    );
    expect(rendered.sql).not.toContain('triggeredBy');
    expect(rendered.sql).not.toContain('actors');
  });

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
