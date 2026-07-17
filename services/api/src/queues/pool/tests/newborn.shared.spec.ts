import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { CreateOpportunityData, PoolDiscriminatorAssignedAxis } from '@indexnetwork/protocol';

import { computeIntentFingerprint } from '../../../lib/intent/intent.fingerprint';
import { createNewbornOpportunityStamper } from '../newborn.shared';
import type { NewbornOpportunityStamperDeps } from '../newborn.shared';

const NOW = '2026-07-16T10:00:00.000Z';
const owner = 'owner-1';
const intentId = 'intent-1';
const CURRENT_FINGERPRINT = computeIntentFingerprint('Find a collaborator', 'Current');

function item(counterpart: string, score = 0.8): CreateOpportunityData {
  return {
    detection: { source: 'opportunity_graph', createdBy: 'agent-opportunity-finder', triggeredBy: intentId, timestamp: NOW },
    actors: [
      { userId: owner, networkId: 'network-1', role: 'patient', intent: intentId },
      { userId: counterpart, networkId: 'network-1', role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: `Evaluator reasoning for ${counterpart}`,
      confidence: score,
      signals: [{ type: 'intent_match', weight: score, detail: 'Entity-bundle evaluator' }],
    },
    context: { networkId: 'network-1' },
    confidence: String(score),
    status: 'latent',
    metadata: { evidence: [], preserved: true },
  };
}

function harness(overrides: Partial<NewbornOpportunityStamperDeps> = {}) {
  let intentCalls = 0;
  let fingerprintRead: string | undefined;
  const classifications: PoolDiscriminatorAssignedAxis[] = [
    {
      questionId: 'q-style',
      assignments: [
        { candidateId: 'newborn-0', side: 'Hands-on', evidence: 'verbatim secret evidence' },
        { candidateId: 'newborn-1', side: 'Advisory', evidence: 'another secret evidence' },
      ],
    },
    {
      questionId: 'q-stage',
      assignments: [
        { candidateId: 'newborn-0', side: null, evidence: null },
        { candidateId: 'newborn-1', side: 'Growth', evidence: 'secret growth evidence' },
      ],
    },
  ];
  const deps: NewbornOpportunityStamperDeps = {
    getIntent: async () => {
      intentCalls++;
      return { userId: owner, payload: 'Find a collaborator', summary: 'Current', status: 'ACTIVE', archivedAt: null };
    },
    listAnsweredPoolPreferences: async (_userId, _intentId, fingerprint) => {
      fingerprintRead = fingerprint;
      return [
        { questionId: 'q-style', label: 'Working style', sides: ['Hands-on', 'Advisory'], chosenSide: 'Hands-on' },
        { questionId: 'q-stage', label: 'Company stage', sides: ['Early', 'Growth'], chosenSide: 'Growth' },
      ];
    },
    buildCandidateContexts: async (_ownerUserId, input) => input.map((entry) => ({
      id: entry.id,
      publicContext: `Public ${entry.id}`,
      score: entry.opportunity.interpretation.confidence,
    })),
    assign: async () => classifications,
    now: () => NOW,
    ...overrides,
  };
  return {
    stamp: createNewbornOpportunityStamper(deps),
    intentCalls: () => intentCalls,
    fingerprintRead: () => fingerprintRead,
  };
}

beforeEach(() => {
  process.env.POOL_QUESTIONS_MODE = 'on';
  process.env.POOL_QUESTIONS_STAMP_NEWBORN = 'on';
});

afterEach(() => {
  delete process.env.POOL_QUESTIONS_MODE;
  delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
});

describe('newborn opportunity stamper', () => {
  it('requires both mode and newborn flags', async () => {
    for (const flags of [
      { mode: undefined, stamp: 'on' },
      { mode: 'on', stamp: undefined },
      { mode: undefined, stamp: undefined },
    ]) {
      if (flags.mode) process.env.POOL_QUESTIONS_MODE = flags.mode;
      else delete process.env.POOL_QUESTIONS_MODE;
      if (flags.stamp) process.env.POOL_QUESTIONS_STAMP_NEWBORN = flags.stamp;
      else delete process.env.POOL_QUESTIONS_STAMP_NEWBORN;
      const h = harness();
      const original = [item('candidate-1')];
      expect(await h.stamp({ ownerUserId: owner, intentId, items: original })).toBe(original);
      expect(h.intentCalls()).toBe(0);
    }
  });

  it('rejects wrong ownership and inactive or archived lifecycle before classification', async () => {
    const invalid = [
      { userId: 'someone-else', payload: 'x', status: 'ACTIVE', archivedAt: null },
      { userId: owner, payload: 'x', status: 'PAUSED', archivedAt: null },
      { userId: owner, payload: 'x', status: 'ACTIVE', archivedAt: new Date() },
    ];
    for (const current of invalid) {
      let assigned = false;
      const h = harness({ getIntent: async () => current, assign: async () => { assigned = true; return []; } });
      const original = [item('candidate-1')];
      expect(await h.stamp({ ownerUserId: owner, intentId, items: original })).toBe(original);
      expect(assigned).toBe(false);
    }
  });

  it('uses the exact pre-call fingerprint and discards every stamp on post-call drift', async () => {
    let call = 0;
    const h = harness({
      getIntent: async () => {
        call++;
        return {
          userId: owner,
          payload: call === 1 ? 'Find a collaborator' : 'Find a local collaborator',
          summary: 'Current',
          status: 'ACTIVE',
          archivedAt: null,
        };
      },
    });
    const original = [item('candidate-1')];
    expect(await h.stamp({ ownerUserId: owner, intentId, items: original })).toBe(original);
    expect(h.fingerprintRead()).toBe(computeIntentFingerprint('Find a collaborator', 'Current'));
  });

  it('merges copied metadata and signals with exact P3 provenance and one appliedAt', async () => {
    const original = [item('candidate-1', 0.9), item('candidate-2', 0.8)];
    const stamped = await harness().stamp({ ownerUserId: owner, intentId, items: original });
    expect(stamped).not.toBe(original);
    expect(original[0].metadata).toEqual({ evidence: [], preserved: true });

    const firstAdjustments = stamped[0].metadata?.poolAdjustments as Array<Record<string, unknown>>;
    expect(firstAdjustments).toEqual([
      { questionId: 'q-stage', recipientUserId: owner, intentId, label: 'Company stage', side: 'unknown', factor: 0.9, appliedAt: NOW, intentFingerprint: CURRENT_FINGERPRINT },
      { questionId: 'q-style', recipientUserId: owner, intentId, label: 'Working style', side: 'Hands-on', factor: 1, appliedAt: NOW, intentFingerprint: CURRENT_FINGERPRINT },
    ]);
    const secondAdjustments = stamped[1].metadata?.poolAdjustments as Array<Record<string, unknown>>;
    expect(secondAdjustments).toEqual([
      { questionId: 'q-stage', recipientUserId: owner, intentId, label: 'Company stage', side: 'Growth', factor: 1, appliedAt: NOW, intentFingerprint: CURRENT_FINGERPRINT },
      { questionId: 'q-style', recipientUserId: owner, intentId, label: 'Working style', side: 'Advisory', factor: 0.6, detail: 'Working style: you chose Hands-on', appliedAt: NOW, intentFingerprint: CURRENT_FINGERPRINT },
    ]);
    expect(stamped[0].interpretation.signals?.slice(-2)).toEqual([
      { type: 'pool_discriminator', weight: 0, recipientUserId: owner, intentId, detail: 'Company stage: unassigned', questionId: 'q-stage' },
      { type: 'pool_discriminator', weight: 1, recipientUserId: owner, intentId, detail: 'Working style: Hands-on', questionId: 'q-style' },
    ]);
    expect(stamped[1].interpretation.signals?.slice(-2)).toEqual([
      { type: 'pool_discriminator', weight: 1, recipientUserId: owner, intentId, detail: 'Company stage: Growth', questionId: 'q-stage' },
      { type: 'pool_discriminator', weight: -1, recipientUserId: owner, intentId, detail: 'Working style: Hands-on', questionId: 'q-style' },
    ]);

    const serialized = JSON.stringify(stamped);
    expect(serialized).not.toContain('verbatim secret evidence');
    expect(serialized).not.toContain('another secret evidence');
    expect(serialized).not.toContain('secret growth evidence');
  });

  it('re-answer stamping preserves same-question adjustments and signals from other provenance', async () => {
    const original = item('candidate-1');
    original.metadata = {
      ...original.metadata,
      poolAdjustments: [{
        questionId: 'q-style',
        recipientUserId: 'other-user',
        intentId,
        label: 'Working style',
        side: 'Advisory',
        factor: 0.6,
        appliedAt: NOW,
      }],
    };
    original.interpretation.signals = [
      ...(original.interpretation.signals ?? []),
      {
        type: 'pool_discriminator',
        weight: -1,
        questionId: 'q-style',
        recipientUserId: 'other-user',
        intentId,
        detail: 'Working style: Hands-on',
      },
    ];
    const h = harness({ assign: async () => [{
      questionId: 'q-style',
      assignments: [{ candidateId: 'newborn-0', side: 'Hands-on', evidence: 'verified' }],
    }] });

    const [stamped] = await h.stamp({ ownerUserId: owner, intentId, items: [original] });
    const adjustments = stamped.metadata?.poolAdjustments as Array<Record<string, unknown>>;
    expect(adjustments.map((entry) => entry.recipientUserId)).toEqual(['other-user', owner]);
    const signals = stamped.interpretation.signals?.filter(
      (signal) => signal.type === 'pool_discriminator' && signal.questionId === 'q-style',
    );
    expect(signals?.map((signal) => signal.recipientUserId)).toEqual(['other-user', owner]);
  });

  it('stamps only exact triggeredBy items and leaves mismatched originals unchanged', async () => {
    const eligible = item('candidate-1');
    const mismatched = item('candidate-2');
    mismatched.detection.triggeredBy = 'intent-other' as never;
    let candidateIds: string[] = [];
    const h = harness({
      buildCandidateContexts: async (_ownerUserId, input) => {
        candidateIds = input.map((entry) => entry.id);
        return input.map((entry) => ({
          id: entry.id,
          publicContext: entry.id,
          score: entry.opportunity.interpretation.confidence,
        }));
      },
    });

    const stamped = await h.stamp({ ownerUserId: owner, intentId, items: [eligible, mismatched] });
    expect(candidateIds).toEqual(['newborn-0']);
    expect(stamped[0].metadata?.poolAdjustments).toBeDefined();
    expect(stamped[1]).toEqual(mismatched);
    expect(stamped[1].metadata?.poolAdjustments).toBeUndefined();
  });

  it('preserves input length and order while stamping copied items', async () => {
    const original = [item('candidate-low', 0.2), item('candidate-high', 0.9)];
    const stamped = await harness().stamp({ ownerUserId: owner, intentId, items: original });

    expect(stamped).toHaveLength(original.length);
    expect(stamped.map((entry) => entry.actors[1].userId)).toEqual(['candidate-low', 'candidate-high']);
    expect(original.every((entry) => entry.metadata?.poolAdjustments === undefined)).toBe(true);
  });

  it('skips a wholly missing axis instead of writing unknown to every candidate', async () => {
    const h = harness({ assign: async () => [{
      questionId: 'q-style',
      assignments: [{ candidateId: 'newborn-0', side: 'Hands-on', evidence: 'verified' }],
    }] });
    const stamped = await h.stamp({ ownerUserId: owner, intentId, items: [item('candidate-1')] });
    const adjustments = stamped[0].metadata?.poolAdjustments as Array<Record<string, unknown>>;
    expect(adjustments.map((entry) => entry.questionId)).toEqual(['q-style']);
  });

  it('fails open on preference, context, model, and post-lookup failures', async () => {
    const failures: Array<Partial<NewbornOpportunityStamperDeps>> = [
      { listAnsweredPoolPreferences: async () => { throw new Error('lookup'); } },
      { buildCandidateContexts: async () => { throw new Error('context'); } },
      { assign: async () => { throw new Error('provider'); } },
      { getIntent: (() => {
          let calls = 0;
          return async () => {
            calls++;
            if (calls === 2) throw new Error('post lookup');
            return { userId: owner, payload: 'Find a collaborator', summary: 'Current', status: 'ACTIVE', archivedAt: null };
          };
        })() },
    ];
    for (const overrides of failures) {
      const original = [item('candidate-1')];
      expect(await harness(overrides).stamp({ ownerUserId: owner, intentId, items: original })).toBe(original);
    }
  });
});
