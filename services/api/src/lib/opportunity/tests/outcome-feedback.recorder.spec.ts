import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';

import type { Opportunity } from '@indexnetwork/protocol';

import { OutcomeFeedbackRecorder, type OutcomeFeedbackRecorderDeps, type OutcomeFeedbackRecord } from '../outcome-feedback.recorder';

function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * By default the recipient actor owns intent `intent-1`, with a single
 * non-introducer counterpart `counter-1`. Override actors/interpretation to
 * exercise the exclusion paths.
 */
function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    detection: { triggeredBy: 'intent-counter' },
    actors: [
      { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
      { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
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
    // Raw intent read: owned by owner-1 by default.
    getIntent: mock(async () => ({ payload: 'build hardware', summary: null, userId: 'owner-1' })),
    triggerMine: mock(() => {}),
    ...overrides,
  };
}

function record(overrides: Partial<OutcomeFeedbackRecord> = {}): OutcomeFeedbackRecord {
  return {
    opportunity: opportunity(),
    recipientUserId: 'owner-1',
    action: 'accepted',
    provenance: 'user_session',
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.OUTCOME_QUESTIONS_MODE;
});

describe('OutcomeFeedbackRecorder.prepare — eligibility', () => {
  it('returns null when OUTCOME_QUESTIONS_MODE is off (default)', async () => {
    const d = deps();
    const out = await new OutcomeFeedbackRecorder(d).prepare(record());
    expect(out).toBeNull();
    expect((d.getIntent as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('excludes API-key / agent provenance (only verified human sessions are labels)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps();
    const out = await new OutcomeFeedbackRecorder(d).prepare(record({ provenance: 'api_key' }));
    expect(out).toBeNull();
    expect((d.getIntent as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('excludes a caller who is not an actor on the opportunity', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const out = await new OutcomeFeedbackRecorder(deps()).prepare(record({ recipientUserId: 'stranger' }));
    expect(out).toBeNull();
  });

  it('excludes an introducer actor', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const opp = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'introducer', intent: 'intent-1' },
        { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
      ] as unknown as Opportunity['actors'],
    });
    const out = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: opp }));
    expect(out).toBeNull();
  });

  it('excludes when the recipient actor contributed no intent (no own-intent scope)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const opp = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient' },
        { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
      ] as unknown as Opportunity['actors'],
    });
    const out = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: opp }));
    expect(out).toBeNull();
  });

  it('excludes a counterparty-owned intent (intent.userId != recipient)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps({ getIntent: mock(async () => ({ payload: 'x', summary: null, userId: 'counter-1' })) });
    const out = await new OutcomeFeedbackRecorder(d).prepare(record());
    expect(out).toBeNull();
  });

  it('excludes when the scoping intent no longer resolves', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps({ getIntent: mock(async () => null) });
    const out = await new OutcomeFeedbackRecorder(d).prepare(record());
    expect(out).toBeNull();
  });

  it('excludes counterpart-less opportunities (never falls back to opportunity id)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const opp = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        // only an introducer besides the owner — no genuine counterpart
        { networkId: 'net-2', userId: 'intro-1', role: 'introducer', intent: 'intent-x' },
      ] as unknown as Opportunity['actors'],
    });
    const out = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: opp }));
    expect(out).toBeNull();
  });
});

describe('OutcomeFeedbackRecorder.prepare — event shape', () => {
  it('builds an idempotent, counterpart-scoped event for an explicit owner action', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const out = await new OutcomeFeedbackRecorder(deps()).prepare(record());
    expect(out).not.toBeNull();
    const { event, scope } = out!;
    expect(event.recipientUserId).toBe('owner-1');
    expect(event.intentId).toBe('intent-1'); // recipient's OWN intent, not triggeredBy
    expect(event.opportunityId).toBe('opp-1');
    expect(event.action).toBe('accepted');
    expect(event.networkId).toBe('net-1');
    expect(event.idempotencyKey).toBe(sha256(['outcome', 'owner-1', 'opp-1', 'accepted']));
    // Independence key is the canonical counterpart SET, never the opportunity id.
    expect(event.dedupKey).toBe(sha256(['counterpart-set', 'counter-1']));
    expect(event.candidateSnapshot.length).toBeGreaterThan(0);
    expect(event.snapshotHash).toBe(sha256(['snapshot', event.candidateSnapshot]));
    expect(scope).toEqual({ recipientUserId: 'owner-1', intentId: 'intent-1', intentFingerprint: event.intentFingerprint });
  });

  it('uses a deterministic canonical set for multiple counterparts (order-independent)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const build = (order: string[]) => opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        ...order.map((u) => ({ networkId: 'net-x', userId: u, role: 'agent', intent: 'i' })),
      ] as unknown as Opportunity['actors'],
    });
    const a = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: build(['c-b', 'c-a']) }));
    const b = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: build(['c-a', 'c-b']) }));
    expect(a!.event.dedupKey).toBe(b!.event.dedupKey);
    expect(a!.event.dedupKey).toBe(sha256(['counterpart-set', 'c-a', 'c-b']));
  });

  it('produces a stable idempotency key across retries of the same action', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const rec = new OutcomeFeedbackRecorder(deps());
    const a = await rec.prepare(record({ action: 'rejected' }));
    const b = await rec.prepare(record({ action: 'rejected' }));
    expect(a!.event.idempotencyKey).toBe(b!.event.idempotencyKey);
  });

  it('propagates preparation failures so no eligible action can commit without its event', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const d = deps({ getIntent: mock(async () => { throw new Error('db down'); }) });
    await expect(new OutcomeFeedbackRecorder(d).prepare(record())).rejects.toThrow('db down');
    expect((d.triggerMine as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});
