import { afterEach, describe, expect, it, mock } from 'bun:test';

import { emitOpportunityPendingBestEffort, emitOpportunityTransitionBestEffort, OpportunityEvents, type PendingOpportunityEvent } from '../opportunity.event';

function row(status: string): PendingOpportunityEvent {
  return { id: 'opp', status };
}

const originalPending = OpportunityEvents.onPending;
const originalActionable = OpportunityEvents.onActionable;
const originalTransition = OpportunityEvents.onTransition;
afterEach(() => {
  OpportunityEvents.onPending = originalPending;
  OpportunityEvents.onActionable = originalActionable;
  OpportunityEvents.onTransition = originalTransition;
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

describe('OpportunityEvents transition emission', () => {
  it('fires the transition hook for every status, including terminal ones', async () => {
    const transitions: string[] = [];
    OpportunityEvents.onTransition = async ({ opportunity }) => { transitions.push(opportunity.status); };
    const statuses = ['latent', 'draft', 'negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired'];
    for (const status of statuses) emitOpportunityTransitionBestEffort(row(status));
    await Promise.resolve();
    expect(transitions).toEqual(statuses);
  });

  it('never fires the pending/actionable hooks and swallows handler failures', async () => {
    const pending = mock(async () => {});
    const actionable = mock(async () => {});
    OpportunityEvents.onPending = pending;
    OpportunityEvents.onActionable = actionable;
    OpportunityEvents.onTransition = () => { throw new Error('sync'); };
    expect(() => emitOpportunityTransitionBestEffort(row('rejected'))).not.toThrow();
    OpportunityEvents.onTransition = async () => { throw new Error('async'); };
    expect(() => emitOpportunityTransitionBestEffort(row('pending'))).not.toThrow();
    await Promise.resolve();
    expect(pending).not.toHaveBeenCalled();
    expect(actionable).not.toHaveBeenCalled();
  });
});
