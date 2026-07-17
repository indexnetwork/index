import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { NegotiationEvidenceMiner, RawEvidenceSegment } from '@indexnetwork/protocol';

import { computeIntentFingerprint } from '../../../lib/intent/intent.fingerprint';
import { canonicalizeNegotiationSender, collectNegotiationEvidenceSegments, getValidatedCounterpartyUserId, maybeRunNegotiationEvidenceShadow, toBoundedErrorTelemetry } from '../negotiation-evidence.shadow';
import type { NegotiationEvidenceShadowDeps } from '../negotiation-evidence.shadow';
import type { PoolMiningTrigger } from '../mining.shared';

const TRIGGER: PoolMiningTrigger = {
  source: 'discovery_run',
  userId: 'owner-1',
  intentId: 'intent-1',
};
const INTENT = {
  userId: 'owner-1',
  payload: 'Find a technical cofounder',
  summary: 'Cofounder search',
  archivedAt: null,
  status: 'ACTIVE',
};
const FINGERPRINT = computeIntentFingerprint(INTENT.payload, INTENT.summary);
const OPPORTUNITY = {
  id: 'opp-1',
  context: { networkId: 'net-1' },
  actors: [
    { userId: 'owner-1', role: 'peer' },
    { userId: 'counterparty-1', role: 'peer' },
  ],
};

type ShadowDatabase = NegotiationEvidenceShadowDeps['database'];
type ShadowTask = Awaited<ReturnType<ShadowDatabase['getNegotiationTasksForOpportunity']>>[number];

