import { describe, expect, it } from 'bun:test';
import { QUESTION_BUDGET_PER_PRINCIPAL } from '@indexnetwork/protocol';

import { assessExternalConsultationEligibility, buildExternalConsultationQuestionerPayload, consultationActorSetMatchesBinding, consultationExpiryReadiness, type ExternalConsultationEligibilityInput } from '../consultation';

const userId = 'user-owner';
const agentId = 'agent-external';

function fixture(overrides: Partial<ExternalConsultationEligibilityInput> = {}): ExternalConsultationEligibilityInput {
  return {
    task: {
      id: 'task-1',
      state: 'claimed',
      claimedByAgentId: agentId,
      metadata: {
        type: 'negotiation',
        protocolVersion: 'v2',
        sourceUserId: 'user-counterparty',
        candidateUserId: userId,
        initiatorUserId: 'user-counterparty',
        sourceIntentId: 'intent-counterparty',
        candidateIntentId: 'intent-owner',
        opportunityId: 'opportunity-1',
        networkId: 'network-1',
        maxTurns: 6,
        participantBindings: [
          { userId: 'user-counterparty', intentId: 'intent-counterparty', networkId: 'network-1' },
          { userId, intentId: 'intent-owner', networkId: 'network-1' },
        ],
      },
    },
    messages: [
      {
        senderId: `agent:${userId}`,
        turn: {
          action: 'outreach',
          assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
        },
      },
      {
        senderId: 'agent:user-counterparty',
        turn: {
          action: 'counter',
          assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
        },
      },
    ],
    userId,
    agentId,
    policyMode: 'off',
    wiring: { askUserEnabled: true, questionerEnabled: true, expiryEnabled: true },
    ...overrides,
  };
}

describe('counterparty actor binding', () => {
  const base = {
    recipientUserId: 'u-owner',
    recipientIntentId: 'intent-owner',
    networkId: 'net-1',
    counterpartyUserId: 'u-other',
  };
  const actors = (counterparty: Record<string, unknown>) => [
    { userId: 'u-owner', intent: 'intent-owner', networkId: 'net-1' },
    { userId: 'u-other', networkId: 'net-1', ...counterparty },
  ];

  it('fences a premise-bound counterparty against its premise', () => {
    // Premise discovery produces counterparties with no stated intent. The
    // capture used to require one and threw "actor binding is ambiguous", which
    // failed the turn and ended the negotiation as a withdrawal — so the ask
    // was impossible against most of the pool.
    expect(consultationActorSetMatchesBinding({
      ...base,
      actors: actors({ premise: 'premise-1' }),
      counterpartyBinding: { kind: 'premise', id: 'premise-1' },
    })).toBe(true);
  });

  it('fences an intent-bound counterparty against its intent', () => {
    expect(consultationActorSetMatchesBinding({
      ...base,
      actors: actors({ intent: 'intent-other' }),
      counterpartyBinding: { kind: 'intent', id: 'intent-other' },
    })).toBe(true);
  });

  it('never matches across kinds, even when the ids collide', () => {
    // Separate tables, separate id spaces: a premise must not satisfy an
    // intent-bound park just because the strings are equal.
    expect(consultationActorSetMatchesBinding({
      ...base,
      actors: actors({ premise: 'shared-id' }),
      counterpartyBinding: { kind: 'intent', id: 'shared-id' },
    })).toBe(false);
    expect(consultationActorSetMatchesBinding({
      ...base,
      actors: actors({ intent: 'shared-id' }),
      counterpartyBinding: { kind: 'premise', id: 'shared-id' },
    })).toBe(false);
  });

  it('still refuses a counterparty bound to a different id of the same kind', () => {
    expect(consultationActorSetMatchesBinding({
      ...base,
      actors: actors({ premise: 'premise-1' }),
      counterpartyBinding: { kind: 'premise', id: 'premise-2' },
    })).toBe(false);
  });
});

