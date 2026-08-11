import { describe, expect, it, spyOn } from 'bun:test';

import { HERMES_AGENT_AUDIENCE } from '../../lib/agent/hermes-authorization';
import { HERMES_CANONICAL_ACTIONS } from '../../lib/agent/hermes-capabilities';
import { HermesRuntimeTelemetry } from '../../lib/agent/hermes-runtime-telemetry';
import { HermesAgentRouteDeniedError, assertHermesAgentAudienceRoute, authenticateApiKey, authenticateHermesAgentCredential, authenticateRequestApiKey, authorizeHermesAgent, resolveHermesAgentCredential, type ApiKeyAuthenticationStore, type HermesAgentAuthenticationCredential, type HermesAgentAuthenticationStore } from '../auth.guard';

const ownerId = 'owner-hermes';
const agentId = 'agent-hermes';
const installationId = 'installation-hermes';
const setupAttemptId = 'setup-hermes';
const credentialId = 'credential-hermes';
const NOW = new Date('2026-08-09T12:00:00.000Z');

function recordingTelemetry() {
  const events: Array<{ name: string; attributes: Record<string, string> }> = [];
  const gauges: Array<{ name: string; value: number }> = [];
  const telemetry = new HermesRuntimeTelemetry({
    increment: (name, attributes) => events.push({ name, attributes }),
    gauge: (name, value) => gauges.push({ name, value }),
    observe: () => undefined,
  });
  return { telemetry, events, gauges };
}

function request(method: string, path: string): Request {
  return new Request(`http://localhost${path}`, { method });
}

function rawFixtureCredential(): string {
  return `idxh_${crypto.randomUUID().replaceAll('-', '')}`;
}

const allowed = [
  ['POST', '/mcp'],
  ['GET', '/api/agents/me'],
  ['POST', `/api/agents/${agentId}/negotiations/pickup`],
  ['POST', `/api/agents/${agentId}/negotiations/task-1/respond`],
  ['POST', `/api/agents/${agentId}/negotiations/task-1/consult`],
  ['GET', '/api/auth/me'],
  ['POST', '/api/hermes-authorizations/disconnect'],
  ['PATCH', '/api/auth/profile/update'],
  ['POST', '/api/intents/list'],
  ['PATCH', '/api/intents/intent-1/status'],
  ['PATCH', '/api/intents/intent-1/archive'],
  ['GET', '/api/opportunities'],
  ['PATCH', '/api/opportunities/opportunity-1/status'],
  ['POST', '/api/opportunities/opportunity-1/start-chat'],
  ['GET', '/api/questions?status=pending'],
  ['POST', '/api/questions/question-1/answer'],
  ['POST', '/api/questions/question-1/dismiss'],
  ['GET', '/api/users/user-1'],
  ['GET', '/api/networks'],
  ['GET', '/api/networks/discovery/public'],
  ['POST', '/api/networks/network-1/join'],
  ['GET', '/api/network-requests'],
  ['POST', '/api/network-requests'],
  ['PATCH', '/api/network-requests/request-1'],
  ['DELETE', '/api/network-requests/request-1'],
  ['POST', '/api/tools/read_user_contexts'],
  ['POST', '/api/tools/confirm_user_context'],
  ['POST', '/api/storage/avatars'],
  ['POST', '/api/storage/index-images'],
  ['POST', '/api/enrichment/sync'],
  ['POST', '/api/enrichment/enrich'],
  ['GET', '/api/conversations'],
  ['GET', '/api/conversations/stream'],
  ['POST', '/api/conversations/dm'],
  ['GET', '/api/conversations/conversation-1/messages'],
  ['POST', '/api/conversations/conversation-1/messages'],
] as const;