function task(id: string, metadataOverrides: Record<string, unknown> = {}): ShadowTask {
  return {
    id,
    conversationId: `conversation-${id}`,
    state: 'completed',
    metadata: {
      type: 'negotiation',
      opportunityId: 'opp-1',
      networkId: 'net-1',
      sourceUserId: 'owner-1',
      candidateUserId: 'counterparty-1',
      intentSnapshots: [{
        userId: 'owner-1',
        intentId: 'intent-1',
        description: INTENT.payload,
        title: INTENT.summary,
      }],
      ...metadataOverrides,
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function makeDeps(overrides: Partial<NegotiationEvidenceShadowDeps> = {}): {
  deps: NegotiationEvidenceShadowDeps;
  capturedSegments: RawEvidenceSegment[][];
  warnings: Array<Record<string, unknown> | undefined>;
} {
  const capturedSegments: RawEvidenceSegment[][] = [];
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const database: ShadowDatabase = {
    getIntent: mock(async () => INTENT),
    getNegotiationTasksForOpportunity: mock(async () => [task('task-1')]),
    getMessagesByTaskIds: mock(async () => new Map([
      ['task-1', [{ senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose', message: 'hello' } }] }]],
    ])),
    getArtifactsForTask: mock(async () => []),
  };
  const runShadow: NegotiationEvidenceShadowDeps['runShadow'] = async (input) => {
    capturedSegments.push(input.segments);
    return {
      hypotheses: [],
      telemetry: {
        recipientUserId: input.scope.recipientUserId,
        intentId: input.scope.intentId,
        segments: input.segments.length,
        excludedRecords: 0,
        distinctOpportunities: input.segments.length > 0 ? 1 : 0,
        evidenceCounts: {
          owner_answer: 0,
          bilateral_action: input.segments.length,
          coarse_outcome: 0,
          shared_message: 0,
        },
        hypothesesMined: 0,
        hypothesesSupported: 0,
        hypothesesRecurrent: 0,
        hypothesesDiscarded: 0,
      },
    };
  };
  const deps: NegotiationEvidenceShadowDeps = {
    database,
    selectPool: mock(async () => [OPPORTUNITY]),
    getMiner: () => ({}) as NegotiationEvidenceMiner,
    runShadow,
    logger: {
      debug: mock(() => {}),
      info: mock(() => {}),
      warn: mock((_message, metadata) => { warnings.push(metadata); }),
    },
    ...overrides,
  };
  return { deps, capturedSegments, warnings };
}

afterEach(() => {
  delete process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE;
});

describe('maybeRunNegotiationEvidenceShadow — gating', () => {
  it('is a no-op when the flag is off', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'off';
    const { deps } = makeDeps();
    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);
    expect(deps.database.getIntent).not.toHaveBeenCalled();
  });

  it('is a no-op for introducer-flow and intent-less triggers even when enabled', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const { deps } = makeDeps();
    await maybeRunNegotiationEvidenceShadow({ ...TRIGGER, isIntroducerFlow: true }, deps);
    await maybeRunNegotiationEvidenceShadow({ ...TRIGGER, intentId: undefined }, deps);
    expect(deps.database.getIntent).not.toHaveBeenCalled();
  });
});

describe('negotiation evidence task isolation and validation', () => {
  it('builds one segment per continuation using only exact task-linked messages and artifacts', async () => {
    const getMessagesByTaskIds = mock(async () => new Map([
      ['task-1', [{ senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose' } }] }]],
      ['task-2', [{ senderId: 'agent:counterparty-1', parts: [{ kind: 'data', data: { action: 'counter' } }] }]],
    ]));
    const getArtifactsForTask = mock(async (taskId: string) => taskId === 'task-2'
      ? [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: { hasOpportunity: true } }] }]
      : []);
    const database: ShadowDatabase = {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => [task('task-1'), task('task-2')]),
      getMessagesByTaskIds,
      getArtifactsForTask,
    };

    const segments = await collectNegotiationEvidenceSegments({
      opportunities: [OPPORTUNITY],
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      currentIntentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }, database);

    expect(getMessagesByTaskIds).toHaveBeenCalledWith(['task-1', 'task-2']);
    expect(getArtifactsForTask.mock.calls.map(([taskId]) => taskId)).toEqual(['task-1', 'task-2']);
    expect(segments.map((segment) => ({
      taskId: segment.taskId,
      conversationId: segment.conversationId,
      actions: segment.turns.map((turn) => turn.action),
      hasOutcome: Boolean(segment.outcome),
    }))).toEqual([
      { taskId: 'task-1', conversationId: 'conversation-task-1', actions: ['propose'], hasOutcome: false },
      { taskId: 'task-2', conversationId: 'conversation-task-2', actions: ['counter'], hasOutcome: true },
    ]);
  });

  it('requires the opportunity and task participant sets to match exactly', async () => {
    expect(getValidatedCounterpartyUserId(OPPORTUNITY, 'owner-1')).toBe('counterparty-1');
    expect(getValidatedCounterpartyUserId({
      ...OPPORTUNITY,
      actors: [...OPPORTUNITY.actors, { userId: 'third-user', role: 'peer' }],
    }, 'owner-1')).toBeNull();

    const database: ShadowDatabase = {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => [
        task('wrong-participant', { candidateUserId: 'third-user' }),
        task('self-task', { candidateUserId: 'owner-1' }),
      ]),
      getMessagesByTaskIds: mock(async () => new Map()),
      getArtifactsForTask: mock(async () => []),
    };
    const segments = await collectNegotiationEvidenceSegments({
      opportunities: [OPPORTUNITY],
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      currentIntentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }, database);
    expect(segments).toEqual([]);
    expect(database.getMessagesByTaskIds).not.toHaveBeenCalled();
  });

  it('canonicalizes exact agent senders and drops bare, foreign, and malformed senders', async () => {
    expect(canonicalizeNegotiationSender('agent:owner-1', 'owner-1', 'counterparty-1')).toBe('owner-1');
    expect(canonicalizeNegotiationSender('agent:counterparty-1', 'owner-1', 'counterparty-1')).toBe('counterparty-1');
    expect(canonicalizeNegotiationSender('owner-1', 'owner-1', 'counterparty-1')).toBeNull();
    expect(canonicalizeNegotiationSender('agent:third-user', 'owner-1', 'counterparty-1')).toBeNull();

    const database: ShadowDatabase = {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => [task('task-1')]),
      getMessagesByTaskIds: mock(async () => new Map([['task-1', [
        { senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose' } }] },
        { senderId: 'agent:counterparty-1', parts: [{ kind: 'data', data: { action: 'counter' } }] },
        { senderId: 'owner-1', parts: [{ kind: 'data', data: { action: 'accept' } }] },
        { senderId: 'agent:third-user', parts: [{ kind: 'data', data: { action: 'decline' } }] },
      ]]])),
      getArtifactsForTask: mock(async () => []),
    };
    const [segment] = await collectNegotiationEvidenceSegments({
      opportunities: [OPPORTUNITY],
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      currentIntentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }, database);
    expect(segment.turns.map((turn) => [turn.senderUserId, turn.action])).toEqual([
      ['owner-1', 'propose'],
      ['counterparty-1', 'counter'],
    ]);
  });

  it('never projects opportunity userAnswers, including synthetic expiry disclosure text', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const secret = 'SECRET_DISCLOSURE_SUBJECT';
    const opportunityWithAnswers = {
      ...OPPORTUNITY,
      metadata: {
        userAnswers: [{
          questionId: 'ask-user-expired-opp-1',
          selectedOptions: [],
          freeText: `(no response) question about ${secret}`,
        }],
      },
    };
    const { deps, capturedSegments } = makeDeps({
      selectPool: mock(async () => [opportunityWithAnswers]),
    });

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedSegments).toHaveLength(1);
    expect(capturedSegments[0][0].ownerAnswers).toBeUndefined();
    expect(JSON.stringify(capturedSegments)).not.toContain(secret);
  });

  it('rejects missing, malformed, duplicate, or drifted task-captured intent snapshots', async () => {
    const validLegacyTurnContext = {
      sourceUser: {
        id: 'owner-1',
        intents: [{ id: 'intent-1', description: INTENT.payload, title: INTENT.summary }],
      },
      candidateUser: { id: 'counterparty-1', intents: [] },
      indexContext: { networkId: 'net-1' },
    };
    const validSnapshot = {
      userId: 'owner-1',
      intentId: 'intent-1',
      description: INTENT.payload,
      title: INTENT.summary,
    };
    const database: ShadowDatabase = {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => [
        task('missing', { intentSnapshots: undefined, turnContext: validLegacyTurnContext }),
        task('not-array', { intentSnapshots: validSnapshot }),
        task('malformed', { intentSnapshots: [{ ...validSnapshot, title: undefined }] }),
        task('duplicate', { intentSnapshots: [validSnapshot, { ...validSnapshot }] }),
        task('drifted', { intentSnapshots: [{ ...validSnapshot, description: 'Changed intent' }] }),
      ]),
      getMessagesByTaskIds: mock(async () => new Map()),
      getArtifactsForTask: mock(async () => []),
    };
    const segments = await collectNegotiationEvidenceSegments({
      opportunities: [OPPORTUNITY],
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      currentIntentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }, database);
    expect(segments).toEqual([]);
    expect(database.getMessagesByTaskIds).not.toHaveBeenCalled();
  });

  it('projects coarse outcomes only when every agreed role belongs to a task participant and is allowlisted', async () => {
    const validOutcome = {
      hasOpportunity: true,
      agreedRoles: [
        { userId: 'owner-1', role: 'patient' },
        { userId: 'counterparty-1', role: 'agent' },
      ],
    };
    const artifactsByTaskId: Record<string, Array<{ name: string; parts: unknown[] }>> = {
      valid: [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: validOutcome }] }],
      foreign: [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: {
        ...validOutcome,
        agreedRoles: [{ userId: 'third-user', role: 'agent' }],
      } }] }],
      invalidRole: [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: {
        ...validOutcome,
        agreedRoles: [{ userId: 'owner-1', role: 'introducer' }],
      } }] }],
      malformed: [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: {
        ...validOutcome,
        agreedRoles: 'agent',
      } }] }],
    };
    const database: ShadowDatabase = {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => [
        task('valid'),
        task('foreign'),
        task('invalidRole'),
        task('malformed'),
      ]),
      getMessagesByTaskIds: mock(async () => new Map()),
      getArtifactsForTask: mock(async (taskId: string) => artifactsByTaskId[taskId] ?? []),
    };

    const segments = await collectNegotiationEvidenceSegments({
      opportunities: [OPPORTUNITY],
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      currentIntentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }, database);

    expect(segments.map((segment) => [segment.taskId, segment.outcome])).toEqual([
      ['valid', validOutcome],
      ['foreign', undefined],
      ['invalidRole', undefined],
      ['malformed', undefined],
    ]);
  });
});

