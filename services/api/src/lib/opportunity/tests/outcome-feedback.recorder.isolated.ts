import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createHash } from 'node:crypto';

import type { Opportunity } from '@indexnetwork/protocol';

import { OutcomeFeedbackRecorder, type OutcomeFeedbackRecorderDeps, type OutcomeFeedbackRecord } from '../outcome-feedback.recorder';

function sha256(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'opp-1',
    detection: { triggeredBy: 'intent-counter' },
    actors: [
      { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
      { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
    ],
    interpretation: {
      category: 'collab',
      reasoning: 'PRIVATE EVALUATOR RATIONALE: hidden evidence says this should match.',
      confidence: 80,
    },
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
    getIntent: mock(async () => ({ payload: 'build hardware', summary: null, userId: 'owner-1' })),
    getApprovedCandidateSnapshot: mock(async () => 'Presenter-approved recipient summary.'),
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

beforeEach(() => {
});

afterEach(() => {
});

describe('OutcomeFeedbackRecorder.prepare — eligibility', () => {
  it('excludes API-key / agent provenance', async () => {
    const d = deps();
    expect(await new OutcomeFeedbackRecorder(d).prepare(record({ provenance: 'api_key' }))).toBeNull();
    expect(d.getIntent).not.toHaveBeenCalled();
  });

  it('excludes a caller who is not a non-introducer actor', async () => {
    expect(await new OutcomeFeedbackRecorder(deps()).prepare(record({ recipientUserId: 'stranger' }))).toBeNull();
    const introduced = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'introducer', intent: 'intent-1' },
        { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
      ] as unknown as Opportunity['actors'],
    });
    expect(await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: introduced }))).toBeNull();
  });

  it('excludes missing, unresolvable, or counterparty-owned recipient intent scopes', async () => {
    const noIntent = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient' },
        { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
      ] as unknown as Opportunity['actors'],
    });
    expect(await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: noIntent }))).toBeNull();
    expect(await new OutcomeFeedbackRecorder(deps({ getIntent: mock(async () => null) })).prepare(record())).toBeNull();
    expect(await new OutcomeFeedbackRecorder(deps({
      getIntent: mock(async () => ({ payload: 'x', summary: null, userId: 'counter-1' })),
    })).prepare(record())).toBeNull();
  });

  it('fails closed when no presentation-approved snapshot exists and never uses evaluator reasoning', async () => {
    const d = deps({ getApprovedCandidateSnapshot: mock(async () => null) });
    const result = await new OutcomeFeedbackRecorder(d).prepare(record());
    expect(result).toBeNull();
    expect(d.getApprovedCandidateSnapshot).toHaveBeenCalledTimes(1);
    expect(d.triggerMine).not.toHaveBeenCalled();
  });

  it('skips zero-counterpart and multiparty opportunities', async () => {
    const zero = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        { networkId: 'net-2', userId: 'intro-1', role: 'introducer', intent: 'intent-x' },
      ] as unknown as Opportunity['actors'],
    });
    const multiple = opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
        { networkId: 'net-3', userId: 'counter-2', role: 'agent', intent: 'intent-counter-2' },
      ] as unknown as Opportunity['actors'],
    });
    expect(await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: zero }))).toBeNull();
    expect(await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: multiple }))).toBeNull();
  });
});