describe('external owner consultation eligibility', () => {
  it('uses one structural predicate and server-derived persisted policy inputs', () => {
    const result = assessExternalConsultationEligibility(fixture({ policyMode: 'on' }));
    expect(result).toMatchObject({
      eligible: true,
      structuralEligible: true,
      policy: { eligible: true, reason: 'consequential_disclosure_permission' },
      coordinates: {
        recipientIntentId: 'intent-owner',
        opportunityId: 'opportunity-1',
        networkId: 'network-1',
        counterpartyUserId: 'user-counterparty',
        counterpartyBinding: { kind: 'intent' as const, id: 'intent-counterparty' },
      },
    });
    expect(result.policyInput).toMatchObject({
      action: 'counter',
      ownSuggestedRole: 'patient',
      priorActions: ['outreach'],
      consultationBudgetSpent: false,
      lifecycleValid: true,
      hasExactResumeCoordinate: true,
    });
  });

  it.each([
    ['uncapped zero remains eligible far beyond six', 0, 20, true],
    ['absent defaults to six at the next turn', undefined, 5, false],
    ['positive remains eligible before its boundary', 4, 2, true],
    ['positive is ineligible at its next-turn boundary', 3, 2, false],
  ] as const)('%s', (_label, maxTurns, turnCount, expected) => {
    const input = fixture();
    if (maxTurns === undefined) delete input.task.metadata.maxTurns;
    else input.task.metadata.maxTurns = maxTurns;
    input.messages = Array.from({ length: turnCount }, (_, index) => ({
      senderId: `agent:${index % 2 === turnCount % 2 ? userId : 'user-counterparty'}`,
      turn: {
        action: index === turnCount - 1 ? 'counter' : 'outreach',
        assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
      },
    }));
    // The claiming owner is eligible only when the final persisted turn is the
    // bound counterparty's canonical turn.
    input.messages[turnCount - 1]!.senderId = 'agent:user-counterparty';

    expect(assessExternalConsultationEligibility(input).eligible).toBe(expected);
  });

  it.each(['off', 'shadow', 'on'] as const)(
    'preserves %s semantics for a structurally valid policy-ineligible turn',
    (policyMode) => {
      const input = fixture({ policyMode });
      input.messages[1] = {
        senderId: 'agent:user-counterparty',
        turn: {
          action: 'counter',
          assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'peer' } },
        },
      };
      const result = assessExternalConsultationEligibility(input);
      expect(result.structuralEligible).toBe(true);
      expect(result.policy).toEqual({ eligible: false });
      expect(result.eligible).toBe(policyMode !== 'on');
    },
  );

  it.each([
    ['v1', (input: ExternalConsultationEligibilityInput) => { input.task.metadata.protocolVersion = 'v1'; }],
    ['opening turn', (input: ExternalConsultationEligibilityInput) => { input.messages = []; }],
    ['final turn', (input: ExternalConsultationEligibilityInput) => { input.task.metadata.maxTurns = 3; }],
    ['wrong claim agent', (input: ExternalConsultationEligibilityInput) => { input.task.claimedByAgentId = 'agent-other'; }],
    ['not claimed', (input: ExternalConsultationEligibilityInput) => { input.task.state = 'waiting_for_agent'; }],
    ['missing exact opportunity', (input: ExternalConsultationEligibilityInput) => { delete input.task.metadata.opportunityId; }],
    ['missing exact intent', (input: ExternalConsultationEligibilityInput) => { input.task.metadata.participantBindings = []; }],
    ['missing exact network', (input: ExternalConsultationEligibilityInput) => { delete input.task.metadata.networkId; }],
    ['disabled ask-user', (input: ExternalConsultationEligibilityInput) => { input.wiring.askUserEnabled = false; }],
    ['disabled Questioner', (input: ExternalConsultationEligibilityInput) => { input.wiring.questionerEnabled = false; }],
    ['disabled expiry', (input: ExternalConsultationEligibilityInput) => { input.wiring.expiryEnabled = false; }],
    ['a spent per-principal question budget', (input: ExternalConsultationEligibilityInput) => {
      for (let i = 0; i < QUESTION_BUDGET_PER_PRINCIPAL; i++) {
        input.messages.unshift({
          senderId: `agent:${userId}`,
          turn: { action: 'ask_user', assessment: { suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } } },
        });
      }
    }],
    ['last turn from same seat', (input: ExternalConsultationEligibilityInput) => { input.messages[1].senderId = `agent:${userId}`; }],
    ['wrong participant sender', (input: ExternalConsultationEligibilityInput) => { input.messages[1].senderId = 'agent:user-unrelated'; }],
    ['system sender', (input: ExternalConsultationEligibilityInput) => { input.messages[1].senderId = 'system:negotiation-timeout'; }],
    ['terminal persisted action', (input: ExternalConsultationEligibilityInput) => { input.messages[1].turn.action = 'decline'; }],
  ] as const)('fails closed for %s', (_label, mutate) => {
    const input = fixture();
    mutate(input);
    expect(assessExternalConsultationEligibility(input).eligible).toBe(false);
  });

  it('retries only an exact external expiry observed before its pause commit', () => {
    const eligible = fixture();
    const coordinates = {
      taskId: 'task-1',
      consultationAttemptId: 'attempt-1',
      claimedByAgentId: agentId,
      settlementId: 'negotiation-question-settlement-v1-task-1',
      userId,
      recipientIntentId: 'intent-owner',
      opportunityId: 'opportunity-1',
      networkId: 'network-1',
      intentFingerprint: 'fingerprint',
      opportunityStatus: 'negotiating',
      opportunityUpdatedAt: '2026-08-07T00:00:00.000Z',
      counterpartyUserId: 'user-counterparty',
      counterpartyBinding: { kind: 'intent' as const, id: 'intent-counterparty' },
    };

    expect(consultationExpiryReadiness({
      taskState: 'claimed',
      taskClaimedByAgentId: agentId,
      taskMetadata: eligible.task.metadata,
      coordinates,
    })).toBe('pending_pause');
    expect(consultationExpiryReadiness({
      taskState: 'claimed',
      taskClaimedByAgentId: 'agent-reclaimed',
      taskMetadata: eligible.task.metadata,
      coordinates,
    })).toBe('terminal_stale');
    expect(consultationExpiryReadiness({
      taskState: 'claimed',
      taskClaimedByAgentId: agentId,
      taskMetadata: eligible.task.metadata,
      coordinates: { ...coordinates, counterpartyBinding: { kind: 'intent' as const, id: 'intent-stale' } },
    })).toBe('terminal_stale');
    expect(consultationExpiryReadiness({
      taskState: 'claimed',
      taskClaimedByAgentId: agentId,
      taskMetadata: eligible.task.metadata,
      coordinates: { ...coordinates, counterpartyUserId: 'user-unrelated' },
    })).toBe('terminal_stale');
    expect(consultationExpiryReadiness({
      taskState: 'completed',
      taskClaimedByAgentId: agentId,
      taskMetadata: eligible.task.metadata,
      coordinates,
    })).toBe('terminal_stale');
  });

  it('mirrors Questioner actor cardinality while fencing the exact bound counterparty intent', () => {
    const canonical = {
      actors: [
        { userId, intent: 'intent-owner', networkId: 'network-1', role: 'peer' },
        { userId: 'user-counterparty', intent: 'intent-counterparty', networkId: 'network-1', role: 'peer' },
      ],
      recipientUserId: userId,
      recipientIntentId: 'intent-owner',
      networkId: 'network-1',
      counterpartyUserId: 'user-counterparty',
      counterpartyBinding: { kind: 'intent' as const, id: 'intent-counterparty' },
    };
    expect(consultationActorSetMatchesBinding(canonical)).toBe(true);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [...canonical.actors, canonical.actors[1]],
    })).toBe(true);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [...canonical.actors, { ...canonical.actors[1], intent: 'intent-stale' }],
    })).toBe(true);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [canonical.actors[0], { ...canonical.actors[1], intent: 'intent-stale' }],
    })).toBe(false);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [...canonical.actors, canonical.actors[0]],
    })).toBe(false);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [...canonical.actors, { userId: 'foreign', intent: 'foreign-intent', networkId: 'network-2', role: 'peer' }],
    })).toBe(false);
    expect(consultationActorSetMatchesBinding({
      ...canonical,
      actors: [...canonical.actors, { userId: 'introducer', networkId: 'network-2', role: 'introducer' }],
    })).toBe(true);
  });

  it('builds only privacy-minimal Questioner context', () => {
    const result = assessExternalConsultationEligibility(fixture({ policyMode: 'on' }));
    if (!result.eligible || !result.coordinates) throw new Error('fixture must be eligible');
    const payload = buildExternalConsultationQuestionerPayload({
      negotiationId: 'task-1',
      userId,
      coordinates: result.coordinates,
      reason: result.policy.reason ?? 'consequential_disclosure_permission',
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('user-counterparty');
    expect(serialized).not.toContain('intent-counterparty');
    expect(serialized).not.toContain('Alice Counterparty');
    expect(payload.context).toMatchObject({
      counterpartyHint: 'the other participant',
      indexContext: 'the selected network',
      consultationPolicyReason: 'consequential_disclosure_permission',
    });
    expect(payload.context).not.toHaveProperty('disclosureSubject');
    expect(payload.context).not.toHaveProperty('draftQuestion');
  });

  // An unreachable principal — a seed persona today — has nobody who could
  // ever answer. Refused structurally, so no policy mode can admit it and the
  // pickup path never advertises the move either.
  it.each(['off', 'shadow', 'on'] as const)(
    'refuses an unreachable recipient in %s mode',
    (policyMode) => {
      const eligible = assessExternalConsultationEligibility(fixture({ policyMode }));
      expect(eligible.structuralEligible).toBe(true);

      const refused = assessExternalConsultationEligibility(fixture({
        policyMode,
        recipientPrincipalUnreachable: true,
      }));
      expect(refused.structuralEligible).toBe(false);
      expect(refused.eligible).toBe(false);
    },
  );

  it('leaves a reachable recipient exactly as before', () => {
    const stated = assessExternalConsultationEligibility(fixture({
      policyMode: 'on',
      recipientPrincipalUnreachable: false,
    }));
    expect(stated).toEqual(assessExternalConsultationEligibility(fixture({ policyMode: 'on' })));
  });
});

describe('consultation claim and layering source invariants', () => {
  it('keeps the pure policy service-free and fences claimed-to-working by exact agent', async () => {
    const [policySource, adapterSource] = await Promise.all([
      Bun.file('src/lib/negotiation/consultation.ts').text(),
      Bun.file('src/adapters/conversation.database.adapter.ts').text(),
    ]);
    expect(policySource).not.toMatch(/from ['"][^'"]*services\//);
    expect(adapterSource).toContain('eq(schema.tasks.claimedByAgentId, claimedByAgentId)');
    expect(adapterSource).toContain('pauseClaimedNegotiationForConsultation');
    expect(adapterSource).toContain('consultationAttemptId: input.consultationAttemptId');
    expect(adapterSource).toContain("state: 'input_required'");
  });
});
