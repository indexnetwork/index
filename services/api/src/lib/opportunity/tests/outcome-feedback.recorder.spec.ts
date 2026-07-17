import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';

import type { Opportunity } from '@indexnetwork/protocol';

import { OutcomeFeedbackRecorder, type OutcomeFeedbackRecorderDeps } from '../outcome-feedback.recorder';

function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    detection: { triggeredBy: 'intent-1' },
    actors: [
      { networkId: 'net-1', userId: 'owner-1', role: 'patient' },
      { networkId: 'net-2', userId: 'counter-1', role: 'agent' },
    ],
    interpretation: { category: 'collab', reasoning: 'A strong mutual fit on hardware.', confidence: 80 },
    context: {},
    confidence: '0.8',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as unknown as Opportunity;
}

function deps(overrides: Partial<OutcomeFeedbackRecorderDeps> = {}): OutcomeFeedbackRecorderDeps {
  return {
    getIntent: mock(async () => ({ payload: 'build hardware', summary: null })),
    append: mock(async () => true),
    triggerMine: mock(() => {}),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.OUTCOME_QUESTIONS_MODE;
});

describe('OutcomeFeedbackRecorder', () => {
  it('writes nothing when OUTCOME_QUESTIONS_MODE is off (default)', async () => {
    const d = deps();
    await new OutcomeFeedbackRecorder(d).record({
      opportunity: opportunity(),
      recipientUserId: 'owner-1',
      action: 'accepted',
    });
    expect((d.append as ReturnType<typeof mock>).mock.calls.length).toBe(0);
    expect((d.getIntent as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('skips when the opportunity has no triggering intent (no scope)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps();
    await new OutcomeFeedbackRecorder(d).record({
      opportunity: opportunity({ detection: {} as Opportunity['detection'] }),
      recipientUserId: 'owner-1',
      action: 'accepted',
    });
    expect((d.append as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('appends one idempotent event and fires shadow mining on an explicit action', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps();
    await new OutcomeFeedbackRecorder(d).record({
      opportunity: opportunity(),
      recipientUserId: 'owner-1',
      action: 'accepted',
    });

    const appendCalls = (d.append as ReturnType<typeof mock>).mock.calls;
    expect(appendCalls.length).toBe(1);
    const row = appendCalls[0][0];
    expect(row.recipientUserId).toBe('owner-1');
    expect(row.intentId).toBe('intent-1');
    expect(row.opportunityId).toBe('opp-1');
    expect(row.action).toBe('accepted');
    expect(row.networkId).toBe('net-1'); // recipient actor's network
    // Idempotency key is deterministic over (recipient, opportunity, action).
    expect(row.idempotencyKey).toBe(sha256(['outcome', 'owner-1', 'opp-1', 'accepted']));
    // Dedup key is the (hashed) counterpart identity, not the opportunity.
    expect(row.dedupKey).toBe(sha256(['counterpart', 'counter-1']));
    // Snapshot is present, bounded, and never raw reasoning verbatim only.
    expect(row.candidateSnapshot.length).toBeGreaterThan(0);
    expect(row.snapshotHash).toBe(sha256(['snapshot', row.candidateSnapshot]));

    const mineCalls = (d.triggerMine as ReturnType<typeof mock>).mock.calls;
    expect(mineCalls.length).toBe(1);
    expect(mineCalls[0][0]).toEqual({
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: row.intentFingerprint,
    });
  });

  it('produces a stable idempotency key across retries of the same action', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps();
    const rec = new OutcomeFeedbackRecorder(d);
    await rec.record({ opportunity: opportunity(), recipientUserId: 'owner-1', action: 'rejected' });
    await rec.record({ opportunity: opportunity(), recipientUserId: 'owner-1', action: 'rejected' });
    const calls = (d.append as ReturnType<typeof mock>).mock.calls;
    expect(calls[0][0].idempotencyKey).toBe(calls[1][0].idempotencyKey);
  });

  it('is best-effort: a store failure never throws into the caller', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps({ append: mock(async () => { throw new Error('db down'); }) });
    await expect(
      new OutcomeFeedbackRecorder(d).record({
        opportunity: opportunity(),
        recipientUserId: 'owner-1',
        action: 'accepted',
      }),
    ).resolves.toBeUndefined();
    // Mining is not triggered when the append failed.
    expect((d.triggerMine as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});
