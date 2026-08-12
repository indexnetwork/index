import { beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { McpCapabilityPolicy, resolveMcpCapabilitySubject } from '../../../../../packages/protocol/src/mcp/mcp.authorization-policy';

import { SessionOnlyGuard, resolveHermesAgentCredential } from '../../guards/auth.guard';
import { HERMES_CANONICAL_ACTIONS, normalizeHermesCapabilities } from '../../lib/agent/hermes-capabilities';
import { projectHermesAgentMcpIdentity } from '../../lib/agent/hermes-mcp-identity';
import { AuthorizationConflictError, AuthorizationExpiredError, AuthorizationInvalidGrantError, AuthorizationReplayError, type HermesActivationPrincipal, type HermesAuthorizationStore } from '../../lib/agent/hermes-authorization';
import { RouteRegistry } from '../../lib/router/router.decorators';
import { HermesAuthorizationController } from '../hermes-authorization.controller';
import { HermesAuthorizationService } from '../../services/hermes-authorization.service';

const OWNER = { id: 'owner-1', email: 'owner@example.com', name: 'Owner' };
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const SETUP_ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const CREDENTIAL_ID = '55555555-5555-4555-8555-555555555555';
const REDIRECT_URI = 'http://127.0.0.1:49152/callback';
const STATE = 'abcdefghijklmnopqrstuvwxyzABCDEFGH';
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const NOW = new Date('2026-08-09T12:00:00.000Z');

async function challenge(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

function request(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`http://localhost/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

type AuthorizationRow = {
  requestId: string;
  ownerId: string | null;
  agentId: string | null;
  installationId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  actions: readonly string[];
  codeHash: string | null;
  setupAttemptId: string | null;
  approvedAt: Date | null;
  consumedAt: Date | null;
  expiresAt: Date;
};

type CredentialRow = HermesActivationPrincipal & {
  credentialHash: string;
  activationState: 'pending' | 'active' | 'revoked';
};

class MemoryHermesAuthorizationStore implements HermesAuthorizationStore {
  authorizations = new Map<string, AuthorizationRow>();
  credentials = new Map<string, CredentialRow>();
  selectedRuntime: 'index' | 'external' = 'external';
  priorInstallationCredentialRevoked = false;
  permissionActions: readonly string[] | null = null;
  disconnectedCredentialId: string | null = null;

  async createAuthorization(input: Parameters<HermesAuthorizationStore['createAuthorization']>[0]) {
    this.authorizations.set(input.requestId, {
      ...input,
      ownerId: null,
      agentId: null,
      codeHash: null,
      setupAttemptId: null,
      approvedAt: null,
      consumedAt: null,
    });
    return { requestId: input.requestId, state: input.state, expiresAt: input.expiresAt };
  }

  async getAuthorization(input: { requestId: string; state: string; now: Date }) {
    const row = this.authorizations.get(input.requestId);
    if (!row || row.state !== input.state || row.approvedAt || row.consumedAt) {
      throw new AuthorizationInvalidGrantError();
    }
    if (row.expiresAt <= input.now) throw new AuthorizationExpiredError();
    return {
      requestId: row.requestId,
      installationId: row.installationId,
      redirectUri: row.redirectUri,
      state: row.state,
      actions: row.actions,
      expiresAt: row.expiresAt,
    };
  }

  async approveAuthorization(input: Parameters<HermesAuthorizationStore['approveAuthorization']>[0]) {
    const row = this.authorizations.get(input.requestId);
    if (!row || row.state !== input.state || row.redirectUri !== input.redirectUri) {
      throw new AuthorizationInvalidGrantError();
    }
    if (row.expiresAt <= input.now) throw new AuthorizationExpiredError();
    if (row.approvedAt) throw new AuthorizationConflictError();
    row.ownerId = input.ownerId;
    row.agentId = AGENT_ID;
    row.setupAttemptId = input.setupAttemptId;
    row.codeHash = input.codeHash;
    row.approvedAt = input.now;
    row.expiresAt = input.expiresAt;
    this.selectedRuntime = 'index';
    this.priorInstallationCredentialRevoked = true;
    for (const credential of this.credentials.values()) {
      if (credential.installationId === row.installationId && credential.activationState !== 'revoked') {
        credential.activationState = 'revoked';
      }
    }
    return {
      redirectUri: row.redirectUri,
      state: row.state,
      expiresAt: row.expiresAt,
    };
  }

  async exchangeAuthorizationCode(input: Parameters<HermesAuthorizationStore['exchangeAuthorizationCode']>[0]) {
    const row = this.authorizations.get(input.requestId);
    if (!row || !row.approvedAt || !row.codeHash) throw new AuthorizationInvalidGrantError();
    if (row.consumedAt) throw new AuthorizationReplayError();
    if (row.expiresAt <= input.now) throw new AuthorizationExpiredError();
    if (
      row.codeHash !== input.codeHash
      || row.codeChallenge !== input.verifierChallenge
      || row.redirectUri !== input.redirectUri
    ) throw new AuthorizationInvalidGrantError();
    row.consumedAt = input.now;
    const credential: CredentialRow = {
      ownerId: row.ownerId!,
      audience: 'hermes-agent',
      agentId: row.agentId!,
      installationId: row.installationId,
      setupAttemptId: row.setupAttemptId!,
      credentialId: input.credentialId,
      actions: [...row.actions],
      expiresAt: input.expiresAt,
      credentialHash: input.credentialHash,
      activationState: 'pending',
    };
    this.credentials.set(input.credentialId, credential);
    return credential;
  }

  async authenticatePendingCredential(credentialHash: string) {
    return [...this.credentials.values()].find((row) =>
      row.credentialHash === credentialHash
      && row.activationState === 'pending'
      && row.expiresAt > NOW) ?? null;
  }

  async authenticateRevocableCredential(credentialHash: string) {
    return [...this.credentials.values()].find((row) => row.credentialHash === credentialHash) ?? null;
  }

  async disconnectCredential(input: HermesActivationPrincipal) {
    const row = this.credentials.get(input.credentialId);
    if (!row) throw new AuthorizationConflictError();
    if (row.activationState !== 'revoked') {
      row.activationState = 'revoked';
      this.selectedRuntime = 'index';
      this.permissionActions = null;
      this.disconnectedCredentialId = row.credentialId;
    }
    return {
      revoked: true as const,
      credentialId: row.credentialId,
      setupAttemptId: row.setupAttemptId,
    };
  }

  async activatePendingCredential(input: HermesActivationPrincipal) {
    const row = this.credentials.get(input.credentialId);
    if (!row || row.activationState === 'revoked') throw new AuthorizationConflictError();
    if (row.activationState === 'active') return row;
    if (
      row.agentId !== input.agentId
      || row.installationId !== input.installationId
      || row.setupAttemptId !== input.setupAttemptId
      || JSON.stringify(row.actions) !== JSON.stringify(input.actions)
    ) throw new AuthorizationConflictError();
    row.activationState = 'active';
    this.permissionActions = [...row.actions];
    return row;
  }
}

let store: MemoryHermesAuthorizationStore;
let service: HermesAuthorizationService;
let controller: HermesAuthorizationController;

async function createAuthorization(overrides: Record<string, unknown> = {}) {
  return controller.create(request('/hermes-authorizations', {
    protocolVersion: 1,
    installationId: INSTALLATION_ID,
    redirectUri: REDIRECT_URI,
    codeChallenge: await challenge(VERIFIER),
    codeChallengeMethod: 'S256',
    state: STATE,
    actions: HERMES_CANONICAL_ACTIONS,
    ...overrides,
  }));
}

async function readAuthorization(path = `/hermes-authorizations/${REQUEST_ID}?state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`) {
  return controller.get(
    new Request(`http://localhost/api${path}`),
    OWNER,
    { id: REQUEST_ID },
  );
}

async function approveAuthorization(overrides: Record<string, unknown> = {}) {
  return controller.approve(
    request(`/hermes-authorizations/${REQUEST_ID}/approve`, {
      state: STATE,
      redirectUri: REDIRECT_URI,
      ...overrides,
    }),
    OWNER,
    { id: REQUEST_ID },
  );
}

async function exchangeAuthorization(overrides: Record<string, unknown> = {}) {
  const approval = await approveAuthorization();
  const approved = await approval.json() as { code: string };
  return controller.exchange(request('/hermes-authorizations/exchange', {
    protocolVersion: 1,
    requestId: REQUEST_ID,
    code: approved.code,
    verifier: VERIFIER,
    redirectUri: REDIRECT_URI,
    ...overrides,
  }));
}

describe('Hermes canonical capabilities', () => {
  it('freezes the six durable actions and only normalizes the retired profile migration input', () => {
    expect(HERMES_CANONICAL_ACTIONS).toEqual([
      'manage:identity', 'manage:premises', 'manage:intents',
      'manage:networks', 'manage:opportunities', 'manage:negotiations',
    ]);
    expect(normalizeHermesCapabilities(['manage:profile'])).toEqual([
      'manage:identity', 'manage:premises',
    ]);
    expect(() => normalizeHermesCapabilities(['manage:contacts'])).toThrow('retired_action');
  });

  it('keeps the dedicated schema constrained and free of raw secret columns', () => {
    const apiRoot = path.resolve(import.meta.dir, '../../..');
    const migration = readFileSync(path.join(apiRoot, 'drizzle/0120_add_hermes_authorizations.sql'), 'utf8');
    expect(migration).toContain('CREATE TABLE "hermes_authorizations"');
    expect(migration).toContain('CREATE TABLE "hermes_agent_credentials"');
    expect(migration).toContain('"code_challenge_method" = \'S256\'');
    expect(migration).toContain('"expires_at" > "hermes_authorizations"."created_at"');
    expect(migration).toContain('CREATE UNIQUE INDEX "hermes_authorization_code_hash_unique"');
    expect(migration).toContain('WHERE "hermes_authorizations"."code_hash" IS NOT NULL');
    expect(migration).toContain('"secret_hash" text NOT NULL');
    expect(migration).not.toContain('"verifier"');
    expect(migration).not.toContain('"credential" text');
    expect(migration).not.toContain('"authorization_code"');
  });
});

describe('HermesAuthorizationController provider-free contract', () => {
  beforeEach(() => {
    store = new MemoryHermesAuthorizationStore();
    let idIndex = 0;
    const ids = [REQUEST_ID, SETUP_ATTEMPT_ID, CREDENTIAL_ID, '66666666-6666-4666-8666-666666666666'];
    let secretIndex = 0;
    const secrets = ['authorization-code-secret', 'credential-secret'];
    service = new HermesAuthorizationService(store, {
      now: () => new Date(NOW),
      randomId: () => ids[idIndex++]!,
      randomSecret: () => secrets[secretIndex++]!,
    });
    controller = new HermesAuthorizationController(service, () => undefined);
  });

  it('keeps creation/exchange public but requires a browser session for request reads and approval', () => {
    const approvalGuards = RouteRegistry.getGuards(HermesAuthorizationController, 'approve');
    expect(approvalGuards).toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(HermesAuthorizationController, 'get')).toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(HermesAuthorizationController, 'create')).not.toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(HermesAuthorizationController, 'exchange')).not.toContain(SessionOnlyGuard);
    expect(SessionOnlyGuard(new Request('http://localhost/api/hermes-authorizations/x/approve')))
      .rejects.toThrow('Access token required');
  });

  it('creates only a strict protocol-v1 S256 request with exact canonical actions', async () => {
    const response = await createAuthorization();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      requestId: REQUEST_ID,
      state: STATE,
      expiresAt: '2026-08-09T12:10:00.000Z',
    });

    expect((await createAuthorization({ setupAttemptId: SETUP_ATTEMPT_ID })).status).toBe(400);
    expect((await createAuthorization({ protocolVersion: 2 })).status).toBe(400);
    expect((await createAuthorization({ redirectUri: 'http://localhost:49152/callback' })).status).toBe(400);
    expect((await createAuthorization({ redirectUri: 'http://2130706433:49152/callback' })).status).toBe(400);
    expect((await createAuthorization({ redirectUri: 'http://127.0.0.1:049152/callback' })).status).toBe(400);
    expect((await createAuthorization({ redirectUri: 'http://127.0.0.1:49151/callback' })).status).toBe(400);
    expect((await createAuthorization({ actions: [...HERMES_CANONICAL_ACTIONS, 'manage:contacts'] })).status).toBe(400);
    expect((await createAuthorization({ actions: HERMES_CANONICAL_ACTIONS.slice(0, 5) })).status).toBe(400);
    expect((await createAuthorization({ actions: [
      ...HERMES_CANONICAL_ACTIONS.slice(0, 5), HERMES_CANONICAL_ACTIONS[0],
    ] })).status).toBe(400);
  });

  it('returns only state-bound pending consent metadata and rejects malformed query admission', async () => {
    await createAuthorization();
    const response = await readAuthorization();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId: REQUEST_ID,
      installationId: INSTALLATION_ID,
      installationName: 'Hermes on macOS',
      actions: HERMES_CANONICAL_ACTIONS,
      expiresAt: '2026-08-09T12:10:00.000Z',
    });

    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=${STATE}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=${STATE}&state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&extra=1`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=wrong&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`)).status).toBe(400);
    expect((await readAuthorization(`/hermes-authorizations/${REQUEST_ID}?state=${STATE}&redirect_uri=${encodeURIComponent('http://127.0.0.1:49153/callback')}`)).status).toBe(400);
  });

  it('approves under owner authority only when state and redirect byte-match, then emits a five-minute code', async () => {
    await createAuthorization();
    expect((await approveAuthorization({ redirectUri: 'http://127.0.0.1:49153/callback' })).status).toBe(400);
    expect((await approveAuthorization({ state: `${STATE}x` })).status).toBe(400);
    expect((await approveAuthorization({ extra: true })).status).toBe(400);
    expect(store.authorizations.get(REQUEST_ID)?.approvedAt).toBeNull();

    const response = await approveAuthorization();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      requestId: REQUEST_ID,
      code: 'authorization-code-secret',
      state: STATE,
    });
    expect(store.selectedRuntime).toBe('index');
    expect(store.priorInstallationCredentialRevoked).toBe(true);
    expect(store.authorizations.get(REQUEST_ID)?.setupAttemptId).toBe(SETUP_ATTEMPT_ID);
  });

  it.each([
    ['wrong verifier', { verifier: `${VERIFIER}x` }],
    ['wrong redirect', { redirectUri: 'http://127.0.0.1:49153/callback' }],
  ])('rejects exchange with %s', async (_label, overrides) => {
    await createAuthorization();
    const response = await exchangeAuthorization(overrides);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_grant' });
    expect(store.credentials.size).toBe(0);
  });

  it('rejects an expired code without consuming or issuing it', async () => {
    await createAuthorization();
    const approval = await approveAuthorization();
    const { code } = await approval.json() as { code: string };
    store.authorizations.get(REQUEST_ID)!.expiresAt = new Date(NOW.getTime() - 1);
    const response = await controller.exchange(request('/hermes-authorizations/exchange', {
      protocolVersion: 1, requestId: REQUEST_ID, code, verifier: VERIFIER, redirectUri: REDIRECT_URI,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'expired_grant' });
    expect(store.credentials.size).toBe(0);
  });

  it('returns one pending 30-day idxh credential once and rejects replay', async () => {
    await createAuthorization();
    const approval = await approveAuthorization();
    const { code } = await approval.json() as { code: string };
    const body = { protocolVersion: 1, requestId: REQUEST_ID, code, verifier: VERIFIER, redirectUri: REDIRECT_URI };
    const first = await controller.exchange(request('/hermes-authorizations/exchange', body));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      credential: 'idxh_credential-secret',
      audience: 'hermes-agent',
      credentialId: CREDENTIAL_ID,
      agentId: AGENT_ID,
      installationId: INSTALLATION_ID,
      setupAttemptId: SETUP_ATTEMPT_ID,
      actions: HERMES_CANONICAL_ACTIONS,
      expiresAt: '2026-09-08T12:00:00.000Z',
      activationState: 'pending',
    });
    const replay = await controller.exchange(request('/hermes-authorizations/exchange', body));
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'grant_replayed' });
    expect(store.credentials.size).toBe(1);
  });

  it('requires exact Keychain confirmation before pending-credential activation', async () => {
    await createAuthorization();
    const exchange = await exchangeAuthorization();
    const pending = await exchange.json() as { credential: string };

    const beforeConfirmation = await controller.activate(request(
      '/hermes-authorizations/activate',
      { protocolVersion: 1, keychainConfirmed: false },
      { 'x-api-key': pending.credential },
    ));
    expect(beforeConfirmation.status).toBe(400);
    expect(store.permissionActions).toBeNull();

    const activated = await controller.activate(request(
      '/hermes-authorizations/activate',
      { protocolVersion: 1, keychainConfirmed: true },
      { 'x-api-key': pending.credential },
    ));
    expect(activated.status).toBe(200);
    expect(await activated.json()).toEqual({
      audience: 'hermes-agent',
      agentId: AGENT_ID,
      installationId: INSTALLATION_ID,
      setupAttemptId: SETUP_ATTEMPT_ID,
      credentialId: CREDENTIAL_ID,
      actions: HERMES_CANONICAL_ACTIONS,
      expiresAt: '2026-09-08T12:00:00.000Z',
      activationState: 'active',
    });
    expect(store.permissionActions).toEqual(HERMES_CANONICAL_ACTIONS);
  });

  it('gives a freshly browser-authorized Hermes agent manage:intents while enrollment stays register-only', async () => {
    await createAuthorization();
    const exchange = await exchangeAuthorization();
    const pending = await exchange.json() as { credential: string };
    const activation = await controller.activate(request(
      '/hermes-authorizations/activate',
      { protocolVersion: 1, keychainConfirmed: true },
      { 'x-api-key': pending.credential },
    ));
    expect(activation.status).toBe(200);
    expect(store.permissionActions).toEqual(HERMES_CANONICAL_ACTIONS);

    const credential = store.credentials.get(CREDENTIAL_ID);
    expect(credential?.activationState).toBe('active');
    if (!credential || credential.activationState !== 'active') {
      throw new Error('Fresh Hermes credential was not activated');
    }

    const resolved = await resolveHermesAgentCredential(pending.credential, {
      findCredentialByHash: async () => ({
        id: credential.credentialId,
        ownerId: credential.ownerId,
        audience: credential.audience,
        agentId: credential.agentId,
        installationId: credential.installationId,
        setupAttemptId: credential.setupAttemptId,
        actions: credential.actions,
        activationState: credential.activationState,
        expiresAt: credential.expiresAt,
      }),
      findAgentAuthority: async () => ({
        id: credential.agentId,
        ownerId: credential.ownerId,
        runtimeKind: 'hermes',
        installationId: credential.installationId,
        setupAttemptId: credential.setupAttemptId,
        status: 'active',
        deletedAt: null,
        actions: store.permissionActions,
      }),
      findUserById: async () => OWNER,
    });

    const policy = new McpCapabilityPolicy();
    const hermesAgent = resolveMcpCapabilitySubject({
      identity: projectHermesAgentMcpIdentity({
        ownerId: resolved.user.id,
        agentId: resolved.principal.agentId,
      }),
      isOnboarding: false,
      agent: {
        id: credential.agentId,
        ownerId: credential.ownerId,
        type: 'external',
        status: 'active',
        permissions: [{
          agentId: credential.agentId,
          userId: credential.ownerId,
          scope: 'global',
          scopeId: null,
          actions: [...resolved.principal.actions],
        }],
      },
    });
    expect(hermesAgent.profile).toBe('hermes_agent');
    expect(hermesAgent.permissions).toContain('manage:intents');
    expect(policy.authorize(hermesAgent, 'create_intent')).toEqual({
      allowed: true,
      reason: 'permission_granted',
      reach: 'network',
      requiredPermissions: ['manage:intents'],
    });

    const enrollmentKey = resolveMcpCapabilitySubject({
      identity: { userId: credential.ownerId, enrollmentCapable: true },
      isOnboarding: false,
    });
    expect(policy.visibleToolNames(enrollmentKey, ['register_agent', 'create_intent']))
      .toEqual(['register_agent']);
    expect(policy.authorize(enrollmentKey, 'create_intent')).toMatchObject({
      allowed: false,
      reason: 'enrollment_required',
    });
  });

  it('rejects activation without the exact pending dedicated credential', async () => {
    const response = await controller.activate(request(
      '/hermes-authorizations/activate',
      { protocolVersion: 1, keychainConfirmed: true },
      { 'x-api-key': 'idxh_unknown' },
    ));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'invalid_credential' });
  });

  it('self-revokes an exact pending credential with a strict body and stable retry receipt', async () => {
    await createAuthorization();
    const exchange = await exchangeAuthorization();
    const pending = await exchange.json() as { credential: string; credentialId: string };
    const receipt = {
      revoked: true,
      credentialId: pending.credentialId,
      setupAttemptId: SETUP_ATTEMPT_ID,
    };

    const invalidBody = await controller.disconnect(request(
      '/hermes-authorizations/disconnect',
      { protocolVersion: 1, extra: true },
      { 'x-api-key': pending.credential },
    ));
    expect(invalidBody.status).toBe(400);
    expect(store.disconnectedCredentialId).toBeNull();

    const disconnected = await controller.disconnect(request(
      '/hermes-authorizations/disconnect',
      { protocolVersion: 1 },
      { 'x-api-key': pending.credential },
    ));
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual(receipt);
    expect(store.selectedRuntime).toBe('index');
    expect(store.permissionActions).toBeNull();
    expect(store.disconnectedCredentialId).toBe(pending.credentialId);

    const replay = await controller.disconnect(request(
      '/hermes-authorizations/disconnect',
      { protocolVersion: 1 },
      { 'x-api-key': pending.credential },
    ));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(receipt);
  });

  it('self-revokes an exact active credential', async () => {
    await createAuthorization();
    const exchange = await exchangeAuthorization();
    const pending = await exchange.json() as { credential: string; credentialId: string };
    const activated = await controller.activate(request(
      '/hermes-authorizations/activate',
      { protocolVersion: 1, keychainConfirmed: true },
      { 'x-api-key': pending.credential },
    ));
    expect(activated.status).toBe(200);

    const disconnected = await controller.disconnect(request(
      '/hermes-authorizations/disconnect',
      { protocolVersion: 1 },
      { 'x-api-key': pending.credential },
    ));
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual({
      revoked: true,
      credentialId: pending.credentialId,
      setupAttemptId: SETUP_ATTEMPT_ID,
    });
    expect(store.disconnectedCredentialId).toBe(pending.credentialId);
    expect(store.permissionActions).toBeNull();
    expect(store.selectedRuntime).toBe('index');
  });

  it('self-revokes an expired exact credential', async () => {
    await createAuthorization();
    const exchange = await exchangeAuthorization();
    const pending = await exchange.json() as { credential: string; credentialId: string };
    store.credentials.get(pending.credentialId)!.expiresAt = new Date(NOW.getTime() - 1);

    const disconnected = await controller.disconnect(request(
      '/hermes-authorizations/disconnect',
      { protocolVersion: 1 },
      { 'x-api-key': pending.credential },
    ));
    expect(disconnected.status).toBe(200);
    expect(await disconnected.json()).toEqual({
      revoked: true,
      credentialId: pending.credentialId,
      setupAttemptId: SETUP_ATTEMPT_ID,
    });
  });
});
