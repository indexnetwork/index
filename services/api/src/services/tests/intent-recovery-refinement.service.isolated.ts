process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { describe, expect, it, mock } from 'bun:test';

import type { QuestionGenerationResult, RecoveryQuestionerInput } from '@indexnetwork/protocol';

import type { AdapterPersistableQuestion, RecoveryOpportunitySnapshot, RecoveryPreparation } from '../../adapters/questioner.adapter';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { IntentRecoveryRefinementService, isRecoverySuppressingOpportunity } from '../intent-recovery-refinement.service';

const userId = 'user-owner';
const counterpartyId = 'user-counterparty';
const intentId = 'intent-1';
const networkId = 'network-1';
const payload = 'Find a technical cofounder for a climate analytics startup';
const summary = 'Climate cofounder';
const fingerprint = computeIntentFingerprint(payload, summary);

function generated(prompt = 'For your climate analytics cofounder goal, which product stage should a collaborator have experience with?'): QuestionGenerationResult {
  return {
    questions: [{
      title: 'Stage',
      prompt,
      options: [
        { label: 'Prototype (Recommended)', description: 'Prioritizes collaborators comfortable validating an early product.' },
        { label: 'Growth', description: 'Prioritizes collaborators experienced in scaling an established product.' },
      ],
      multiSelect: false,
    }],
    strategies: ['surface_missing_detail'],
    underspecificationTypes: ['missing_constraint'],
  };
}

function preparation(opportunities: RecoveryOpportunitySnapshot[] = []): RecoveryPreparation {
  return {
    intent: { id: intentId, userId, payload, summary, intentFingerprint: fingerprint },
    hasCadenceAnchor: false,
    opportunities,
  };
}

function rejectedOpportunity(): RecoveryOpportunitySnapshot {
  return {
    id: 'opportunity-rejected',
    status: 'rejected',
    actors: [
      { userId, role: 'peer', networkId },
      { userId: counterpartyId, role: 'peer', networkId },
    ],
    context: { networkId },
  };
}