const denied = [
  ['POST', '/api/auth/api-key'],
  ['POST', '/api/auth/cli-credential'],
  ['DELETE', '/api/auth/cli-credential/key-1'],
  ['DELETE', '/api/auth/account'],
  ['POST', '/api/agents'],
  ['POST', '/api/agents/permissions'],
  ['GET', '/api/agents'],
  ['GET', `/api/agents/${agentId}`],
  ['GET', `/api/agents/${agentId}/tokens`],
  ['POST', `/api/agents/${agentId}/test-messages`],
  ['POST', `/api/agents/${agentId}/opportunities/pickup`],
  ['POST', '/api/billing/checkout'],
  ['GET', '/api/conversations/other/messages/extra'],
  ['POST', '/api/tools/update_user_context'],
  ['GET', '/api/tools/read_user_contexts'],
  ['POST', '/api/storage/files'],
  ['GET', '/api/questions/counts'],
  ['POST', '/api/networks/discovery/public'],
  ['POST', '/api/networks/network-1/opportunities'],
  ['GET', '/api/users/user-1/extra'],
  ['POST', '/api/intents/intent-1/archive'],
  ['POST', `/api/agents/wrong-agent/negotiations/pickup`],
  ['POST', `/api/agents/${agentId}/negotiations/task-1/respond/extra`],
  ['GET', '/api/agents/me/extra'],
  ['GET', '/mcp'],
  ['POST', '/mcp/extra'],
] as const;

function principal() {
  return {
    kind: 'api_key' as const,
    ownerId,
    audience: HERMES_AGENT_AUDIENCE,
    agentId,
    installationId,
    setupAttemptId,
    credentialId,
    actions: [...HERMES_CANONICAL_ACTIONS],
    expiresAt: new Date(Date.now() + 60_000),
    activationState: 'active' as const,
  };
}

