import { afterEach, describe, expect, it, mock } from 'bun:test';

import { emitOpportunityLifecycleBestEffort, OpportunityEvents, type PendingOpportunityEvent } from '../opportunity.event';

function row(status: string): PendingOpportunityEvent {
  return { id: 'opp', status };
}

const originalPending = OpportunityEvents.onPending;
const originalActionable = OpportunityEvents.onActionable;

afterEach(() => {
  OpportunityEvents.onPending = originalPending;
  OpportunityEvents.onActionable = originalActionable;
});

describe('OpportunityEvents lifecycle emission', () => {
  it('emits actionable for latent and pending rows while pending remains pending-only', () => {
    const pending = mock(() => {});
    const actionable = mock(() => {});
    OpportunityEvents.onPending = pending;
    OpportunityEvents.onActionable = actionable;

    emitOpportunityLifecycleBestEffort(row('latent'));
    expect(actionable).toHaveBeenCalledTimes(1);
    expect(pending).not.toHaveBeenCalled();

    emitOpportunityLifecycleBestEffort(row('pending'));
    expect(actionable).toHaveBeenCalledTimes(2);
    expect(pending).toHaveBeenCalledTimes(1);
  });
});
