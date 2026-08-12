import { describe, expect, it } from 'bun:test';

import { authenticateApiKey } from '../../../services/api/src/guards/auth.guard';
import { NegotiationPollingAuthorization } from '../../../services/api/src/lib/agent/negotiation-polling-authorization';
import { assessExternalConsultationEligibility, buildExternalConsultationQuestionerPayload } from '../../../services/api/src/lib/negotiation/consultation';
import { getRequestAuthContext } from '../../../services/api/src/lib/request-auth-context';
import { AgentDispatcherImpl } from '../../../services/api/src/services/agent-dispatcher.service';
import { AgentRuntimeService } from '../../../services/api/src/services/agent-runtime.service';
import { AgentRuntimeTransactionHarness } from '../../../services/api/tests/support/agent-runtime-transaction.harness';
import { runHermesSelectionSaga, selectIndexRuntime, disconnectHermesSaga } from './agent-runtime-saga.mjs';

const OWNER_ID = 'task-5-owner';
const INSTALLATION = 'task-5-installation';
const ATTEMPT = 'task-5-attempt';

describe('Task 5 production-boundary acceptance', () => {
  it('composes the real runtime service, auth, polling authorization, dispatcher, consultation policy, and Mac saga', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const runtime = new AgentRuntimeService(persistence);
    const polling = new NegotiationPollingAuthorization(persistence);
    const prepared = await runtime.prepareHermes(OWNER_ID, INSTALLATION, ATTEMPT);
    const transientKey = prepared.credential.key;
    const transientCredentialId = prepared.credential.id;
    const connectorStatus = {
      connected: true, health: 'active', revocationPending: false,
      installationId: INSTALLATION, agentId: prepared.executorId, setupAttemptId: ATTEMPT,
      actions: [
        'manage:identity', 'manage:premises', 'manage:intents',
        'manage:networks', 'manage:opportunities', 'manage:negotiations',
      ],
      expiresAt: new Date(Date.now() + 29 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const api = {
      setRuntimeBinding: (input: Parameters<AgentRuntimeService['setRuntime']>[1]) => (
        runtime.setRuntime(OWNER_ID, input)
      ),
      getRuntimeBinding: (installationId: string) => runtime.getRuntime(OWNER_ID, installationId),
      rollbackHermesRuntime: async (setupAttemptId: string) => ({
        rolledBack: await runtime.rollbackHermes(OWNER_ID, setupAttemptId),
      }),
      compareAndSelectIndex: (expected: {
        agentId: string; installationId: string; setupAttemptId: string;
      }) => runtime.compareAndSelectIndex(OWNER_ID, expected),
    };

    let local = {
      ownerId: OWNER_ID,
      installationId: INSTALLATION,
      executorId: null as string | null,
      setupAttemptId: null as string | null,
      pluginInstalled: false,
      negotiatorMode: false,
      schedulePresent: false,
      scheduleEnabled: false,
    };
    const nativeRuntime = async (command: string, payload: Record<string, string> = {}) => {
      if (command === 'connectorStatus') {
        return { ok: true, stage: 'connector_status', connectorStatus };
      }
      if (command === 'configureDisabled') {
        local = {
          ownerId: payload.ownerId,
          installationId: payload.installationId,
          executorId: payload.executorId,
          setupAttemptId: payload.setupAttemptId,
          pluginInstalled: true, negotiatorMode: true,
          schedulePresent: true, scheduleEnabled: false,
        };
        return {
          ok: true, stage: 'connectorActivationConfirmed', state: local, connectorStatus,
        };
      }
      if (command === 'enable') {
        local = { ...local, scheduleEnabled: true };
        return { ok: true, stage: 'awaitingHeartbeat', state: local };
      }
      if (command === 'confirmHealthy') return { ok: true, stage: 'confirmed_healthy', state: local };
      if (command === 'disable') {
        if (payload.setupAttemptId === local.setupAttemptId) local = { ...local, scheduleEnabled: false };
        return { ok: true, stage: 'disabled', state: local };
      }
      if (command === 'prepareLogout') {
        local = { ...local, negotiatorMode: false, scheduleEnabled: false };
        return { ok: true, stage: 'logout_prepared', state: local };
      }
      if (command === 'connectorDisconnect') {
        persistence.revokeCredentialsForAgent(prepared.executorId);
        return { ok: true, stage: 'connector_disconnected', connectorStatus: {
          connected: false, health: 'disconnected', revocationPending: false,
          installationId: INSTALLATION, agentId: null, setupAttemptId: null,
          actions: [], expiresAt: null,
        } };
      }
      if (command === 'disconnect') {
        if (payload.setupAttemptId === local.setupAttemptId) {
          local = {
            ...local, executorId: null, setupAttemptId: null,
            pluginInstalled: false, negotiatorMode: false,
            schedulePresent: false, scheduleEnabled: false,
          };
        }
        return { ok: true, stage: 'disconnected', state: local };
      }
      throw new Error(`unexpected native command ${command}`);
    };

    const selected = await runHermesSelectionSaga({
      api,
      nativeRuntime,
      ownerId: OWNER_ID,
      installationId: INSTALLATION,
      setupAttemptId: ATTEMPT,
      waitForHealth: async ({ executorId }: { executorId: string }) => {
        await persistence.touchNegotiationPickup(executorId);
        return runtime.getRuntime(OWNER_ID, INSTALLATION);
      },
    });
    const executorId = selected.binding.executor?.id;
    expect(executorId).toBeString();
    expect(selected.binding.installation).toEqual({
      executorId,
      installationId: INSTALLATION,
      setupAttemptId: ATTEMPT,
      status: 'active',
    });

    const negotiatorRequest = new Request('https://protocol.example/api/agents/me');
    const authenticated = await authenticateApiKey(
      negotiatorRequest,
      transientKey,
      persistence,
    );
    expect(authenticated.id).toBe(OWNER_ID);
    expect(getRequestAuthContext(negotiatorRequest)).toEqual({
      kind: 'api_key',
      agentId: executorId,
      credentialId: transientCredentialId,
      audience: 'hermes-negotiator',
      setupAttemptId: ATTEMPT,
    });
    expect(await polling.isAuthorized(executorId!, OWNER_ID)).toBe(true);

    const timeoutJobs: Array<[string, number, number, string]> = [];
    const dispatcher = new AgentDispatcherImpl(
      {
        findAuthorizedAgents: async () => {
          if (!await polling.isAuthorized(executorId!, OWNER_ID)) return [];
          const agent = await persistence.getAgentWithRelations(executorId!);
          return agent ? [agent] : [];
        },
      },
      {
        enqueueTimeout: async (negotiationId: string, attempt: number, timeoutMs: number, parkGeneration: string) => {
          timeoutJobs.push([negotiationId, attempt, timeoutMs, parkGeneration]);
          return 'timeout-job';
        },
      } as ConstructorParameters<typeof AgentDispatcherImpl>[1],
    );
    const dispatch = await dispatcher.dispatch(
      OWNER_ID,
      { action: 'negotiation.respond', scopeType: 'network', scopeId: 'network-1' },
      { negotiationId: 'negotiation-1', history: [] },
      { timeoutMs: 5_000 },
    );
    expect(dispatch).toMatchObject({ reason: 'waiting', resumeToken: expect.any(String) });
    expect(timeoutJobs).toEqual([[
      'negotiation-1', 0, 5_000, (dispatch as { resumeToken: string }).resumeToken,
    ]]);

    const consultation = assessExternalConsultationEligibility({
      task: {
        id: 'task-1', state: 'claimed', claimedByAgentId: executorId!,
        metadata: {
          type: 'negotiation', protocolVersion: 'v2',
          sourceUserId: 'counterparty', candidateUserId: OWNER_ID,
          initiatorUserId: 'counterparty', opportunityId: 'opportunity-1',
          networkId: 'network-1', maxTurns: 6,
          participantBindings: [
            { userId: 'counterparty', intentId: 'intent-counterparty', networkId: 'network-1' },
            { userId: OWNER_ID, intentId: 'intent-owner', networkId: 'network-1' },
          ],
        },
      },
      messages: [
        { senderId: `agent:${OWNER_ID}`, turn: { action: 'outreach' } },
        {
          senderId: 'agent:counterparty',
          turn: { action: 'counter', assessment: { suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } } },
        },
      ],
      userId: OWNER_ID, agentId: executorId!, policyMode: 'on',
      wiring: { askUserEnabled: true, questionerEnabled: true, expiryEnabled: true },
    });
    expect(consultation).toMatchObject({
      eligible: true,
      structuralEligible: true,
      policy: { eligible: true, reason: 'consequential_disclosure_permission' },
    });
    const consultationPayload = buildExternalConsultationQuestionerPayload({
      negotiationId: 'task-1',
      userId: OWNER_ID,
      coordinates: consultation.coordinates!,
      reason: consultation.policy.reason!,
    });
    expect(consultationPayload.context).toEqual({
      negotiationId: 'task-1',
      counterpartyHint: 'the other participant',
      indexContext: 'the selected network',
      consultationPolicyReason: 'consequential_disclosure_permission',
    });
    expect(consultationPayload.context).not.toHaveProperty('disclosureSubject');
    expect(consultationPayload.context).not.toHaveProperty('draftQuestion');

    await selectIndexRuntime({
      api, nativeRuntime, ownerId: OWNER_ID,
      installationId: INSTALLATION, localState: selected.localState,
    });
    expect(await polling.isAuthorized(executorId!, OWNER_ID)).toBe(false);
    expect((await dispatcher.dispatch(
      OWNER_ID,
      { action: 'negotiation.respond', scopeType: 'network', scopeId: 'network-1' },
      { negotiationId: 'negotiation-2', history: [] },
      { timeoutMs: 5_000 },
    )).reason).toBe('no_agent');

    await disconnectHermesSaga({
      api, nativeRuntime, ownerId: OWNER_ID, installationId: INSTALLATION,
      setupAttemptId: ATTEMPT, executorId,
    });
    await expect(authenticateApiKey(
      new Request('https://protocol.example/api/agent-runtime'),
      transientKey,
      persistence,
    )).rejects.toThrow('Invalid API key');
    expect(local).toMatchObject({
      setupAttemptId: null, pluginInstalled: false,
      schedulePresent: false, scheduleEnabled: false,
    });

    // The guarded Task 2 PostgreSQL E2E remains authority for exact durable
    // answer/dismiss/expiry continuation. This provider-free test does not
    // claim to execute a database transaction.
  });
});
