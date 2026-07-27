import { describe, expect, it } from 'bun:test';

import { derivePendingQuestionCounts, isSafeNegotiationQuestionPayload, isValidNegotiationDetectionContract } from '../negotiation-question.contract';
import type { AdapterNegotiationQuestionProvenance, AdapterQuestionDetection } from '../../../adapters/questioner.adapter';

const provenance: AdapterNegotiationQuestionProvenance = {
  version: 1,
  purpose: 'inflight_consultation',
  recipientUserId: 'user-1',
  recipientIntentId: 'intent-1',
  opportunityId: 'opp-1',
  taskId: 'task-1',
  networkId: 'network-1',
  intentFingerprint: 'fingerprint-1',
  opportunityStatus: 'negotiating',
  opportunityUpdatedAt: '2026-07-23T00:00:00.000Z',
  taskState: 'input_required',
  taskUpdatedAt: '2026-07-23T00:00:01.000Z',
  questionOrdinal: 0,
};

function detection(mode: AdapterQuestionDetection['mode'], purpose: AdapterQuestionDetection['purpose']): AdapterQuestionDetection {
  return {
    mode,
    purpose,
    negotiation: provenance,
    sourceType: 'opportunity',
    sourceId: 'opp-1',
    timestamp: '2026-07-23T00:00:02.000Z',
  };
}

describe('final negotiation question contract', () => {
  it('derives global/pushed/personal counts only from already validated pending rows', () => {
    expect(derivePendingQuestionCounts([
      { detection: { mode: 'intent' } },
      { detection: { mode: 'negotiation_inflight' } },
      { detection: { mode: 'pool_discovery', pushedAt: '2026-07-23T00:00:00.000Z' } },
      { detection: { mode: 'pool_discovery' } },
    ])).toEqual({ globalPending: 2, pushedPoolPending: 1, personalAgentPending: 3 });
  });

  it('accepts only the matching inflight mode/purpose', () => {
    expect(isValidNegotiationDetectionContract(detection('negotiation_inflight', 'inflight_consultation'), provenance)).toBe(true);
    expect(isValidNegotiationDetectionContract(detection('negotiation', 'inflight_consultation'), provenance)).toBe(false);
    expect(isValidNegotiationDetectionContract(detection('negotiation_inflight', 'uptake'), provenance)).toBe(false);
  });

  it.each([
    { field: 'title', value: "Alice's profile" },
    { field: 'prompt', value: 'Use PRIVATE TRANSCRIPT matchReason' },
    { field: 'label', value: 'opportunityId 123e4567-e89b-12d3-a456-426614174000' },
    { field: 'description', value: 'They both attended the same event' },
    { field: 'evidence', value: 'internal taskId' },
  ])('rejects unsafe visible $field content', ({ field, value }) => {
    const payload = {
      title: 'Permission',
      prompt: 'May I share this detail?',
      options: [
        { label: 'Share', description: 'Share it' },
        { label: 'Private', description: 'Keep it private' },
      ],
      multiSelect: false,
    };
    if (field === 'title' || field === 'prompt' || field === 'evidence') {
      Object.assign(payload, { [field]: value });
    } else {
      Object.assign(payload.options[0], { [field]: value });
    }
    expect(isSafeNegotiationQuestionPayload(payload)).toBe(false);
  });
});
