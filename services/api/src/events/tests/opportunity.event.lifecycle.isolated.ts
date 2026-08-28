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
  it('ignores non-actionable lifecycle statuses', () => {
    const pending = mock(() => {});
    const actionable = mock(() => {});
    OpportunityEvents.onPending = pending;
    OpportunityEvents.onActionable = actionable;

    for (const status of ['draft', 'negotiating', 'accepted', 'rejected', 'expired']) {
      emitOpportunityLifecycleBestEffort(row(status));
    }

    expect(actionable).not.toHaveBeenCalled();
    expect(pending).not.toHaveBeenCalled();
  });

  it('fails open when the actionable handler throws or rejects', async () => {
    OpportunityEvents.onActionable = () => { throw new Error('sync'); };
    expect(() => emitOpportunityLifecycleBestEffort(row('latent'))).not.toThrow();

    OpportunityEvents.onActionable = async () => { throw new Error('async'); };
    expect(() => emitOpportunityLifecycleBestEffort(row('latent'))).not.toThrow();
    await Promise.resolve();
  });
});
