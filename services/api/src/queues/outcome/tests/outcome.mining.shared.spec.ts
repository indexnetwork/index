import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { DiscriminatorMiningInput, MinedDiscriminator, OutcomeShadowResult } from '@indexnetwork/protocol';

import { computeIntentFingerprint } from '../../../lib/intent/intent.fingerprint';
import { computeOutcomeCounterpartDedupKey, computeOutcomeIdempotencyKey, computeOutcomeSnapshotHash } from '../../../lib/opportunity/outcome-feedback.identity';
import type { OpportunityOutcomeEvent } from '../../../schemas/database.schema';
import { mineOutcomeHypotheses, toShadowTelemetry, type MiningIntent, type OutcomeMiningDeps } from '../outcome.mining.shared';

const INTENT_PAYLOAD = 'build hardware';
const INTENT_SUMMARY: string | null = null;
const CURRENT_FINGERPRINT = computeIntentFingerprint(INTENT_PAYLOAD, INTENT_SUMMARY);

function event(
  opportunityId: string,
  action: 'accepted' | 'rejected',
  counterpartUserId: string,
): OpportunityOutcomeEvent {
  const candidateSnapshot = 'presentation-safe candidate context';
  return {
    id: `e-${opportunityId}`,
    recipientUserId: 'owner-1',
    intentId: 'intent-1',
    intentFingerprint: CURRENT_FINGERPRINT,
    opportunityId,
    networkId: 'net-1',
    action,
    candidateSnapshot,
    snapshotHash: computeOutcomeSnapshotHash(candidateSnapshot),
    dedupKey: computeOutcomeCounterpartDedupKey('owner-1', counterpartUserId),
    idempotencyKey: computeOutcomeIdempotencyKey({
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: CURRENT_FINGERPRINT,
      opportunityId,
      action,
    }),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

/** Miner that records inputs and splits the pool evenly across two sides. */
function recordingMiner() {
  const seen: DiscriminatorMiningInput[] = [];
  const mine = mock(async (input: DiscriminatorMiningInput): Promise<MinedDiscriminator[]> => {
    seen.push(input);
    const half = Math.floor(input.candidates.length / 2);
    return [{
      label: 'SECRET FREE-FORM AXIS',
      questionSeed: 'SECRET FREE-FORM QUESTION',
      sides: ['SECRET SIDE A', 'SECRET SIDE B'],
      assignments: input.candidates.map((candidate, index) => ({
        id: candidate.id,
        side: index < half ? 'SECRET SIDE A' : 'SECRET SIDE B',
        evidence: 'verified',
        verified: true,
      })),
      evidenceRate: 1,
    }];
  });
  return { mine, seen };
}

function activeIntent(overrides: Partial<MiningIntent> = {}): MiningIntent {
  return {
    payload: INTENT_PAYLOAD,
    summary: INTENT_SUMMARY,
    userId: 'owner-1',
    archivedAt: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

function deps(
  events: OpportunityOutcomeEvent[],
  miner: Pick<OutcomeMiningDeps['miner'], 'mine'>,
  intent: MiningIntent | null = activeIntent(),
): OutcomeMiningDeps {
  return {
    getEvents: mock(async () => events),
    getIntent: mock(async () => intent),
    miner,
  };
}

const scope = {
  recipientUserId: 'owner-1',
  intentId: 'intent-1',
  intentFingerprint: CURRENT_FINGERPRINT,
};

function enoughEvents(): OpportunityOutcomeEvent[] {
  return [
    ...Array.from({ length: 6 }, (_, index) => event(`accepted-${index}`, 'accepted', `counter-${index}`)),
    ...Array.from({ length: 6 }, (_, index) => event(`rejected-${index}`, 'rejected', `counter-${index + 6}`)),
  ];
}

afterEach(() => {
  delete process.env.OUTCOME_QUESTIONS_MODE;
});

describe('mineOutcomeHypotheses', () => {
  it('does nothing when OUTCOME_QUESTIONS_MODE is off', async () => {
    const d = deps([], recordingMiner());
    await mineOutcomeHypotheses(scope, d);
    expect((d.getEvents as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  it('suppresses below-k pools without calling the LLM', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const events = Array.from({ length: 8 }, (_, index) =>
      event(`o${index}`, index % 2 ? 'accepted' : 'rejected', `counter-${index}`));
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(events, miner));
    expect(miner.seen.length).toBe(0);
  });

  it('mines blind to outcome and sends only run-local aliases to the model', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const events = enoughEvents();
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(events, miner));

    expect(miner.seen.length).toBe(1);
    const rawOpportunityIds = new Set(events.map((item) => item.opportunityId));
    for (const [index, candidate] of miner.seen[0].candidates.entries()) {
      expect(Object.keys(candidate).sort()).toEqual(['id', 'publicContext', 'score']);
      expect(candidate.id).toBe(`c${index}`);
      expect(rawOpportunityIds.has(candidate.id)).toBe(false);
      expect(JSON.stringify(candidate)).not.toContain('accepted');
      expect(JSON.stringify(candidate)).not.toContain('rejected');
    }
  });

  it('fails closed when the intent is missing', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(enoughEvents(), miner, null));
    expect(miner.seen.length).toBe(0);
  });

  it('fails closed on recipient ownership mismatch', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(enoughEvents(), miner, activeIntent({ userId: 'other-user' })));
    expect(miner.seen.length).toBe(0);
  });

  it('treats legacy null intent status as active', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(enoughEvents(), miner, activeIntent({ status: null })));
    expect(miner.seen.length).toBe(1);
  });

  it('fails closed on archived or non-active lifecycle', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const archivedMiner = recordingMiner();
    await mineOutcomeHypotheses(
      scope,
      deps(enoughEvents(), archivedMiner, activeIntent({ archivedAt: new Date('2026-01-02T00:00:00Z') })),
    );
    expect(archivedMiner.seen.length).toBe(0);

    const pausedMiner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(enoughEvents(), pausedMiner, activeIntent({ status: 'PAUSED' })));
    expect(pausedMiner.seen.length).toBe(0);
  });

  it('keeps captured old-revision events inert when the intent drifts before mining', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const miner = recordingMiner();
    await mineOutcomeHypotheses(
      scope,
      deps(enoughEvents(), miner, activeIntent({ payload: 'materially edited intent' })),
    );
    expect(miner.seen.length).toBe(0);
  });

  it('never sends malformed or evaluator-only snapshots to the Lens B miner', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const malformed = enoughEvents().map((item) => ({
      ...item,
      candidateSnapshot: 'PRIVATE EVALUATOR RATIONALE',
      // Deliberately retain the approved snapshot hash: integrity validation
      // must make every tampered row inert before the LLM boundary.
    }));
    const miner = recordingMiner();
    await mineOutcomeHypotheses(scope, deps(malformed, miner));
    expect(miner.seen.length).toBe(0);
  });

  it('never throws even if mining fails (fire-and-forget discipline)', async () => {
    process.env.OUTCOME_QUESTIONS_MODE = 'shadow';
    const failing = { mine: mock(async () => { throw new Error('secret dynamic provider failure'); }) };
    await expect(mineOutcomeHypotheses(scope, deps(enoughEvents(), failing))).resolves.toBeUndefined();
  });
});

