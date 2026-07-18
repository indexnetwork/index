import { describe, expect, it, mock } from 'bun:test';

import type { OutcomeOutbox } from '@indexnetwork/protocol';

import { applyOutcomeOutbox, runAtomicOutcomeTransition, type AtomicTransactionRunner } from '../opportunity.database.adapter';
import { opportunityOutcomeEvents } from '../../schemas/database.schema';

function outbox(): OutcomeOutbox {
  return {
    event: {
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: 'fingerprint-1',
      opportunityId: 'opp-1',
      networkId: 'network-1',
      action: 'accepted',
      candidateSnapshot: 'safe snapshot',
      snapshotHash: 'snapshot-hash',
      dedupKey: 'counterpart-hash',
      idempotencyKey: 'idempotency-hash',
    },
    result: { inserted: false },
  };
}

function transactionReturning(rows: Array<{ id: string }>) {
  const returning = mock(async () => rows);
  const onConflictDoNothing = mock(() => ({ returning }));
  const values = mock(() => ({ onConflictDoNothing }));
  const insert = mock(() => ({ values }));
  return {
    tx: { insert } as unknown as Parameters<typeof applyOutcomeOutbox>[0],
    insert,
    values,
    onConflictDoNothing,
  };
}

describe('runAtomicOutcomeTransition', () => {
  function harness(options: { duplicate?: boolean; failInsert?: boolean } = {}) {
    const state = {
      status: 'pending',
      events: options.duplicate ? ['idempotency-hash'] : [] as string[],
    };
    const database: AtomicTransactionRunner = {
      async transaction<T>(callback: (tx: Parameters<typeof applyOutcomeOutbox>[0]) => Promise<T>): Promise<T> {
        const before = { status: state.status, events: [...state.events] };
        const tx = {
          insert: mock(() => ({
            values: mock((event: { idempotencyKey: string }) => ({
              onConflictDoNothing: mock(() => ({
                returning: mock(async () => {
                  if (options.failInsert) throw new Error('insert failed');
                  if (state.events.includes(event.idempotencyKey)) return [];
                  state.events.push(event.idempotencyKey);
                  return [{ id: 'event-1' }];
                }),
              })),
            })),
          })),
        } as unknown as Parameters<typeof applyOutcomeOutbox>[0];
        try {
          return await callback(tx);
        } catch (error) {
          // Model database transaction rollback for the test harness.
          state.status = before.status;
          state.events = before.events;
          throw error;
        }
      },
    };
    return { state, database };
  }

  it('commits the winning status and exactly one event together', async () => {
    const box = outbox();
    const { state, database } = harness();

    const result = await runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: 'opp-1' };
      },
      box,
    );

    expect(result).toEqual({ id: 'opp-1' });
    expect(state).toEqual({ status: 'accepted', events: ['idempotency-hash'] });
    expect(box.result.inserted).toBe(true);
  });

  it('rolls the status back when the event insert fails', async () => {
    const box = outbox();
    const { state, database } = harness({ failInsert: true });

    await expect(runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: 'opp-1' };
      },
      box,
    )).rejects.toThrow('insert failed');

    expect(state).toEqual({ status: 'pending', events: [] });
    expect(box.result.inserted).toBe(false);
  });

  it('commits a duplicate retry without another event or mining signal', async () => {
    const box = outbox();
    const { state, database } = harness({ duplicate: true });

    await runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: 'opp-1' };
      },
      box,
    );

    expect(state).toEqual({ status: 'accepted', events: ['idempotency-hash'] });
    expect(box.result.inserted).toBe(false);
  });
});

describe('applyOutcomeOutbox', () => {
  it('marks a genuinely new same-transaction event as inserted', async () => {
    const box = outbox();
    const fake = transactionReturning([{ id: 'event-1' }]);

    await applyOutcomeOutbox(fake.tx, box);

    expect(box.result.inserted).toBe(true);
    expect(fake.insert).toHaveBeenCalledWith(opportunityOutcomeEvents);
    expect(fake.values).toHaveBeenCalledWith(box.event);
    expect(fake.onConflictDoNothing).toHaveBeenCalledWith({
      target: opportunityOutcomeEvents.idempotencyKey,
    });
  });

  it('marks an idempotent duplicate as not inserted', async () => {
    const box = outbox();
    const fake = transactionReturning([]);

    await applyOutcomeOutbox(fake.tx, box);

    expect(box.result.inserted).toBe(false);
  });

  it('propagates insert failure so the enclosing status transaction rolls back', async () => {
    const box = outbox();
    const returning = mock(async () => { throw new Error('insert failed'); });
    const tx = {
      insert: mock(() => ({
        values: mock(() => ({
          onConflictDoNothing: mock(() => ({ returning })),
        })),
      })),
    } as unknown as Parameters<typeof applyOutcomeOutbox>[0];

    await expect(applyOutcomeOutbox(tx, box)).rejects.toThrow('insert failed');
    expect(box.result.inserted).toBe(false);
  });
});
