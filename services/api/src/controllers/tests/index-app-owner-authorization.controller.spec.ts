import { beforeEach, describe, expect, it } from 'bun:test';

import { SessionOnlyGuard } from '../../guards/auth.guard';
import { IndexAppOwnerConflictError, IndexAppOwnerExpiredError, IndexAppOwnerInvalidGrantError, type IndexAppOwnerActivationPrincipal, type IndexAppOwnerAuthorizationStore } from '../../lib/agent/index-app-owner-authorization';
import { RouteRegistry } from '../../lib/router/router.decorators';
import { IndexAppOwnerAuthorizationService } from '../../services/index-app-owner-authorization.service';
import { IndexAppOwnerAuthorizationController } from '../index-app-owner-authorization.controller';

const OWNER = { id: 'owner-1', email: 'owner@example.test', name: 'Owner' };
const INSTALLATION = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const CREDENTIAL_ID = '33333333-3333-4333-8333-333333333333';
const GENERATION = '44444444-4444-4444-8444-444444444444';
const REDIRECT = 'http://127.0.0.1:49152/callback';
const STATE = 'abcdefghijklmnopqrstuvwxyzABCDEFGH';
const VERIFIER = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const NOW = new Date('2026-08-09T12:00:00.000Z');

async function challenge(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Buffer.from(digest).toString('base64url');
}

type Authorization = {
  requestId: string; installationId: string; redirectUri: string; state: string;
  codeChallenge: string; legacyKeyId: string | null; ownerId: string | null;
  codeHash: string | null; approvedAt: Date | null; consumedAt: Date | null; expiresAt: Date;
};
type Credential = IndexAppOwnerActivationPrincipal & {
  secretHash: string; proofHash: string | null; activationState: 'pending' | 'active' | 'revoked';
};

class MemoryStore implements IndexAppOwnerAuthorizationStore {
  authorization: Authorization | null = null;
  credential: Credential | null = null;
  legacyRevokedBeforePending = false;

  async createAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['createAuthorization']>[0]) {
    this.authorization = { ...input, ownerId: null, codeHash: null, approvedAt: null, consumedAt: null };
    return { requestId: input.requestId, state: input.state, expiresAt: input.expiresAt };
  }
  async getAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['getAuthorization']>[0]) {
    const row = this.authorization;
    if (!row || row.requestId !== input.requestId || row.state !== input.state || row.approvedAt || row.consumedAt) {
      throw new IndexAppOwnerInvalidGrantError();
    }
    if (row.expiresAt <= input.now) throw new IndexAppOwnerExpiredError();
    return row;
  }
  async approveAuthorization(input: Parameters<IndexAppOwnerAuthorizationStore['approveAuthorization']>[0]) {
    const row = this.authorization;
    if (!row || row.redirectUri !== input.redirectUri || row.state !== input.state) throw new IndexAppOwnerInvalidGrantError();
    row.ownerId = input.ownerId; row.codeHash = input.codeHash; row.approvedAt = input.now; row.expiresAt = input.expiresAt;
    return { state: row.state, redirectUri: row.redirectUri, expiresAt: row.expiresAt };
  }
  async exchangeAuthorizationCode(input: Parameters<IndexAppOwnerAuthorizationStore['exchangeAuthorizationCode']>[0]) {
    const row = this.authorization;
    if (!row || !row.ownerId || !row.approvedAt || row.codeHash !== input.codeHash
        || row.codeChallenge !== input.verifierChallenge || row.state !== input.state) {
      throw new IndexAppOwnerInvalidGrantError();
    }
    row.consumedAt = input.now;
    this.legacyRevokedBeforePending = row.legacyKeyId === 'legacy-id';
    this.credential = {
      ownerId: row.ownerId, credentialId: input.credentialId, installationId: row.installationId,
      generation: input.generation, expiresAt: input.expiresAt, secretHash: input.credentialHash,
      proofHash: input.activationProofHash, activationState: 'pending',
    };
    return this.credential;
  }
  async authenticatePendingCredential(hash: string) {
    return this.credential?.secretHash === hash && this.credential.activationState === 'pending'
      ? this.credential : null;
  }
  async activatePendingCredential(input: Parameters<IndexAppOwnerAuthorizationStore['activatePendingCredential']>[0]) {
    if (!this.credential || this.credential.proofHash !== input.activationProofHash) throw new IndexAppOwnerConflictError();
    this.credential.activationState = 'active'; this.credential.proofHash = null;
    return this.credential;
  }
  async rollbackPendingCredential(input: Parameters<IndexAppOwnerAuthorizationStore['rollbackPendingCredential']>[0]) {
    if (!this.credential || this.credential.proofHash !== input.activationProofHash) throw new IndexAppOwnerConflictError();
    this.credential.activationState = 'revoked'; this.credential.proofHash = null;
    return { revoked: true as const, credentialId: this.credential.credentialId };
  }
  async authenticateRevocableCredential(hash: string) {
    return this.credential?.secretHash === hash ? this.credential : null;
  }
  async revokeCredential(input: Parameters<IndexAppOwnerAuthorizationStore['revokeCredential']>[0]) {
    if (!this.credential || this.credential.credentialId !== input.principal.credentialId) throw new IndexAppOwnerConflictError();
    this.credential.activationState = 'revoked';
    return { revoked: true as const, credentialId: this.credential.credentialId };
  }
}

