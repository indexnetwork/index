import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { AgentRuntimeController } from '../agent-runtime.controller';
import { authenticateApiKey, OwnerControlGuard, OwnerControlRequiredError } from '../../guards/auth.guard';
import { RuntimeConflictError, RuntimeNotFoundError, RuntimeValidationError } from '../../lib/agent/runtime-errors';
import { recordRequestAuthContext } from '../../lib/request-auth-context';
import { AgentRuntimeService } from '../../services/agent-runtime.service';
import { AgentRuntimeTransactionHarness } from '../../../tests/support/agent-runtime-transaction.harness';

const OWNER = { id: 'owner-1', email: 'owner@example.com', name: 'Owner' };
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const SETUP_ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTOR_ID = '33333333-3333-4333-8333-333333333333';
const binding = {
  selectedRuntime: 'index' as const,
  executor: null,
  installation: null,
  health: 'never-seen' as const,
  indexCovering: true,
  freshnessThresholdMs: 90_000,
};

const getRuntime = mock(async () => binding);
const prepareHermes = mock(async () => ({
  binding,
  executorId: EXECUTOR_ID,
  credential: { id: 'credential-1', key: 'secret' },
  setupAttemptId: SETUP_ATTEMPT_ID,
}));
const setRuntime = mock(async () => binding);
const rollbackHermes = mock(async () => true);
const compareAndSelectIndex = mock(async () => ({ outcome: 'selected' as const, binding }));
const disconnectHermes = mock(async () => binding);
const reportUnexpectedError = mock((_error: unknown, _operation: string) => undefined);

function controller() {
  return new AgentRuntimeController({
    getRuntime,
    prepareHermes,
    setRuntime,
    rollbackHermes,
    compareAndSelectIndex,
    disconnectHermes,
  } as never, reportUnexpectedError);
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('OwnerControlGuard', () => {
  it('accepts a JWT-authenticated session', async () => {
    const req = new Request('http://localhost/api/agent-runtime');
    const result = await OwnerControlGuard(req, async (request) => {
      recordRequestAuthContext(request, { kind: 'session' });
      return OWNER;
    });
    expect(result).toEqual(OWNER);
  });

  it('accepts an unbound owner API key', async () => {
    const req = new Request('http://localhost/api/agent-runtime', { headers: { 'x-api-key': 'owner-key' } });
    const result = await OwnerControlGuard(req, async (request) => {
      recordRequestAuthContext(request, { kind: 'api_key', agentId: null });
      return OWNER;
    });
    expect(result).toEqual(OWNER);
  });

  it('rejects every agent-bound API key with an owner-credential error', async () => {
    const agentBoundRequest = new Request('http://localhost/api/agent-runtime', { headers: { 'x-api-key': 'agent-key' } });
    await expect(OwnerControlGuard(agentBoundRequest, async (request) => {
      recordRequestAuthContext(request, { kind: 'api_key', agentId: 'agent-1' });
      return OWNER;
    })).rejects.toThrow('owner credential');
    await expect(OwnerControlGuard(agentBoundRequest, async (request) => {
      recordRequestAuthContext(request, { kind: 'api_key', agentId: 'agent-1' });
      return OWNER;
    })).rejects.toBeInstanceOf(OwnerControlRequiredError);
  });

  it('authenticates only the current prepared key, then rejects it after rollback', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser(OWNER);
    const runtime = new AgentRuntimeService(persistence);
    const first = await runtime.prepareHermes(OWNER.id, INSTALLATION_ID, 'setup-first');
    const current = await runtime.prepareHermes(OWNER.id, INSTALLATION_ID, 'setup-current');
    const authenticate = (key: string) => authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': key } }),
      key,
      persistence,
    );

    await expect(authenticate(first.credential.key)).rejects.toThrow('Invalid API key');
    await expect(authenticate(current.credential.key)).resolves.toEqual(OWNER);
    expect(await runtime.rollbackHermes(OWNER.id, 'setup-current')).toBe(true);
    await expect(authenticate(current.credential.key)).rejects.toThrow('Invalid API key');
  });

  it('rejects the current prepared key after disconnect', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser(OWNER);
    const runtime = new AgentRuntimeService(persistence);
    const current = await runtime.prepareHermes(OWNER.id, INSTALLATION_ID, SETUP_ATTEMPT_ID);

    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': current.credential.key } }),
      current.credential.key,
      persistence,
    )).resolves.toEqual(OWNER);
    await runtime.disconnectHermes(OWNER.id, INSTALLATION_ID);
    await expect(authenticateApiKey(
      new Request('http://localhost/api/agents/me', { headers: { 'x-api-key': current.credential.key } }),
      current.credential.key,
      persistence,
    )).rejects.toThrow('Invalid API key');
  });
});