describe('toShadowTelemetry', () => {
  it('redacts opportunity ids, actions, free-form hypotheses/questions, and side labels', () => {
    const result: OutcomeShadowResult = {
      poolSize: 12,
      eligibleCount: 1,
      hypotheses: [{
        label: 'SECRET FREE-FORM AXIS',
        questionSeed: 'SECRET FREE-FORM QUESTION',
        evidenceRate: 0.87654,
        minIndependentSupport: 5,
        sides: [
          { side: 'SECRET SIDE A', independentSupport: 5, acceptRate: 0.8 },
          { side: 'SECRET SIDE B', independentSupport: 7, acceptRate: 0.29 },
        ],
      }],
    };

    const telemetry = toShadowTelemetry(result);
    expect(telemetry).toEqual({
      code: 'shadow_result',
      poolSize: 12,
      eligibleCount: 1,
      hypotheses: [{
        index: 0,
        evidenceRate: 0.877,
        minIndependentSupport: 5,
        sides: [
          { independentSupport: 5, acceptRate: 0.8 },
          { independentSupport: 7, acceptRate: 0.29 },
        ],
      }],
    });
    const serialized = JSON.stringify(telemetry);
    for (const forbidden of [
      'SECRET FREE-FORM AXIS',
      'SECRET FREE-FORM QUESTION',
      'SECRET SIDE A',
      'SECRET SIDE B',
      'accepted',
      'rejected',
      'opportunityId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
