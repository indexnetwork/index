import { describe, expect, it, mock } from 'bun:test';

import { appendOutcomeEvent, getOutcomeEventsForScope, type OutcomeEventsDb } from '../outcome-events.store';
import { opportunityOutcomeEvents } from '../../../schemas/database.schema';

const row = {
  recipientUserId: 'owner-1',
  intentId: 'intent-1',
  intentFingerprint: 'fp-1',
  opportunityId: 'opp-1',
  networkId: 'net-1',
  action: 'accepted',
  candidateSnapshot: 'snap',
  snapshotHash: 'h',
  dedupKey: 'd',
  idempotencyKey: 'idem-1',
};

describe('appendOutcomeEvent', () => {
  it('inserts idempotently on the idempotency-key unique index', async () => {
    const captured: { target?: unknown } = {};
    const returning = mock(async () => [{ id: 'new-1' }]);
    const onConflictDoNothing = mock((opts: { target: unknown }) => {
      captured.target = opts.target;
      return { returning };
    });
    const values = mock(() => ({ onConflictDoNothing }));
    const insert = mock(() => ({ values }));
    const db = { insert, select: mock() } as unknown as OutcomeEventsDb;

    const wroteNew = await appendOutcomeEvent(row, db);

    expect(wroteNew).toBe(true);
    expect(insert.mock.calls[0][0]).toBe(opportunityOutcomeEvents);
    expect(values.mock.calls[0][0]).toBe(row);
    expect(captured.target).toBe(opportunityOutcomeEvents.idempotencyKey);
  });

  it('reports a duplicate (no new row) when the conflict target already exists', async () => {
    const returning = mock(async () => []); // onConflictDoNothing suppressed the insert
    const db = {
      insert: mock(() => ({ values: mock(() => ({ onConflictDoNothing: mock(() => ({ returning })) })) })),
      select: mock(),
    } as unknown as OutcomeEventsDb;

    expect(await appendOutcomeEvent(row, db)).toBe(false);
  });
});

describe('getOutcomeEventsForScope', () => {
  it('filters by recipient + intent + fingerprint and orders oldest-first', async () => {
    const orderBy = mock(async () => [{ id: 'e1' }]);
    const where = mock(() => ({ orderBy }));
    const from = mock(() => ({ where }));
    const select = mock(() => ({ from }));
    const db = { insert: mock(), select } as unknown as OutcomeEventsDb;

    const result = await getOutcomeEventsForScope('owner-1', 'intent-1', 'fp-1', db);

    expect(result).toEqual([{ id: 'e1' }] as never);
    expect(from.mock.calls[0][0]).toBe(opportunityOutcomeEvents);
    expect(where.mock.calls.length).toBe(1);
    expect(orderBy.mock.calls.length).toBe(1);
  });
});