describe('AgentRuntimeController', () => {
  beforeEach(() => {
    getRuntime.mockClear();
    prepareHermes.mockClear();
    setRuntime.mockClear();
    rollbackHermes.mockClear();
    compareAndSelectIndex.mockClear();
    disconnectHermes.mockClear();
    reportUnexpectedError.mockClear();
    getRuntime.mockResolvedValue(binding);
    prepareHermes.mockResolvedValue({
      binding,
      executorId: EXECUTOR_ID,
      credential: { id: 'credential-1', key: 'secret' },
      setupAttemptId: SETUP_ATTEMPT_ID,
    });
    setRuntime.mockResolvedValue(binding);
    rollbackHermes.mockResolvedValue(true);
    compareAndSelectIndex.mockResolvedValue({ outcome: 'selected', binding });
    disconnectHermes.mockResolvedValue(binding);
  });

  it('reads the owner binding for the requested installation', async () => {
    const response = await controller().get(
      new Request(`http://localhost/api/agent-runtime?installationId=${INSTALLATION_ID}`),
      OWNER,
    );
    expect(response.status).toBe(200);
    expect(getRuntime).toHaveBeenCalledWith(OWNER.id, INSTALLATION_ID);
    expect(await response.json()).toEqual(binding);
  });

  it('requires installationId on read', async () => {
    const response = await controller().get(new Request('http://localhost/api/agent-runtime'), OWNER);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'runtime_invalid',
      detail: 'The runtime request is invalid',
    });
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('prepares a generation-fenced Hermes credential', async () => {
    const response = await controller().prepare(
      jsonRequest('/api/agent-runtime/hermes/prepare', 'POST', {
        installationId: INSTALLATION_ID, setupAttemptId: SETUP_ATTEMPT_ID,
      }),
      OWNER,
    );
    expect(response.status).toBe(201);
    expect(prepareHermes).toHaveBeenCalledWith(OWNER.id, INSTALLATION_ID, SETUP_ATTEMPT_ID);
    expect(await response.json()).toMatchObject({ executorId: EXECUTOR_ID, setupAttemptId: SETUP_ATTEMPT_ID });
  });

  it('accepts only the strict Index or Hermes runtime selection union', async () => {
    const indexResponse = await controller().set(
      jsonRequest('/api/agent-runtime', 'PUT', { runtime: 'index' }),
      OWNER,
    );
    expect(indexResponse.status).toBe(200);
    expect(setRuntime).toHaveBeenLastCalledWith(OWNER.id, { runtime: 'index' });

    const hermesBody = {
      runtime: 'hermes', installationId: INSTALLATION_ID, executorId: EXECUTOR_ID, setupAttemptId: SETUP_ATTEMPT_ID,
    } as const;
    const hermesResponse = await controller().set(
      jsonRequest('/api/agent-runtime', 'PUT', hermesBody),
      OWNER,
    );
    expect(hermesResponse.status).toBe(200);
    expect(setRuntime).toHaveBeenLastCalledWith(OWNER.id, hermesBody);

    const extraResponse = await controller().set(
      jsonRequest('/api/agent-runtime', 'PUT', { runtime: 'index', executorId: EXECUTOR_ID }),
      OWNER,
    );
    expect(extraResponse.status).toBe(400);
    expect(await extraResponse.json()).toEqual({
      error: 'runtime_invalid',
      detail: 'The runtime request is invalid',
    });
  });

  it('compare-selects Index only for the exact selected Hermes tuple', async () => {
    const body = {
      agentId: EXECUTOR_ID, installationId: INSTALLATION_ID, setupAttemptId: SETUP_ATTEMPT_ID,
    };
    const response = await controller().compareSelectIndex(
      jsonRequest('/api/agent-runtime/reconcile-index', 'POST', body), OWNER,
    );
    expect(response.status).toBe(200);
    expect(compareAndSelectIndex).toHaveBeenCalledWith(OWNER.id, body);

    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser(OWNER);
    persistence.seedFullHermesExecutor({
      id: EXECUTOR_ID, ownerId: OWNER.id, installationId: INSTALLATION_ID,
      setupAttemptId: SETUP_ATTEMPT_ID, handleNegotiations: true,
    });
    const runtime = new AgentRuntimeService(persistence);
    const stale = await runtime.compareAndSelectIndex(OWNER.id, {
      agentId: EXECUTOR_ID,
      installationId: INSTALLATION_ID,
      setupAttemptId: '44444444-4444-4444-8444-444444444444',
    });
    expect(stale.outcome).toBe('preserved');
    expect(stale.binding).toMatchObject({ selectedRuntime: 'hermes', executor: {
      id: EXECUTOR_ID, installationId: INSTALLATION_ID, setupAttemptId: SETUP_ATTEMPT_ID,
    } });
    const exact = await runtime.compareAndSelectIndex(OWNER.id, body);
    expect(exact).toMatchObject({ outcome: 'selected', binding: { selectedRuntime: 'index' } });
  });

  it('rejects extra or malformed compare-select fields', async () => {
    const response = await controller().compareSelectIndex(
      jsonRequest('/api/agent-runtime/reconcile-index', 'POST', {
        agentId: EXECUTOR_ID, installationId: INSTALLATION_ID,
        setupAttemptId: SETUP_ATTEMPT_ID, newer: true,
      }), OWNER,
    );
    expect(response.status).toBe(400);
    expect(compareAndSelectIndex).not.toHaveBeenCalled();
  });

  it('rolls back only the requested setup generation', async () => {
    const response = await controller().rollback(
      jsonRequest('/api/agent-runtime/rollback', 'POST', { setupAttemptId: SETUP_ATTEMPT_ID }),
      OWNER,
    );
    expect(response.status).toBe(200);
    expect(rollbackHermes).toHaveBeenCalledWith(OWNER.id, SETUP_ATTEMPT_ID);
    expect(await response.json()).toEqual({ rolledBack: true });
  });

  it('disconnects the exact installation', async () => {
    const response = await controller().disconnect(
      new Request(`http://localhost/api/agent-runtime/hermes/${INSTALLATION_ID}`, { method: 'DELETE' }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );
    expect(response.status).toBe(200);
    expect(disconnectHermes).toHaveBeenCalledWith(OWNER.id, INSTALLATION_ID);
  });

  it('returns owner-scoped success when the real service proves the installation absent', async () => {
    const persistence = new AgentRuntimeTransactionHarness();
    persistence.seedUser(OWNER);
    const realController = new AgentRuntimeController(
      new AgentRuntimeService(persistence),
      reportUnexpectedError,
    );

    const response = await realController.disconnect(
      new Request(`http://localhost/api/agent-runtime/hermes/${INSTALLATION_ID}`, { method: 'DELETE' }),
      OWNER,
      { installationId: INSTALLATION_ID },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selectedRuntime: 'index', installation: null, executor: null,
    });
  });

  it.each([
    [new RuntimeValidationError(), 400, { error: 'runtime_invalid', detail: 'The runtime request is invalid' }],
    [new RuntimeNotFoundError(), 404, { error: 'runtime_not_found', detail: 'The requested runtime installation was not found' }],
    [new RuntimeConflictError(), 409, { error: 'runtime_conflict', detail: 'The runtime binding changed; retry with the current setup generation' }],
  ] as const)('maps typed runtime domain errors to stable sanitized responses', async (error, status, body) => {
    setRuntime.mockRejectedValueOnce(error);

    const response = await controller().set(
      jsonRequest('/api/agent-runtime', 'PUT', { runtime: 'index' }),
      OWNER,
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(reportUnexpectedError).not.toHaveBeenCalled();
  });

  it('captures unexpected errors and returns a generic 500 without substring classification or leakage', async () => {
    const internal = new Error('database installation constraint exposed secret');
    prepareHermes.mockRejectedValueOnce(internal);

    const response = await controller().prepare(
      jsonRequest('/api/agent-runtime/hermes/prepare', 'POST', {
        installationId: INSTALLATION_ID,
        setupAttemptId: SETUP_ATTEMPT_ID,
      }),
      OWNER,
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal_error', detail: 'An unexpected error occurred' });
    expect(reportUnexpectedError).toHaveBeenCalledWith(internal, 'prepare');
  });
});