describe('OutcomeFeedbackRecorder.prepare — actor scope resolution', () => {
  const duplicateScopeActors = [
    { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
    { networkId: 'net-2', userId: 'owner-1', role: 'patient', intent: 'intent-2' },
    { networkId: 'net-3', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
  ] as unknown as Opportunity['actors'];

  it('fails closed without an exact scope when duplicate recipient actor intents exist', async () => {
    const d = deps();
    expect(await new OutcomeFeedbackRecorder(d).prepare(record({
      opportunity: opportunity({ actors: duplicateScopeActors }),
    }))).toBeNull();
    expect(d.getIntent).not.toHaveBeenCalled();
  });

  it('uses an exact selected intent to disambiguate duplicate recipient actors', async () => {
    const d = deps({
      getIntent: mock(async (intentId) => ({ payload: intentId, summary: null, userId: 'owner-1' })),
    });
    const result = await new OutcomeFeedbackRecorder(d).prepare(record({
      opportunity: opportunity({ actors: duplicateScopeActors }),
      selectedIntentId: 'intent-2',
    }));
    expect(result?.event.intentId).toBe('intent-2');
    expect(result?.event.networkId).toBe('net-2');
    expect(result?.actorResolution).toBe('selected_intent');
    expect(d.getIntent).toHaveBeenCalledWith('intent-2');
  });

  it('rejects a selected intent that has no matching recipient actor', async () => {
    const d = deps();
    expect(await new OutcomeFeedbackRecorder(d).prepare(record({
      opportunity: opportunity({ actors: duplicateScopeActors }),
      selectedIntentId: 'intent-missing',
    }))).toBeNull();
    expect(d.getIntent).not.toHaveBeenCalled();
  });
});

describe('OutcomeFeedbackRecorder.prepare — event shape and independence', () => {
  it('stores only the approved snapshot and builds revision-scoped hashes', async () => {
    const result = await new OutcomeFeedbackRecorder(deps()).prepare(record());
    expect(result).not.toBeNull();
    const { event, scope } = result!;
    expect(event.recipientUserId).toBe('owner-1');
    expect(event.intentId).toBe('intent-1');
    expect(event.candidateSnapshot).toBe('Presenter-approved recipient summary.');
    expect(event.candidateSnapshot).not.toContain('PRIVATE EVALUATOR RATIONALE');
    expect(event.snapshotHash).toBe(sha256(['outcome-snapshot-v1', event.candidateSnapshot]));
    expect(event.dedupKey).toBe(sha256(['outcome-counterpart-v1', 'owner-1', 'counter-1']));
    expect(event.idempotencyKey).toBe(sha256([
      'outcome-event-v2',
      'owner-1',
      'intent-1',
      event.intentFingerprint,
      'opp-1',
      'accepted',
    ]));
    expect(result?.actorResolution).toBe('unique_owned_scope');
    expect(scope).toEqual({
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: event.intentFingerprint,
    });
  });

  it('collapses duplicate actor rows for the same sole counterpart to one independence key', async () => {
    const actors = [
      { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
      { networkId: 'net-1', userId: 'counter-1', role: 'agent', intent: 'intent-counter' },
      { networkId: 'net-2', userId: 'counter-1', role: 'agent', intent: 'intent-counter-2' },
    ] as unknown as Opportunity['actors'];
    const result = await new OutcomeFeedbackRecorder(deps()).prepare(record({ opportunity: opportunity({ actors }) }));
    expect(result?.event.dedupKey).toBe(sha256(['outcome-counterpart-v1', 'owner-1', 'counter-1']));
  });

  it('cannot inflate independence with repeated or overlapping counterpart participation', async () => {
    const recorder = new OutcomeFeedbackRecorder(deps());
    const singleA = (id: string) => opportunity({
      id,
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        { networkId: 'net-a', userId: 'counter-a', role: 'agent', intent: 'intent-a' },
      ] as unknown as Opportunity['actors'],
    });
    const overlapping = (others: string[]) => opportunity({
      actors: [
        { networkId: 'net-1', userId: 'owner-1', role: 'patient', intent: 'intent-1' },
        ...others.map((userId) => ({ networkId: 'net-x', userId, role: 'agent', intent: `intent-${userId}` })),
      ] as unknown as Opportunity['actors'],
    });

    const first = await recorder.prepare(record({ opportunity: singleA('opp-a1') }));
    const repeat = await recorder.prepare(record({ opportunity: singleA('opp-a2') }));
    expect(first?.event.dedupKey).toBe(repeat?.event.dedupKey);
    expect(await recorder.prepare(record({ opportunity: overlapping(['counter-a', 'counter-b']) }))).toBeNull();
    expect(await recorder.prepare(record({ opportunity: overlapping(['counter-a', 'counter-c']) }))).toBeNull();
  });

  it('keeps retry identity stable within a revision and changes it after a material revision', async () => {
    let payload = 'revision one';
    const recorder = new OutcomeFeedbackRecorder(deps({
      getIntent: mock(async () => ({ payload, summary: null, userId: 'owner-1' })),
    }));
    const first = await recorder.prepare(record({ action: 'rejected' }));
    const retry = await recorder.prepare(record({ action: 'rejected' }));
    payload = 'revision two';
    const revised = await recorder.prepare(record({ action: 'rejected' }));
    expect(first?.event.idempotencyKey).toBe(retry?.event.idempotencyKey);
    expect(revised?.event.intentFingerprint).not.toBe(first?.event.intentFingerprint);
    expect(revised?.event.idempotencyKey).not.toBe(first?.event.idempotencyKey);
  });

  it('propagates intent read failures so an eligible action cannot commit without its event', async () => {
    const d = deps({ getIntent: mock(async () => { throw new Error('db down'); }) });
    await expect(new OutcomeFeedbackRecorder(d).prepare(record())).rejects.toThrow('db down');
    expect(d.triggerMine).not.toHaveBeenCalled();
  });
});
