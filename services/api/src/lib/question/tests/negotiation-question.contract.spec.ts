import { describe, expect, it } from 'bun:test';

import { isValidNegotiationDetectionContract } from '../negotiation-question.contract';
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
  it('accepts only the matching inflight mode/purpose', () => {
    expect(isValidNegotiationDetectionContract(detection('negotiation_inflight', 'inflight_consultation'), provenance)).toBe(true);
    expect(isValidNegotiationDetectionContract(detection('negotiation', 'inflight_consultation'), provenance)).toBe(false);
    expect(isValidNegotiationDetectionContract(detection('negotiation_inflight', 'uptake'), provenance)).toBe(false);
  });

});