function task() {
  return {
    id: 'task-private',
    conversationId: 'conversation-private',
    state: 'completed',
    metadata: {
      type: 'negotiation',
      opportunityId: 'opportunity-rejected',
      sourceUserId: userId,
      candidateUserId: counterpartyId,
      networkId,
      intentSnapshots: [{
        userId,
        intentId,
        description: payload,
        title: summary,
      }],
      privateTurnSummary: 'must never reach generation',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeService(input: {
  prepared?: RecoveryPreparation | null;
  generation?: QuestionGenerationResult | null;
  tasks?: ReturnType<typeof task>[];
  artifacts?: Array<{ id: string; name: string | null; parts: unknown[]; metadata: Record<string, unknown> | null }>;
  persistResult?: string | null;
}) {
  let persisted: AdapterPersistableQuestion | null = null;
  let generatorInput: RecoveryQuestionerInput | null = null;
  const onCreated = mock(() => {});
  const persistFreshRecoveryQuestion = mock(async (question: AdapterPersistableQuestion) => {
    persisted = question;
    return input.persistResult === undefined ? 'question-1' : input.persistResult;
  });
  const generate = mock(async (generationInput: RecoveryQuestionerInput) => {
    generatorInput = generationInput;
    return input.generation === undefined ? generated() : input.generation;
  });
  const service = new IntentRecoveryRefinementService({
    adapter: {
      prepareRecoveryRefinement: async () => input.prepared === undefined ? preparation() : input.prepared,
      persistFreshRecoveryQuestion,
    },
    getNegotiationTasksForOpportunity: async () => input.tasks ?? [],
    getArtifactsForTask: async () => input.artifacts ?? [],
    getGlobalUserContext: async () => 'Owner builds climate-data products in Berlin.',
    generate,
    onCreated,
  });
  return {
    service,
    generate,
    onCreated,
    persistFreshRecoveryQuestion,
    getPersisted: () => persisted,
    getGeneratorInput: () => generatorInput,
  };
}

describe('IntentRecoveryRefinementService', () => {
  it('uses source-only intent and global context when no candidate or negotiation exists', async () => {
    const harness = makeService({});
    expect(await harness.service.recover({
      source: 'from_intent', recipientUserId: userId, intentId,
    })).toBe('question-1');

    expect(harness.getGeneratorInput()).toEqual({
      mode: 'intent', purpose: 'recovery', userId, sourceType: 'intent', sourceId: intentId,
      triggeredByIntentId: intentId,
      context: {
        purpose: 'recovery', intentId, payload, summary,
        userContext: 'Owner builds climate-data products in Berlin.',
      },
    });
    expect(harness.getPersisted()).toMatchObject({
      detection: {
        mode: 'intent', purpose: 'recovery', sourceType: 'intent', sourceId: intentId,
        triggeredBy: intentId,
        recovery: { version: 1, intentFingerprint: fingerprint, completionSource: 'from_intent' },
      },
      actors: [{ userId, role: 'subject' }],
    });
  });

  it('reduces validated rejected evidence to one aggregate integer before generation and persistence', async () => {
    const privateArtifact = {
      id: 'artifact-private',
      name: 'negotiation-outcome',
      parts: [{ kind: 'data', data: {
        hasOpportunity: false,
        reasoning: 'Counterparty profile, transcript, and rejection reason must stay private.',
      } }],
      metadata: { matchReason: 'unsafe private match reason' },
    };
    const harness = makeService({
      prepared: preparation([rejectedOpportunity()]),
      tasks: [task()],
      artifacts: [privateArtifact],
    });
    await harness.service.recover({
      source: 'discovery_run', recipientUserId: userId, intentId, runId: 'run-private',
    });

    expect(harness.getGeneratorInput()?.context).toMatchObject({ rejectedNegotiationCount: 1 });
    const generatorJson = JSON.stringify(harness.getGeneratorInput());
    for (const unsafe of [
      'opportunity-rejected', 'task-private', 'conversation-private', counterpartyId,
      networkId, 'privateTurnSummary', 'Counterparty profile', 'matchReason', 'run-private',
    ]) expect(generatorJson).not.toContain(unsafe);

    expect(harness.getPersisted()?.detection.recovery).toEqual({
      version: 1,
      intentFingerprint: fingerprint,
      completionSource: 'discovery_run',
      rejectedNegotiationCount: 1,
      runId: 'run-private',
    });
    expect(JSON.stringify(harness.getPersisted())).not.toContain('Counterparty profile');
  });

  it('fails closed to source-only context when rejected evidence provenance is malformed', async () => {
    const malformed = task();
    malformed.metadata.intentSnapshots = [];
    const harness = makeService({
      prepared: preparation([rejectedOpportunity()]),
      tasks: [malformed],
      artifacts: [{ id: 'a', name: 'negotiation-outcome', parts: [{ kind: 'data', data: { hasOpportunity: false } }], metadata: null }],
    });
    await harness.service.recover({ source: 'from_intent', recipientUserId: userId, intentId });
    expect(harness.getGeneratorInput()?.context).not.toHaveProperty('rejectedNegotiationCount');
  });

  it('suppresses generation for any exact recipient-visible canonical actionable opportunity', async () => {
    const harness = makeService({
      prepared: preparation([{
        id: 'actionable', status: 'pending', context: null,
        actors: [{ userId, role: 'peer' }, { userId: counterpartyId, role: 'peer' }],
      }]),
    });
    expect(await harness.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('locks the canonical status and role actionability matrix', () => {
    const peerActors = [{ userId, role: 'peer' }, { userId: counterpartyId, role: 'peer' }];
    for (const status of ['latent', 'pending']) {
      expect(isRecoverySuppressingOpportunity({ id: status, status, actors: peerActors, context: null }, userId)).toBe(true);
    }
    for (const status of ['draft', 'negotiating', 'stalled', 'accepted', 'rejected', 'expired']) {
      expect(isRecoverySuppressingOpportunity({ id: status, status, actors: peerActors, context: null }, userId)).toBe(false);
    }
    expect(isRecoverySuppressingOpportunity({
      id: 'acted', status: 'pending', context: null,
      actors: [{ userId, role: 'peer', actedAt: new Date().toISOString() }, { userId: counterpartyId, role: 'peer' }],
    }, userId)).toBe(false);
    expect(isRecoverySuppressingOpportunity({
      id: 'foreign', status: 'latent', context: null,
      actors: [{ userId: 'foreign', role: 'peer' }, { userId: counterpartyId, role: 'peer' }],
    }, userId)).toBe(false);
  });

  it('skips missing, foreign, paused, archived, or same-fingerprint cadence failures before generation', async () => {
    for (const prepared of [null, { ...preparation(), hasCadenceAnchor: true }]) {
      const harness = makeService({ prepared });
      expect(await harness.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
      expect(harness.generate).not.toHaveBeenCalled();
    }
  });

  it('persists nothing for unsafe model copy or final-gate drift', async () => {
    const unsafe = makeService({ generation: generated('No matches were found; should the search retry with more candidates?') });
    expect(await unsafe.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
    expect(unsafe.persistFreshRecoveryQuestion).not.toHaveBeenCalled();

    const drifted = makeService({ persistResult: null });
    expect(await drifted.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
    expect(drifted.onCreated).not.toHaveBeenCalled();
  });
});
