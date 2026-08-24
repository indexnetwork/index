import { describe, expect, it } from 'bun:test';

import { authenticateApiKey } from '../../../services/api/src/guards/auth.guard';
import { getRequestAuthContext } from '../../../services/api/src/lib/request-auth-context';
import { AgentRuntimeService } from '../../../services/api/src/services/agent-runtime.service';
import { AgentRuntimeTransactionHarness } from '../../../services/api/tests/support/agent-runtime-transaction.harness';
import { runHermesSelectionSaga, selectIndexRuntime, disconnectHermesSaga } from './agent-runtime-saga.mjs';

const OWNER_ID = 'task-5-owner';
const INSTALLATION = 'task-5-installation';
const ATTEMPT = 'task-5-attempt';

describe('Task 5 production-boundary acceptance', () => {
  it('composes the real runtime service, auth, executor binding, and Mac saga', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser({ id: OWNER_ID, email: 'owner@example.com', name: 'Owner' });
    const runtime = new AgentRuntimeService(persistence);
    let transientKey = '';
    let transientCredentialId = '';

    const api = {
      prepareHermesRuntime: async (installationId: string, setupAttemptId: string) => {
        const result = await runtime.prepareHermes(OWNER_ID, installationId, setupAttemptId);
        transientKey = result.credential.key;
        transientCredentialId = result.credential.id;
        return result;
      },
      setRuntimeBinding: (input: Parameters<AgentRuntimeService['setRuntime']>[1]) => (
        runtime.setRuntime(OWNER_ID, input)
      ),
      getRuntimeBinding: (installationId: string) => runtime.getRuntime(OWNER_ID, installationId),
      rollbackHermesRuntime: async (setupAttemptId: string) => ({
        rolledBack: await runtime.rollbackHermes(OWNER_ID, setupAttemptId),
      }),
      disconnectHermesRuntime: (installationId: string) => runtime.disconnectHermes(OWNER_ID, installationId),
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
      if (command === 'configureDisabled') {
        local = {
          ownerId: payload.ownerId,
          installationId: payload.installationId,
          executorId: payload.executorId,
          setupAttemptId: payload.setupAttemptId,
          pluginInstalled: true, negotiatorMode: false,
          schedulePresent: false, scheduleEnabled: false,
        };
        return { ok: true, stage: 'scheduleDisabled', state: local };
      }
      if (command === 'enable') {
        return { ok: true, stage: 'awaitingHeartbeat', state: local };
      }
      if (command === 'confirmHealthy') return { ok: true, stage: 'confirmed_healthy', state: local };
      if (command === 'disable') {
        if (payload.setupAttemptId === local.setupAttemptId) local = { ...local, scheduleEnabled: false };
        return { ok: true, stage: 'disabled', state: local };
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
    expect(await persistence.getNegotiationExecutorBinding(OWNER_ID)).not.toBeNull();

    await selectIndexRuntime({
      api, nativeRuntime, ownerId: OWNER_ID,
      installationId: INSTALLATION, localState: selected.localState,
    });
    expect(await persistence.getNegotiationExecutorBinding(OWNER_ID)).toBeNull();

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
