import { describe, expect, it } from 'bun:test';

import { INDEX_APP_OWNER_CREDENTIAL_TTL_MS, INDEX_APP_OWNER_REQUEST_TTL_MS, type IndexAppOwnerAuthorizationStore } from '../../lib/agent/index-app-owner-authorization';
import { IndexAppOwnerAuthorizationService } from '../index-app-owner-authorization.service';

const now = new Date('2026-08-09T12:00:00.000Z');

function createStore() {
  const calls: Array<[string, unknown]> = [];
  const store: IndexAppOwnerAuthorizationStore = {
    async createAuthorization(input) {
      calls.push(['create', input]);
      return { requestId: input.requestId, state: input.state, expiresAt: input.expiresAt };
    },
    async getAuthorization(input) {
      calls.push(['get', input]);
      return {
        requestId: input.requestId,
        installationId: '00000000-0000-4000-8000-000000000001',
        redirectUri: 'http://127.0.0.1:49152/callback',
        state: input.state,
        legacyKeyId: 'legacy-key-id',
        expiresAt: new Date(now.getTime() + INDEX_APP_OWNER_REQUEST_TTL_MS),
      };
    },
    async approveAuthorization(input) {
      calls.push(['approve', input]);
      return { state: input.state, redirectUri: input.redirectUri, expiresAt: input.expiresAt };
    },
    async exchangeAuthorizationCode(input) {
      calls.push(['exchange', input]);
      return {
        ownerId: 'owner-1', credentialId: input.credentialId,
        installationId: '00000000-0000-4000-8000-000000000001',
        generation: input.generation, expiresAt: input.expiresAt, activationState: 'pending' as const,
      };
    },
    async authenticatePendingCredential() { return null; },
    async activatePendingCredential(input) {
      calls.push(['activate', input]);
      return { ...input.principal, activationState: 'active' as const };
    },
    async rollbackPendingCredential(input) {
      calls.push(['rollback', input]);
      return { revoked: true as const, credentialId: input.principal.credentialId };
    },
    async authenticateRevocableCredential() { return null; },
    async revokeCredential(input) {
      calls.push(['revoke', input]);
      return { revoked: true as const, credentialId: input.principal.credentialId };
    },
  };
  return { store, calls };
}

function service(store: IndexAppOwnerAuthorizationStore) {
  const secrets = ['credential-secret', 'activation-secret', 'code-secret'];
  let id = 0;
  return new IndexAppOwnerAuthorizationService(store, {
    now: () => now,
    randomId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    randomSecret: () => secrets.shift()!,
  });
}

describe('Index app owner one-time authorization service', () => {
  it('creates only a verifier-free ten-minute request', async () => {
    const { store, calls } = createStore();
    const result = await service(store).createAuthorization({
      installationId: '00000000-0000-4000-8000-000000000001',
      redirectUri: 'http://127.0.0.1:49152/callback',
      state: 's'.repeat(32), codeChallenge: 'c'.repeat(43), legacyKeyId: 'legacy-key-id',
    });
    expect(result.expiresAt.toISOString()).toBe('2026-08-09T12:10:00.000Z');
    expect(calls[0][1]).not.toHaveProperty('verifier');
    expect(calls[0][1]).not.toHaveProperty('credential');
  });

  it('binds browser metadata and approval to state plus redirect', async () => {
    const { store } = createStore();
    const owner = service(store);
    await expect(owner.getAuthorization(
      '00000000-0000-4000-8000-000000000002', 's'.repeat(32),
      'http://127.0.0.1:49153/callback',
    )).rejects.toMatchObject({ code: 'invalid_grant' });
    await expect(owner.approveAuthorization(
      'owner-1', '00000000-0000-4000-8000-000000000002', 's'.repeat(32),
      'http://127.0.0.1:49153/callback',
    )).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('returns raw pending material once while persisting hashes only', async () => {
    const { store, calls } = createStore();
    const owner = service(store);
    const exchanged = await owner.exchangeAuthorizationCode({
      requestId: '00000000-0000-4000-8000-000000000002',
      code: 'browser-code-value', state: 's'.repeat(32), verifier: 'v'.repeat(43),
      redirectUri: 'http://127.0.0.1:49152/callback',
    });
    expect(exchanged.credential).toBe('idxo_credential-secret');
    expect(exchanged.activationProof).toBe('activation-secret');
    expect(exchanged.expiresAt.getTime() - now.getTime()).toBe(INDEX_APP_OWNER_CREDENTIAL_TTL_MS);
    const input = calls.find(([name]) => name === 'exchange')?.[1] as Record<string, unknown>;
    expect(input).toHaveProperty('credentialHash');
    expect(input).toHaveProperty('activationProofHash');
    expect(JSON.stringify(input)).not.toContain('credential-secret');
    expect(JSON.stringify(input)).not.toContain('activation-secret');
    expect(JSON.stringify(input)).not.toContain('browser-code-value');
    expect(input).not.toHaveProperty('verifier');
  });
});
