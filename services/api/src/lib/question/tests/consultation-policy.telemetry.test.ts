import { describe, expect, it } from 'bun:test';
import type { QuestionerInput } from '@indexnetwork/protocol';

import { emitConsultationDeliveredTelemetry } from '../consultation-policy.telemetry';

const policyInput: QuestionerInput = {
  mode: 'negotiation_inflight',
  purpose: 'inflight_consultation',
  userId: 'user-1',
  sourceType: 'opportunity',
  sourceId: 'opportunity-1',
  negotiation: {
    purpose: 'inflight_consultation',
    recipientUserId: 'user-1',
    recipientIntentId: 'intent-1',
    opportunityId: 'opportunity-1',
    taskId: 'task-1',
    networkId: 'network-1',
  },
  context: {
    negotiationId: 'task-1',
    counterpartyHint: 'the other participant',
    disclosureSubject: 'your permission',
    draftQuestion: 'May we share the information needed to explore this collaboration?',
    indexContext: 'the selected network',
    consultationPolicyReason: 'consequential_disclosure_permission',
  },
};

describe('consultation delivery telemetry', () => {
  it('emits one content-free delivered event after successful persistence', () => {
    const events: unknown[] = [];

    emitConsultationDeliveredTelemetry(policyInput, { state: 'persisted', ids: ['question-1'] }, (event) => events.push(event));

    expect(events).toEqual([{ stage: 'delivered', reason: 'consequential_disclosure_permission' }]);
    expect(JSON.stringify(events)).not.toContain('question-1');
    expect(JSON.stringify(events)).not.toContain('May we share');
  });

  it.each([
    { state: 'no_rows' as const },
    { state: 'rejected' as const },
    { state: 'failed' as const },
    { state: 'persisted' as const, ids: [] },
  ])('does not claim delivery for %o persistence', (outcome) => {
    const events: unknown[] = [];

    emitConsultationDeliveredTelemetry(policyInput, outcome, (event) => events.push(event));

    expect(events).toEqual([]);
  });

  it('does not claim delivery for a legacy inflight question without a policy category', () => {
    const events: unknown[] = [];
    const legacy = {
      ...policyInput,
      context: {
        ...policyInput.context,
        consultationPolicyReason: undefined,
      },
    } as QuestionerInput;

    emitConsultationDeliveredTelemetry(legacy, { state: 'persisted', ids: ['question-1'] }, (event) => events.push(event));

    expect(events).toEqual([]);
  });
});
