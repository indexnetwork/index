import { afterEach, describe, expect, it, mock } from 'bun:test';

import { emitOpportunityPendingBestEffort, OpportunityEvents, type PendingOpportunityEvent } from '../opportunity.event';

function row(status: string): PendingOpportunityEvent {
  return { id: 'opp', status };
}

const originalPending = OpportunityEvents.onPending;
const originalActionable = OpportunityEvents.onActionable;
afterEach(() => {
  OpportunityEvents.onPending = originalPending;
  OpportunityEvents.onActionable = originalActionable;
});

describe('OpportunityEvents pending emission', () => {
  it('preserves the deprecated helper as pending-only', async () => {
    const pending = mock(async () => {});
    const actionable = mock(async () => {});
    OpportunityEvents.onPending = pending;
    OpportunityEvents.onActionable = actionable;
    emitOpportunityPendingBestEffort(row('pending'));
    emitOpportunityPendingBestEffort(row('latent'));
    emitOpportunityPendingBestEffort(row('draft'));
    await Promise.resolve();
    expect(pending).toHaveBeenCalledTimes(1);
    expect(pending.mock.calls[0][0].opportunity.id).toBe('opp');
    expect(actionable).not.toHaveBeenCalled();
  });

  it('swallows synchronous and asynchronous handler failures', async () => {
    OpportunityEvents.onPending = () => { throw new Error('sync'); };
    expect(() => emitOpportunityPendingBestEffort(row('pending'))).not.toThrow();
    OpportunityEvents.onPending = async () => { throw new Error('async'); };
    expect(() => emitOpportunityPendingBestEffort(row('pending'))).not.toThrow();
    await Promise.resolve();
  });
});
