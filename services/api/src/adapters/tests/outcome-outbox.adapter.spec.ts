import { describe, expect, it, mock } from 'bun:test';

import type { OutcomeOutbox } from '@indexnetwork/protocol';

import { applyOutcomeOutbox, runAtomicOutcomeTransition, type AtomicTransactionRunner } from '../opportunity.database.adapter';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { computeOutcomeCounterpartDedupKey, computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash } from '../../lib/opportunity/outcome-feedback.identity';
import { opportunityOutcomeEvents, type OpportunityActor } from '../../schemas/database.schema';

const recipientUserId = 'owner-1';
const intentId = 'intent-1';
const opportunityId = 'opp-1';
const intentPayload = 'build hardware';
const intentFingerprint = computeIntentFingerprint(intentPayload, null);
const candidateSnapshot = 'Presenter-approved summary.';

const actors: OpportunityActor[] = [
  { networkId: 'network-1', userId: recipientUserId, role: 'patient', intent: intentId },
  { networkId: 'network-1', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
];

function outbox(overrides: Partial<OutcomeOutbox> = {}): OutcomeOutbox {
  return {
    event: {
      recipientUserId,
      intentId,
      intentFingerprint,
      opportunityId,
      networkId: 'network-1',
      action: 'accepted',
      candidateSnapshot,
      snapshotHash: computeOutcomeSnapshotHash(candidateSnapshot),
      dedupKey: computeOutcomeCounterpartDedupKey(recipientUserId, 'counter-1'),
      idempotencyKey: computeOutcomeIdempotencyKey({
        recipientUserId,
        intentId,
        intentFingerprint,
        opportunityId,
        action: 'accepted',
      }),
    },
    actorResolution: 'unique_owned_scope',
    result: { inserted: false },
    ...overrides,
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
  function harness(options: {
    duplicate?: boolean;
    failInsert?: boolean;
    lockedIntentPayload?: string;
  } = {}) {
    const state = {
      status: 'pending',
      events: options.duplicate
        ? [(outbox().event as { idempotencyKey: string }).idempotencyKey]
        : [] as string[],
    };
    const database: AtomicTransactionRunner = {
      async transaction<T>(callback: (tx: Parameters<typeof applyOutcomeOutbox>[0]) => Promise<T>): Promise<T> {
        const before = { status: state.status, events: [...state.events] };
        const select = mock(() => ({
          from: mock(() => ({
            where: mock(() => ({
              for: mock(async () => [{
                payload: options.lockedIntentPayload ?? intentPayload,
                summary: null,
                userId: recipientUserId,
              }]),
            })),
          })),
        }));
        const tx = {
          select,
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
          state.status = before.status;
          state.events = before.events;
          throw error;
        }
      },
    };
    return { state, database };
  }

  it('commits the winning status and exactly one revalidated event together', async () => {
    const box = outbox();
    const { state, database } = harness();

    const result = await runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: opportunityId, actors };
      },
      box,
    );

    expect(result).toEqual({ id: opportunityId, actors });
    expect(state.events).toHaveLength(1);
    expect(state.status).toBe('accepted');
    expect(box.result.inserted).toBe(true);
  });

  it('rolls the status back when the event insert fails', async () => {
    const box = outbox();
    const { state, database } = harness({ failInsert: true });

    await expect(runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: opportunityId, actors };
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
        return { id: opportunityId, actors };
      },
      box,
    );

    expect(state.events).toHaveLength(1);
    expect(state.status).toBe('accepted');
    expect(box.result.inserted).toBe(false);
  });

  it('rolls back both action and event when the locked intent revision drifted after preparation', async () => {
    const box = outbox();
    const { state, database } = harness({ lockedIntentPayload: 'materially revised intent' });

    await expect(runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: opportunityId, actors };
      },
      box,
    )).rejects.toThrow('Outcome capture precondition failed');

    expect(state).toEqual({ status: 'pending', events: [] });
    expect(box.result.inserted).toBe(false);
  });

  it('rolls back an unscoped capture when recipient actor scopes become ambiguous', async () => {
    const box = outbox();
    const { state, database } = harness();
    const driftedActors: OpportunityActor[] = [
      ...actors,
      { networkId: 'network-2', userId: recipientUserId, role: 'patient', intent: 'intent-2' },
    ];

    await expect(runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: opportunityId, actors: driftedActors };
      },
      box,
    )).rejects.toThrow('Outcome capture precondition failed');

    expect(state).toEqual({ status: 'pending', events: [] });
  });

  it('allows exact selected-intent capture despite other recipient actor scopes', async () => {
    const box = outbox({ actorResolution: 'selected_intent' });
    const { state, database } = harness();
    const duplicateScopes: OpportunityActor[] = [
      ...actors,
      { networkId: 'network-2', userId: recipientUserId, role: 'patient', intent: 'intent-2' },
    ];

    await runAtomicOutcomeTransition(
      database,
      async () => {
        state.status = 'accepted';
        return { id: opportunityId, actors: duplicateScopes };
      },
      box,
    );

    expect(state.status).toBe('accepted');
    expect(state.events).toHaveLength(1);
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
