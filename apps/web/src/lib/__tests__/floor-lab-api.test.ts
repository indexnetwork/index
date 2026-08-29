import { describe, expect, test } from 'vitest';

import { mapFloorStatus, principalQuestion } from '@/lib/floor-lab-api';
import type { IntentCycleNegotiationDetail } from '@/services/conversation';

describe('mapFloorStatus', () => {
  test('maps pending opportunity to matched', () => {
    expect(mapFloorStatus('pending', 'paused', null)).toBe('matched');
  });

  test('maps needs_principal pause to negotiating', () => {
    expect(mapFloorStatus('negotiating', 'paused', { reason: 'needs_principal', by: 'yours' })).toBe('negotiating');
  });
});

describe('principalQuestion', () => {
  test('returns question text only for owner needs_principal pause', () => {
    const detail = {
      task: {
        pause: { reason: 'needs_principal', by: 'yours', payload: { question: 'Are you open to remote?' } },
      },
    } as IntentCycleNegotiationDetail;
    expect(principalQuestion(detail)).toBe('Are you open to remote?');
    expect(principalQuestion({ ...detail, task: { ...detail.task, pause: { reason: 'needs_principal', by: 'theirs' } } } as IntentCycleNegotiationDetail)).toBeNull();
  });
});
