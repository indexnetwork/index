import { describe, expect, it } from 'bun:test';

import { INDEX_APP_OWNER_AUDIENCE, INDEX_APP_OWNER_CREDENTIAL_PREFIX, authorizeIndexAppOwner, authenticateApiKey, authenticateRequestApiKey, type IndexAppOwnerAuthenticationStore } from '../auth.guard';

const allowed = [
  ['GET', '/api/auth/me'],
  ['POST', '/api/intents/list'],
  ['POST', '/api/chat/stream'],
  ['POST', '/mcp'],
  ['GET', '/api/conversations/stream'],
  ['POST', '/api/storage/avatars'],
  ['GET', '/api/agent-runtime?installationId=i1'],
  ['PUT', '/api/agent-runtime'],
] as const;

const denied = [
  ['POST', '/api/auth/cli-credential'],
  ['POST', '/api/index-app-owner-authorizations'],
  ['DELETE', '/api/auth/account'],
  ['POST', '/api/agents'],
  ['POST', '/api/agents/permissions'],
  ['POST', '/api/billing/checkout'],
  ['GET', '/api/debug'],
] as const;

describe('Index app dedicated owner principal', () => {
  it('admits only the native product method/path matrix', () => {
    for (const [method, path] of allowed) {
      expect(authorizeIndexAppOwner({ method, path }), `${method} ${path}`).toEqual({ allowed: true });
    }
    for (const [method, path] of denied) {
      expect(authorizeIndexAppOwner({ method, path }), `${method} ${path}`).toEqual({
        allowed: false, reason: 'dedicated_owner_route_denied',
      });
    }
  });

  it('dispatches idxo_ before legacy lookup and requires active installation authority', async () => {
    let legacyReads = 0;
    const ownerStore: IndexAppOwnerAuthenticationStore = {
      async findCredentialByHash() {
        return {
          id: 'owner-credential-1', ownerId: 'owner-1', audience: INDEX_APP_OWNER_AUDIENCE,
          installationId: 'installation-1', generation: 'generation-1',
          activationState: 'active', expiresAt: new Date(Date.now() + 60_000),
        };
      },
      async findCurrentInstallationAuthority() {
        return { credentialId: 'owner-credential-1', ownerId: 'owner-1', installationId: 'installation-1', generation: 'generation-1' };
      },
      async findUserById() { return { id: 'owner-1', email: 'owner@index.network', name: 'Owner' }; },
    };
    const request = new Request('https://api.index.network/api/auth/me', {
      headers: { 'x-api-key': `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}secret` },
    });
    const user = await authenticateRequestApiKey(request, `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}secret`, {
      indexAppOwner: ownerStore,
      legacy: {
        async findCredentialByHash() { legacyReads += 1; return null; },
        async findUserById() { return null; },
      },
    });
    expect(user.id).toBe('owner-1');
    expect(legacyReads).toBe(0);

    const deniedRequest = new Request('https://api.index.network/api/auth/cli-credential', {
      method: 'POST', headers: { 'x-api-key': `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}secret` },
    });
    await expect(authenticateRequestApiKey(
      deniedRequest, `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}secret`, { indexAppOwner: ownerStore },
    )).rejects.toMatchObject({ name: 'IndexAppOwnerRouteDeniedError' });

    const staleStore: IndexAppOwnerAuthenticationStore = {
      ...ownerStore,
      async findCurrentInstallationAuthority() {
        return { credentialId: 'owner-credential-1', ownerId: 'owner-1', installationId: 'installation-1', generation: 'stale' };
      },
    };
    await expect(authenticateRequestApiKey(
      request, `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}secret`, { indexAppOwner: staleStore },
    )).rejects.toThrow('Invalid API key');
  });

  it('freezes rollback compatibility: the legacy lookup cannot reinterpret idxo_', async () => {
    let legacyReads = 0;
    await expect(authenticateApiKey(
      new Request('https://api.index.network/api/auth/me'),
      `${INDEX_APP_OWNER_CREDENTIAL_PREFIX}rollback-proof`,
      {
        async findCredentialByHash() { legacyReads += 1; return null; },
        async findUserById() { return null; },
      },
    )).rejects.toThrow('Invalid API key');
    expect(legacyReads).toBe(1);
  });
});
