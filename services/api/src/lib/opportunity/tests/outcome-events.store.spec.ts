import { describe, expect, it, mock } from 'bun:test';

import { getOutcomeEventsForScope, type OutcomeEventsDb } from '../outcome-events.store';
import { opportunityOutcomeEvents } from '../../../schemas/database.schema';

describe('getOutcomeEventsForScope', () => {
  it('filters by recipient + intent + fingerprint and orders oldest-first', async () => {
    const orderBy = mock(async () => [{ id: 'e1' }]);
    const where = mock(() => ({ orderBy }));
    const from = mock(() => ({ where }));
    const select = mock(() => ({ from }));
    const db = { select } as unknown as OutcomeEventsDb;

    const result = await getOutcomeEventsForScope('owner-1', 'intent-1', 'fp-1', db);

    expect(result).toEqual([{ id: 'e1' }] as never);
    expect(from.mock.calls[0][0]).toBe(opportunityOutcomeEvents);
    expect(where.mock.calls.length).toBe(1);
    expect(orderBy.mock.calls.length).toBe(1);
  });
});
