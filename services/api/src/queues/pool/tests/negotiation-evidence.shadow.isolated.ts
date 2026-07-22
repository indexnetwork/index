import { afterEach, describe, expect, it, mock } from 'bun:test';

import { runNegotiationEvidenceShadow } from '@indexnetwork/protocol';
import type { NegotiationEvidenceMiner, RawEvidenceSegment } from '@indexnetwork/protocol';

import { computeIntentFingerprint } from '../../../lib/intent/intent.fingerprint';
import { canonicalizeNegotiationSender, collectNegotiationEvidenceSegments, deriveTaskNetworkBinding, getValidatedCounterpartyUserId, maybeRunNegotiationEvidenceShadow, toBoundedErrorTelemetry } from '../negotiation-evidence.shadow';
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

type ShadowScope = Parameters<NegotiationEvidenceShadowDeps['runShadow']>[0]['scope'];

function makeDeps(overrides: Partial<NegotiationEvidenceShadowDeps> = {}): {
  deps: NegotiationEvidenceShadowDeps;
  capturedSegments: RawEvidenceSegment[][];
  capturedScopes: ShadowScope[];
  warnings: Array<Record<string, unknown> | undefined>;
  infos: Array<Record<string, unknown> | undefined>;
  debugs: Array<Record<string, unknown> | undefined>;
} {
  const capturedSegments: RawEvidenceSegment[][] = [];
  const capturedScopes: ShadowScope[] = [];
  const warnings: Array<Record<string, unknown> | undefined> = [];
  const infos: Array<Record<string, unknown> | undefined> = [];
  const debugs: Array<Record<string, unknown> | undefined> = [];
  const database: ShadowDatabase = {
    getIntent: mock(async () => INTENT),
    getNegotiationTasksForOpportunity: mock(async () => [task('task-1')]),
    getMessagesByTaskIds: mock(async () => new Map([
      ['task-1', [{ senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose', message: 'hello' } }] }]],
    ])),
    getArtifactsForTask: mock(async () => []),
    getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
  };
  const runShadow: NegotiationEvidenceShadowDeps['runShadow'] = async (input) => {
    capturedSegments.push(input.segments);
    capturedScopes.push(input.scope);
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
      debug: mock((_message, metadata) => { debugs.push(metadata); }),
      info: mock((_message, metadata) => { infos.push(metadata); }),
      warn: mock((_message, metadata) => { warnings.push(metadata); }),
    },
    ...overrides,
  };
  return { deps, capturedSegments, capturedScopes, warnings, infos, debugs };
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
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
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
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
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
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
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
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
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
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => []),
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

describe('IND-465 — network binding derived from capture-time task metadata', () => {
  const DERIVATION_INPUT = {
    recipientUserId: 'owner-1',
    intentId: 'intent-1',
    currentIntentFingerprint: FINGERPRINT,
  };

  it('binds exactly one distinct non-empty task networkId and fails closed otherwise', () => {
    // Single network across several tasks (empty/missing values ignored) → bound.
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: {} }, [
      task('a'),
      task('b', { networkId: '' }),
      task('c', { networkId: undefined }),
    ], DERIVATION_INPUT)).toEqual({ outcome: 'bound', networkId: 'net-1' });

    // Task disagreement → skip.
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: {} }, [
      task('a'),
      task('b', { networkId: 'net-2' }),
    ], DERIVATION_INPUT)).toEqual({ outcome: 'network_disagreement' });

    // Zero task networkIds (or no structurally valid tasks at all) → skip.
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: {} }, [
      task('a', { networkId: undefined }),
    ], DERIVATION_INPUT)).toEqual({ outcome: 'no_task_network' });
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: {} }, [], DERIVATION_INPUT))
      .toEqual({ outcome: 'no_task_network' });

    // Structurally invalid tasks never contribute a (dis)agreeing networkId.
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: {} }, [
      task('a'),
      task('drifted', { networkId: 'net-2', intentSnapshots: [{ userId: 'owner-1', intentId: 'intent-1', description: 'Changed intent', title: INTENT.summary }] }),
    ], DERIVATION_INPUT)).toEqual({ outcome: 'bound', networkId: 'net-1' });

    // Present-but-different context → contamination guard; context never overrides tasks.
    expect(deriveTaskNetworkBinding({ ...OPPORTUNITY, context: { networkId: 'net-2' } }, [
      task('a'),
    ], DERIVATION_INPUT)).toEqual({ outcome: 'context_mismatch' });

    // Agreeing context stays bound.
    expect(deriveTaskNetworkBinding(OPPORTUNITY, [task('a')], DERIVATION_INPUT))
      .toEqual({ outcome: 'bound', networkId: 'net-1' });
  });

  it('mines an opportunity whose context.networkId is absent (the IND-433 NO-GO scenario)', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const { deps, capturedScopes, capturedSegments, infos } = makeDeps({
      selectPool: mock(async () => [{ ...OPPORTUNITY, context: {} }]),
    });

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedScopes).toEqual([{
      recipientUserId: 'owner-1',
      intentId: 'intent-1',
      intentFingerprint: FINGERPRINT,
      networkId: 'net-1',
    }]);
    expect(capturedSegments[0].map((segment) => segment.networkId)).toEqual(['net-1']);
    expect(infos[0]).toMatchObject({
      skippedNoTaskNetwork: 0,
      skippedNetworkDisagreement: 0,
      skippedContextMismatch: 0,
      terminalStatusIncluded: 0,
    });
  });

  it('skips fail-closed opportunities and logs only aggregate skip counts', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const tasksByOpportunityId: Record<string, ReturnType<typeof task>[]> = {
      'opp-disagree': [
        task('d1', { opportunityId: 'opp-disagree' }),
        task('d2', { opportunityId: 'opp-disagree', networkId: 'net-2' }),
      ],
      'opp-no-network': [task('n1', { opportunityId: 'opp-no-network', networkId: undefined })],
      'opp-context-mismatch': [task('c1', { opportunityId: 'opp-context-mismatch' })],
    };
    const { deps, capturedSegments, debugs } = makeDeps({
      selectPool: mock(async () => [
        { ...OPPORTUNITY, id: 'opp-disagree', context: {} },
        { ...OPPORTUNITY, id: 'opp-no-network', context: {} },
        { ...OPPORTUNITY, id: 'opp-context-mismatch', context: { networkId: 'net-9' } },
      ]),
    });
    deps.database.getNegotiationTasksForOpportunity = mock(
      async (opportunityId: string) => tasksByOpportunityId[opportunityId] ?? [],
    );

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedSegments).toHaveLength(0);
    expect(debugs).toHaveLength(1);
    expect(debugs[0]).toMatchObject({
      skippedNoTaskNetwork: 1,
      skippedNetworkDisagreement: 1,
      skippedContextMismatch: 1,
    });
    expect(JSON.stringify(debugs)).not.toContain('opp-disagree');
    expect(JSON.stringify(debugs)).not.toContain('net-2');
  });

  it('mines only the largest derived-network group and still excludes sibling tasks from other networks', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const tasksByOpportunityId: Record<string, ReturnType<typeof task>[]> = {
      // Bound to net-1; the empty-network sibling stays excluded from segments
      // by the unrelaxed validateTask pass-network equality.
      'opp-1': [task('t1', { opportunityId: 'opp-1' }), task('t1-sibling', { opportunityId: 'opp-1', networkId: '' })],
      'opp-2': [task('t2', { opportunityId: 'opp-2' })],
      'opp-3': [task('t3', { opportunityId: 'opp-3', networkId: 'net-2' })],
    };
    const { deps, capturedScopes, capturedSegments } = makeDeps({
      selectPool: mock(async () => [
        { ...OPPORTUNITY, id: 'opp-1', context: {} },
        { ...OPPORTUNITY, id: 'opp-2', context: {} },
        { ...OPPORTUNITY, id: 'opp-3', context: {} },
      ]),
    });
    deps.database.getNegotiationTasksForOpportunity = mock(
      async (opportunityId: string) => tasksByOpportunityId[opportunityId] ?? [],
    );
    deps.database.getMessagesByTaskIds = mock(async (taskIds: string[]) => new Map(
      taskIds.map((taskId) => [taskId, [{ senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose', message: null } }] }]]),
    ));

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedScopes.map((scope) => scope.networkId)).toEqual(['net-1']);
    expect(capturedSegments[0].map((segment) => [segment.opportunityId, segment.taskId])).toEqual([
      ['opp-1', 't1'],
      ['opp-2', 't2'],
    ]);
    // Derivation-time tasks are reused; no second fetch per pass opportunity.
    expect(deps.database.getNegotiationTasksForOpportunity).toHaveBeenCalledTimes(3);
  });

  it('counts terminal-status opportunities in the pass with aggregate telemetry only', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const { deps, capturedSegments, infos } = makeDeps({
      selectPool: mock(async () => [
        { ...OPPORTUNITY, id: 'opp-1', status: 'rejected', context: {} },
      ]),
    });

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedSegments).toHaveLength(1);
    expect(infos[0]).toMatchObject({ terminalStatusIncluded: 1 });
  });

  it('keeps the k>=5 distinct-opportunity floor and scope matching untouched', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const run = async (poolSize: number) => {
      const mine = mock(async () => []);
      const opportunities = Array.from({ length: poolSize }, (_, i) => ({
        ...OPPORTUNITY,
        id: `opp-${i + 1}`,
        context: {},
      }));
      const { deps, infos } = makeDeps({
        selectPool: mock(async () => opportunities),
        runShadow: runNegotiationEvidenceShadow,
        getMiner: () => ({ mine } as unknown as NegotiationEvidenceMiner),
      });
      deps.database.getNegotiationTasksForOpportunity = mock(
        async (opportunityId: string) => [task(`task-${opportunityId}`, { opportunityId })],
      );
      deps.database.getMessagesByTaskIds = mock(async (taskIds: string[]) => new Map(
        taskIds.map((taskId) => [taskId, [{ senderId: 'agent:owner-1', parts: [{ kind: 'data', data: { action: 'propose', message: null } }] }]]),
      ));
      await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);
      return { mine, infos };
    };

    const below = await run(4);
    expect(below.mine).not.toHaveBeenCalled();
    expect(below.infos[0]).toMatchObject({ distinctOpportunities: 4, hypothesesMined: 0 });

    const atFloor = await run(5);
    expect(atFloor.mine).toHaveBeenCalledTimes(1);
    expect(atFloor.infos[0]).toMatchObject({ distinctOpportunities: 5 });
  });
});

