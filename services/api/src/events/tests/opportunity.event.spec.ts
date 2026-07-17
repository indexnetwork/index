import { afterEach, describe, expect, it, mock } from 'bun:test';

import { emitOpportunityPendingBestEffort, OpportunityEvents, type PendingOpportunityEvent } from '../opportunity.event';

function row(status: string): PendingOpportunityEvent {
  return { id: 'opp', status };
}

const original = OpportunityEvents.onPending;
afterEach(() => { OpportunityEvents.onPending = original; });

describe('OpportunityEvents pending emission', () => {
  it('emits only pending rows', async () => {
    const handler = mock(async () => {});
    OpportunityEvents.onPending = handler;
    emitOpportunityPendingBestEffort(row('pending'));
    emitOpportunityPendingBestEffort(row('draft'));
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].opportunity.id).toBe('opp');
  });

  it('swallows synchronous and asynchronous handler failures', async () => {
    OpportunityEvents.onPending = () => { throw new Error('sync'); };
    expect(() => emitOpportunityPendingBestEffort(row('pending'))).not.toThrow();
    OpportunityEvents.onPending = async () => { throw new Error('async'); };
    expect(() => emitOpportunityPendingBestEffort(row('pending'))).not.toThrow();
    await Promise.resolve();
  });
});