describe('negotiation evidence final revalidation and telemetry', () => {
  it('revalidates owner, lifecycle, archive state, and fingerprint before invoking shadow mining', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const invalidFinalIntents = [
      { ...INTENT, userId: 'other-owner' },
      { ...INTENT, status: 'PAUSED' },
      { ...INTENT, archivedAt: new Date('2026-01-02T00:00:00.000Z') },
      { ...INTENT, payload: 'Drifted current intent' },
    ];

    for (const finalIntent of invalidFinalIntents) {
      let reads = 0;
      const { deps, capturedSegments } = makeDeps();
      deps.database.getIntent = mock(async () => {
        reads += 1;
        return reads === 1 ? INTENT : finalIntent;
      });
      await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);
      expect(capturedSegments).toHaveLength(0);
      expect(reads).toBe(2);
    }
  });

  it('logs only bounded errorClass/errorCode labels for failures', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    class ProviderFailure extends Error {
      code = `provider code ${'x'.repeat(100)}`;
    }
    const failure = new ProviderFailure('SECRET_PROVIDER_RESPONSE_BODY');
    failure.name = `ProviderFailure${'Y'.repeat(100)}`;
    const telemetry = toBoundedErrorTelemetry(failure);
    expect(telemetry.errorClass.length).toBeLessThanOrEqual(64);
    expect(telemetry.errorCode.length).toBeLessThanOrEqual(64);
    expect(JSON.stringify(telemetry)).not.toContain('SECRET_PROVIDER_RESPONSE_BODY');

    const { deps, warnings } = makeDeps();
    deps.database.getIntent = mock(async () => { throw failure; });
    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toEqual({
      source: 'discovery_run',
      intentId: 'intent-1',
      ...telemetry,
    });
    expect(JSON.stringify(warnings)).not.toContain('SECRET_PROVIDER_RESPONSE_BODY');
  });
});