describe('IND-465 slice 2 — answeredBy-verified owner answers', () => {
  const COLLECT_INPUT = {
    opportunities: [OPPORTUNITY],
    recipientUserId: 'owner-1',
    intentId: 'intent-1',
    currentIntentFingerprint: FINGERPRINT,
    networkId: 'net-1',
  };

  function databaseWithAnswers(
    answers: Awaited<ReturnType<ShadowDatabase['getAnsweredNegotiationQuestionsForOpportunity']>>,
    tasks: ShadowTask[] = [task('task-1')],
  ): ShadowDatabase {
    return {
      getIntent: mock(async () => INTENT),
      getNegotiationTasksForOpportunity: mock(async () => tasks),
      getMessagesByTaskIds: mock(async () => new Map()),
      getArtifactsForTask: mock(async () => []),
      getAnsweredNegotiationQuestionsForOpportunity: mock(async () => answers),
    };
  }

  it('projects answers answered by the recipient and re-checks authority and fingerprint fail-closed', async () => {
    const database = databaseWithAnswers([
      // Verified: recipient answered, no captured fingerprint.
      { answeredBy: 'owner-1', selectedOptions: ['Yes, share it'], freeText: 'Prefer async collaboration' },
      // Verified: matching captured fingerprint tolerated and kept.
      { answeredBy: 'owner-1', selectedOptions: ['Fresh answer'], capturedIntentFingerprint: FINGERPRINT },
      // Excluded: answered by the counterparty (authority re-check).
      { answeredBy: 'counterparty-1', selectedOptions: ['Leaked counterparty answer'] },
      // Excluded: captured fingerprint drifted from the current intent.
      { answeredBy: 'owner-1', selectedOptions: ['Stale answer'], capturedIntentFingerprint: 'drifted-fingerprint' },
      // Excluded: empty answer content.
      { answeredBy: 'owner-1', selectedOptions: [], freeText: '   ' },
    ]);

    const [segment] = await collectNegotiationEvidenceSegments(COLLECT_INPUT, database);

    expect(database.getAnsweredNegotiationQuestionsForOpportunity)
      .toHaveBeenCalledWith('owner-1', 'opp-1', FINGERPRINT);
    expect(segment.ownerAnswers).toEqual([
      { answererUserId: 'owner-1', selectedOptions: ['Yes, share it'], freeText: 'Prefer async collaboration' },
      { answererUserId: 'owner-1', selectedOptions: ['Fresh answer'] },
    ]);
    expect(JSON.stringify(segment)).not.toContain('Leaked counterparty answer');
    expect(JSON.stringify(segment)).not.toContain('Stale answer');
  });

  it('keeps ownerAnswers undefined when no verified answers exist', async () => {
    const [segment] = await collectNegotiationEvidenceSegments(COLLECT_INPUT, databaseWithAnswers([]));
    expect(segment.ownerAnswers).toBeUndefined();
    expect('ownerAnswers' in segment).toBe(false);
  });

  it('fetches answers once per opportunity, scoped to that opportunity id, and shares them across continuations', async () => {
    const database = databaseWithAnswers(
      [{ answeredBy: 'owner-1', selectedOptions: ['Shared across continuations'] }],
      [task('task-1'), task('task-2')],
    );

    const segments = await collectNegotiationEvidenceSegments(COLLECT_INPUT, database);

    expect(database.getAnsweredNegotiationQuestionsForOpportunity).toHaveBeenCalledTimes(1);
    expect(database.getAnsweredNegotiationQuestionsForOpportunity)
      .toHaveBeenCalledWith('owner-1', 'opp-1', FINGERPRINT);
    expect(segments.map((segment) => [segment.taskId, segment.ownerAnswers])).toEqual([
      ['task-1', [{ answererUserId: 'owner-1', selectedOptions: ['Shared across continuations'] }]],
      ['task-2', [{ answererUserId: 'owner-1', selectedOptions: ['Shared across continuations'] }]],
    ]);
  });

  it('never fetches answers for opportunities without validated tasks', async () => {
    const database = databaseWithAnswers(
      [{ answeredBy: 'owner-1', selectedOptions: ['Should never be fetched'] }],
      [task('wrong-participant', { candidateUserId: 'third-user' })],
    );

    const segments = await collectNegotiationEvidenceSegments(COLLECT_INPUT, database);

    expect(segments).toEqual([]);
    expect(database.getAnsweredNegotiationQuestionsForOpportunity).not.toHaveBeenCalled();
  });

  it('projects verified owner answers end-to-end through the shadow pass', async () => {
    process.env.NEGOTIATION_EVIDENCE_QUESTIONS_MODE = 'shadow';
    const { deps, capturedSegments } = makeDeps();
    deps.database.getAnsweredNegotiationQuestionsForOpportunity = mock(async () => [
      { answeredBy: 'owner-1', selectedOptions: ['Weekly sync works'] },
    ]);

    await maybeRunNegotiationEvidenceShadow(TRIGGER, deps);

    expect(capturedSegments).toHaveLength(1);
    expect(capturedSegments[0][0].ownerAnswers).toEqual([
      { answererUserId: 'owner-1', selectedOptions: ['Weekly sync works'] },
    ]);
  });
});