let store: MemoryStore;
let controller: IndexAppOwnerAuthorizationController;
beforeEach(() => {
  store = new MemoryStore();
  const ids = [REQUEST_ID, CREDENTIAL_ID, GENERATION, '55555555-5555-4555-8555-555555555555'];
  const secrets = ['browser-code-secret-value', 'owner-secret-value', 'activation-proof-value'];
  const service = new IndexAppOwnerAuthorizationService(store, {
    now: () => NOW, randomId: () => ids.shift()!, randomSecret: () => secrets.shift()!,
  });
  controller = new IndexAppOwnerAuthorizationController(service);
});

function post(path: string, body: unknown, credential?: string): Request {
  return new Request(`http://localhost/api${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(credential ? { 'x-api-key': credential } : {}) },
    body: JSON.stringify(body),
  });
}

async function begin() {
  const response = await controller.create(post('/index-app-owner-authorizations', {
    protocolVersion: 1, installationId: INSTALLATION, redirectUri: REDIRECT,
    state: STATE, codeChallenge: await challenge(VERIFIER), codeChallengeMethod: 'S256',
    legacyKeyId: 'legacy-id',
  }));
  expect(response.status).toBe(201);
}

async function approve() {
  await begin();
  return controller.approve(post(`/index-app-owner-authorizations/${REQUEST_ID}/approve`, {
    state: STATE, redirectUri: REDIRECT,
  }), OWNER, { id: REQUEST_ID });
}

describe('Index app owner authorization controller', () => {
  it('keeps create/exchange native-public and metadata/approval session-only', () => {
    expect(RouteRegistry.getGuards(IndexAppOwnerAuthorizationController, 'create')).not.toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(IndexAppOwnerAuthorizationController, 'exchange')).not.toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(IndexAppOwnerAuthorizationController, 'get')).toContain(SessionOnlyGuard);
    expect(RouteRegistry.getGuards(IndexAppOwnerAuthorizationController, 'approve')).toContain(SessionOnlyGuard);
  });

  it('rejects unknown fields, noncanonical callbacks, and malformed state', async () => {
    for (const body of [
      { protocolVersion: 1, installationId: INSTALLATION, redirectUri: 'http://localhost:49152/callback', state: STATE, codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', legacyKeyId: null },
      { protocolVersion: 1, installationId: INSTALLATION, redirectUri: REDIRECT, state: STATE, codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', legacyKeyId: null, headers: {} },
    ]) expect((await controller.create(post('/index-app-owner-authorizations', body))).status).toBe(400);
  });

  it('returns only consent metadata and a one-time browser code', async () => {
    await begin();
    const get = await controller.get(
      new Request(`http://localhost/api/index-app-owner-authorizations/${REQUEST_ID}?state=${STATE}&redirect_uri=${encodeURIComponent(REDIRECT)}`),
      OWNER, { id: REQUEST_ID },
    );
    const metadata = await get.json() as Record<string, unknown>;
    expect(metadata).toEqual({
      requestId: REQUEST_ID, installationId: INSTALLATION,
      legacyRevocationRequired: true, expiresAt: '2026-08-09T12:10:00.000Z',
    });
    expect(JSON.stringify(metadata)).not.toMatch(/credential|verifier|challenge|code/i);
    const approved = await controller.approve(post(`/index-app-owner-authorizations/${REQUEST_ID}/approve`, {
      state: STATE, redirectUri: REDIRECT,
    }), OWNER, { id: REQUEST_ID });
    expect(await approved.json()).toEqual({ requestId: REQUEST_ID, code: 'browser-code-secret-value', state: STATE });
  });

  it('revokes legacy before pending issuance, activates with one-time proof, then revokes before deletion', async () => {
    const approved = await approve();
    const approval = await approved.json() as { code: string };
    const exchange = await controller.exchange(post('/index-app-owner-authorizations/exchange', {
      protocolVersion: 1, requestId: REQUEST_ID, code: approval.code,
      state: STATE, verifier: VERIFIER, redirectUri: REDIRECT,
    }));
    const pending = await exchange.json() as Record<string, unknown>;
    expect(store.legacyRevokedBeforePending).toBe(true);
    expect(pending.credential).toBe('idxo_owner-secret-value');
    expect(pending.activationState).toBe('pending');
    const active = await controller.activate(post('/index-app-owner-authorizations/activate', {
      protocolVersion: 1, activationProof: 'activation-proof-value',
    }, String(pending.credential)));
    expect((await active.json() as { activationState: string }).activationState).toBe('active');
    expect(store.credential?.proofHash).toBeNull();
    const replay = await controller.activate(post('/index-app-owner-authorizations/activate', {
      protocolVersion: 1, activationProof: 'activation-proof-value',
    }, String(pending.credential)));
    expect(replay.status).toBe(403);
    const revoked = await controller.revoke(post('/index-app-owner-authorizations/revoke', {
      protocolVersion: 1,
    }, String(pending.credential)));
    expect(await revoked.json()).toEqual({ revoked: true, credentialId: CREDENTIAL_ID });
    expect(store.credential?.activationState).toBe('revoked');
    const retry = await controller.revoke(post('/index-app-owner-authorizations/revoke', {
      protocolVersion: 1,
    }, String(pending.credential)));
    expect(await retry.json()).toEqual({ revoked: true, credentialId: CREDENTIAL_ID });
  });
});