function credential(overrides: Partial<HermesAgentAuthenticationCredential> = {}): HermesAgentAuthenticationCredential {
  return {
    id: credentialId,
    ownerId,
    audience: HERMES_AGENT_AUDIENCE,
    agentId,
    installationId,
    setupAttemptId,
    actions: [...HERMES_CANONICAL_ACTIONS],
    activationState: 'active',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function store(
  row: HermesAgentAuthenticationCredential | null = credential(),
  authorityOverrides: Record<string, unknown> = {},
): HermesAgentAuthenticationStore {
  return {
    findCredentialByHash: async () => row,
    countActiveCredentialExpiryHealth: async () => ({ nearExpiry: 1, expired: 2 }),
    findAgentAuthority: async () => ({
      id: agentId,
      ownerId,
      runtimeKind: 'hermes',
      installationId,
      setupAttemptId,
      status: 'active',
      deletedAt: null,
      actions: [...HERMES_CANONICAL_ACTIONS],
      ...authorityOverrides,
    }),
    findUserById: async () => ({ id: ownerId, email: null, name: 'Hermes Owner' }),
  };
}

describe('full Hermes audience REST boundary', () => {
  it('admits only the explicit method and path matrix', () => {
    for (const [method, path] of allowed) {
      expect(authorizeHermesAgent({ method, path, agentId, actions: HERMES_CANONICAL_ACTIONS }), `${method} ${path}`)
        .toEqual({ allowed: true });
      expect(() => assertHermesAgentAudienceRoute(principal(), request(method, path)), `${method} ${path}`)
        .not.toThrow();
    }

    for (const [method, path] of denied) {
      expect(authorizeHermesAgent({ method, path, agentId, actions: HERMES_CANONICAL_ACTIONS }), `${method} ${path}`)
        .toEqual({ allowed: false, reason: 'dedicated_principal_route_denied' });
      expect(() => assertHermesAgentAudienceRoute(principal(), request(method, path)), `${method} ${path}`)
        .toThrow(HermesAgentRouteDeniedError);
    }
  });

  it('fails closed when the route decision is not given the exact canonical action set', () => {
    for (const actions of [
      HERMES_CANONICAL_ACTIONS.slice(0, -1),
      [...HERMES_CANONICAL_ACTIONS, 'manage:profile'],
      [...HERMES_CANONICAL_ACTIONS, 'manage:contacts'],
      [...HERMES_CANONICAL_ACTIONS, 'manage:unknown'],
    ]) {
      expect(authorizeHermesAgent({ method: 'POST', path: '/mcp', agentId, actions }))
        .toEqual({ allowed: false, reason: 'dedicated_principal_route_denied' });
    }
  });
});

describe('full Hermes active credential authentication', () => {
  it('dispatches idxh inputs to the dedicated active store before legacy Better Auth lookup', async () => {
    let dedicatedLookups = 0;
    let legacyLookups = 0;
    const dedicatedStore = store();
    const rawCredential = rawFixtureCredential();
    const legacyStore: ApiKeyAuthenticationStore = {
      findCredentialByHash: async () => {
        legacyLookups += 1;
        return null;
      },
      findUserById: async () => null,
    };
    const authenticated = await authenticateRequestApiKey(
      request('POST', '/mcp'),
      rawCredential,
      {
        legacy: legacyStore,
        hermesAgent: {
          ...dedicatedStore,
          findCredentialByHash: async (hash) => {
            dedicatedLookups += 1;
            expect(hash).not.toContain(rawCredential);
            return credential();
          },
        },
      },
    );
    expect(authenticated).toEqual({ id: ownerId, email: null, name: 'Hermes Owner' });
    expect(dedicatedLookups).toBe(1);
    expect(legacyLookups).toBe(0);
  });

  it.each([
    ['unknown row', null, {}],
    ['wrong audience', credential({ audience: 'hermes-negotiator' as never }), {}],
    ['empty credential row ID', credential({ id: '' }), {}],
    ['empty owner', credential({ ownerId: '' }), {}],
    ['empty agent', credential({ agentId: '' }), {}],
    ['empty installation', credential({ installationId: '' }), {}],
    ['empty generation', credential({ setupAttemptId: '' }), {}],
    ['pending state', credential({ activationState: 'pending' }), {}],
    ['revoked state', credential({ activationState: 'revoked' }), {}],
    ['expired row', credential({ expiresAt: new Date(0) }), {}],
    ['missing canonical action', credential({ actions: HERMES_CANONICAL_ACTIONS.slice(0, -1) }), {}],
    ['retired profile action', credential({ actions: [...HERMES_CANONICAL_ACTIONS, 'manage:profile'] as never }), {}],
    ['retired contacts action', credential({ actions: [...HERMES_CANONICAL_ACTIONS, 'manage:contacts'] as never }), {}],
    ['unknown action', credential({ actions: [...HERMES_CANONICAL_ACTIONS, 'manage:unknown'] as never }), {}],
    ['wrong authority owner', credential(), { ownerId: 'other-owner' }],
    ['wrong authority runtime', credential(), { runtimeKind: null }],
    ['wrong authority installation', credential(), { installationId: 'other-installation' }],
    ['wrong authority generation', credential(), { setupAttemptId: 'other-setup' }],
    ['inactive authority', credential(), { status: 'inactive' }],
    ['deleted authority', credential(), { deletedAt: new Date() }],
    ['permission drift', credential(), { actions: HERMES_CANONICAL_ACTIONS.slice(0, -1) }],
  ] as const)('rejects malformed or stale dedicated identity: %s', async (_label, row, authorityOverrides) => {
    let userLookups = 0;
    const base = store(row, authorityOverrides);
    await expect(authenticateHermesAgentCredential(
      request('POST', '/mcp'),
      rawFixtureCredential(),
      {
        ...base,
        findUserById: async () => {
          userLookups += 1;
          return { id: ownerId, email: null, name: 'Hermes Owner' };
        },
      },
    )).rejects.toThrow('Invalid API key');
    expect(userLookups).toBe(0);
  });

  it('emits bounded denial telemetry for a malformed dedicated credential string', async () => {
    const recorded = recordingTelemetry();
    await expect(resolveHermesAgentCredential(
      'idxh_',
      store(),
      recorded.telemetry,
      () => new Date(NOW),
    )).rejects.toThrow('Invalid API key');
    expect(recorded.events).toEqual([
      { name: 'hermes.auth_denied', attributes: { reason: 'malformed_credential' } },
      { name: 'hermes.credential_rejected', attributes: { reason: 'malformed_credential' } },
    ]);
    expect(recorded.gauges).toEqual([]);
  });

  it.each([
    ['unknown', null, {}, 'invalid_credential'],
    ['malformed', credential({ audience: 'wrong' }), {}, 'malformed_credential'],
    ['pending', credential({ activationState: 'pending' }), {}, 'malformed_credential'],
    ['revoked', credential({ activationState: 'revoked' }), {}, 'revoked'],
    ['expired', credential({ expiresAt: new Date(NOW.getTime() - 1) }), {}, 'expired'],
    ['stale', credential({ expiresAt: new Date(NOW.getTime() + 60_000) }), { setupAttemptId: 'stale' }, 'stale'],
  ] as const)('emits bounded denial telemetry for %s dedicated credentials', async (
    _label,
    row,
    authorityOverrides,
    reason,
  ) => {
    const recorded = recordingTelemetry();
    await expect(resolveHermesAgentCredential(
      rawFixtureCredential(),
      store(row, authorityOverrides),
      recorded.telemetry,
      () => new Date(NOW),
    )).rejects.toThrow('Invalid API key');

    expect(recorded.events).toEqual([
      { name: 'hermes.auth_denied', attributes: { reason } },
      { name: 'hermes.credential_rejected', attributes: { reason } },
    ]);
    expect(recorded.gauges).toEqual([
      { name: 'hermes.credentials_near_expiry', value: 1 },
      { name: 'hermes.credentials_expired', value: 2 },
    ]);
    expect(JSON.stringify({ events: recorded.events, gauges: recorded.gauges }))
      .not.toMatch(/owner-hermes|agent-hermes|credential-hermes|idxh_/);
  });

  it('refreshes authoritative active near-expiry and expired counts on normal authentication', async () => {
    const recorded = recordingTelemetry();
    const healthCalls: Array<{ now: Date; nearExpiryCutoff: Date }> = [];
    const activeStore = {
      ...store(credential({ expiresAt: new Date(NOW.getTime() + 60_000) })),
      countActiveCredentialExpiryHealth: async (input: { now: Date; nearExpiryCutoff: Date }) => {
        healthCalls.push(input);
        return { nearExpiry: 3, expired: 2 };
      },
    };

    await expect(resolveHermesAgentCredential(
      rawFixtureCredential(),
      activeStore,
      recorded.telemetry,
      () => new Date(NOW),
    )).resolves.toMatchObject({ user: { id: ownerId } });

    expect(healthCalls).toEqual([{
      now: NOW,
      nearExpiryCutoff: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    }]);
    expect(recorded.gauges).toEqual([
      { name: 'hermes.credentials_near_expiry', value: 3 },
      { name: 'hermes.credentials_expired', value: 2 },
    ]);
  });

  it('does not change successful authority behavior when the aggregate telemetry query fails', async () => {
    const recorded = recordingTelemetry();
    const activeStore = {
      ...store(),
      countActiveCredentialExpiryHealth: async () => { throw new Error('telemetry query failed'); },
    };
    await expect(resolveHermesAgentCredential(
      rawFixtureCredential(),
      activeStore,
      recorded.telemetry,
    )).resolves.toMatchObject({ user: { id: ownerId } });
    expect(recorded.gauges).toEqual([]);
  });

  it('logs only the stable denial reason without credential-derived evidence', async () => {
    const warning = spyOn(console, 'warn').mockImplementation(() => undefined);
    const rawCredential = rawFixtureCredential();
    try {
      await expect(resolveHermesAgentCredential(rawCredential, store(null)))
        .rejects.toThrow('Invalid API key');
      expect(warning).toHaveBeenCalledTimes(1);
      const emitted = String(warning.mock.calls[0]?.[0]);
      expect(emitted).toContain('"reason":"invalid_credential"');
      expect(emitted).not.toContain('keyHashPrefix');
      expect(emitted).not.toContain(rawCredential);
    } finally {
      warning.mockRestore();
    }
  });

  it('freezes the pre-change compatibility property: legacy auth queries only its apikey fixture and finds no idxh hash', async () => {
    const queriedTables: string[] = [];
    const frozenBaseAuthFixture: ApiKeyAuthenticationStore = {
      findCredentialByHash: async () => {
        queriedTables.push('apikey');
        return null;
      },
      findUserById: async () => {
        throw new Error('owner lookup must not run for an unknown legacy hash');
      },
    };

    await expect(authenticateApiKey(
      request('GET', '/api/auth/me'),
      rawFixtureCredential(),
      frozenBaseAuthFixture,
    )).rejects.toThrow('Invalid API key');
    expect(queriedTables).toEqual(['apikey']);
  });
});
