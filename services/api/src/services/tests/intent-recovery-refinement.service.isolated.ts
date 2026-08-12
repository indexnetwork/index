process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { describe, expect, it, mock } from 'bun:test';

import type { QuestionGenerationResult, QuestionerInput } from '@indexnetwork/protocol';

import type { AdapterPersistableQuestion, RecoveryOpportunitySnapshot, RecoveryPreparation } from '../../adapters/questioner.adapter';
import { QuestionEvents } from '../../events/question.event';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { IntentRecoveryRefinementService } from '../intent-recovery-refinement.service';

const userId = 'user-owner';
const counterpartyId = 'user-counterparty';
const intentId = 'intent-1';
const networkId = 'network-1';
const payload = 'Find a technical cofounder for a climate analytics startup';
const summary = 'Climate cofounder';
const fingerprint = computeIntentFingerprint(payload, summary);

type GeneratedQuestion = QuestionGenerationResult['questions'][number];

function generated(overrides: Partial<GeneratedQuestion> | string = {}): QuestionGenerationResult {
  const normalizedOverrides = typeof overrides === 'string' ? { prompt: overrides } : overrides;
  return {
    questions: [{
      title: 'Stage',
      prompt: 'For your climate analytics cofounder goal, which product stage should a collaborator have experience with?',
      options: [
        { label: 'Prototype (Recommended)', description: 'Prioritizes collaborators comfortable validating an early product.' },
        { label: 'Growth', description: 'Prioritizes collaborators experienced in scaling an established product.' },
      ],
      multiSelect: false,
      ...normalizedOverrides,
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
  persistError?: unknown;
}) {
  let persisted: AdapterPersistableQuestion | null = null;
  let generatorInput: QuestionerInput | null = null;
  const onCreated = mock(() => {});
  const persistFreshRecoveryQuestion = mock(async (question: AdapterPersistableQuestion) => {
    persisted = question;
    if (input.persistError !== undefined) throw input.persistError;
    return input.persistResult === undefined ? 'question-1' : input.persistResult;
  });
  const generate = mock(async (generationInput: QuestionerInput) => {
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
  it('preserves the ordinary intent-creation preset while sharing durable surfacing', async () => {
    const harness = makeService({});
    expect(await harness.service.recover({
      source: 'intent_creation', recipientUserId: userId, intentId,
    })).toBe('question-1');

    expect(harness.getGeneratorInput()).toEqual({
      mode: 'intent', userId, sourceType: 'intent', sourceId: intentId,
      triggeredByIntentId: intentId,
      context: {
        intentId, payload, summary,
        userContext: 'Owner builds climate-data products in Berlin.',
      },
    });
    expect(harness.getPersisted()?.detection.recovery).toMatchObject({
      completionSource: 'intent_creation',
      intentFingerprint: fingerprint,
    });
  });

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

  it('surfaces refinement even when discovery already produced an actionable opportunity', async () => {
    const harness = makeService({
      prepared: preparation([{
        id: 'actionable', status: 'pending', context: null,
        actors: [{ userId, role: 'peer' }, { userId: counterpartyId, role: 'peer' }],
      }]),
    });
    expect(await harness.service.recover({
      source: 'from_intent', recipientUserId: userId, intentId,
    })).toBe('question-1');
    expect(harness.generate).toHaveBeenCalledTimes(1);
  });

  it('skips missing, foreign, paused, archived, or same-fingerprint cadence failures before generation', async () => {
    for (const prepared of [null, { ...preparation(), hasCadenceAnchor: true }]) {
      const harness = makeService({ prepared });
      expect(await harness.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
      expect(harness.generate).not.toHaveBeenCalled();
    }
  });

  it('rejects unsafe process narration in every user-visible generated field', async () => {
    const unsafeQuestions: Array<Partial<GeneratedQuestion>> = [
      { title: 'Retry count' },
      { prompt: 'No matches were found; should the search retry with more candidates?' },
      {
        options: [
          { label: 'Retry search', description: 'Change the preferred timing.' },
          { label: 'Keep timing', description: 'Keep the current preference.' },
        ],
      },
      {
        options: [
          { label: 'Earlier', description: 'We couldn’t find a suitable fit.' },
          { label: 'Later', description: 'Prefer a later start.' },
        ],
      },
      {
        options: [
          { label: 'Earlier', description: 'We reviewed an invented counterparty during the process.' },
          { label: 'Later', description: 'Prefer a later start.' },
        ],
      },
    ];

    for (const unsafeQuestion of unsafeQuestions) {
      const harness = makeService({ generation: generated(unsafeQuestion) });
      expect(await harness.service.recover({
        source: 'from_intent', recipientUserId: userId, intentId,
      })).toBeNull();
      expect(harness.persistFreshRecoveryQuestion).not.toHaveBeenCalled();
    }
  });

  it('swallows only the intended recovery cadence unique constraint', async () => {
    const intended = Object.assign(new Error('recovery cadence race'), {
      code: '23505',
      constraint: 'questions_recovery_recipient_intent_fingerprint_uniq',
    });
    const wrapped = Object.assign(new Error('wrapped database error'), { cause: intended });
    const duplicate = makeService({ persistError: wrapped });
    expect(await duplicate.service.recover({
      source: 'from_intent', recipientUserId: userId, intentId,
    })).toBeNull();
    expect(duplicate.onCreated).not.toHaveBeenCalled();

    const unrelated = Object.assign(new Error('unrelated unique violation'), {
      code: '23505',
      constraint: 'questions_primary_key',
    });
    const failure = makeService({ persistError: unrelated });
    await expect(failure.service.recover({
      source: 'from_intent', recipientUserId: userId, intentId,
    })).rejects.toThrow('unrelated unique violation');
  });

  it('emits nothing when the final persistence gate drifts', async () => {
    const drifted = makeService({ persistResult: null });
    expect(await drifted.service.recover({ source: 'from_intent', recipientUserId: userId, intentId })).toBeNull();
    expect(drifted.onCreated).not.toHaveBeenCalled();
  });

  it('uses the current QuestionEvents.onCreated callback when recovery succeeds', async () => {
    const originalOnCreated = QuestionEvents.onCreated;
    const preConstruction = mock(() => {});
    const replacement = mock(() => {});
    QuestionEvents.onCreated = preConstruction;

    const service = new IntentRecoveryRefinementService({
      adapter: {
        prepareRecoveryRefinement: async () => preparation(),
        persistFreshRecoveryQuestion: async () => 'question-current-callback',
      },
      getNegotiationTasksForOpportunity: async () => [],
      getArtifactsForTask: async () => [],
      getGlobalUserContext: async () => '',
      generate: async () => generated(),
    });
    QuestionEvents.onCreated = replacement;

    try {
      expect(await service.recover({
        source: 'from_intent', recipientUserId: userId, intentId,
      })).toBe('question-current-callback');
      expect(replacement).toHaveBeenCalledTimes(1);
      expect(preConstruction).not.toHaveBeenCalled();
    } finally {
      QuestionEvents.onCreated = originalOnCreated;
    }
  });
});
