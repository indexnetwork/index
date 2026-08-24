import { describe, expect, it } from 'bun:test';

import { HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND, HermesNegotiatorRouteDeniedError, assertApiKeyAudienceRoute, authenticateApiKey, type ApiKeyAuthenticationCredential } from '../auth.guard';
import { isHermesNegotiatorAudience } from '../../lib/agent/hermes-credential';

const agentId = 'agent-hermes';
const principal = {
  audience: HERMES_NEGOTIATOR_AUDIENCE,
  agentId,
  credentialId: 'credential-current',
  setupAttemptId: 'setup-current',
};

function request(method: string, path: string): Request {
  return new Request(`http://localhost${path}`, { method });
}

describe('Hermes negotiator audience REST boundary', () => {
  it.each([
    ['GET', '/api/agents/me'],
    ['POST', `/api/agents/${agentId}/negotiations/pickup`],
    ['POST', `/api/agents/${agentId}/negotiations/task-1/respond`],
    ['POST', `/api/agents/${agentId}/negotiations/task-1/consult`],
  ])('allows only the exact negotiation route: %s %s', (method, path) => {
    expect(() => assertApiKeyAudienceRoute(request(method, path), principal)).not.toThrow();
  });

  it.each([
    ['GET', '/api/conversations'],
    ['POST', '/api/intents/list'],
    ['GET', '/api/users/owner/negotiator/memories'],
    ['GET', '/api/integrations'],
    ['POST', '/api/storage/avatars'],
    ['POST', '/api/chat/stream'],
    ['PATCH', '/api/opportunities/opportunity-1/status'],
    ['GET', '/api/agents'],
    ['GET', `/api/agents/${agentId}`],
    ['GET', `/api/agents/${agentId}/tokens`],
    ['POST', `/api/agents/${agentId}/test-messages`],
    ['POST', `/api/agents/${agentId}/opportunities/pickup`],
    ['GET', '/api/agent-runtime?installationId=installation-1'],
    ['POST', '/api/agent-runtime/hermes/prepare'],
    ['PUT', '/api/agent-runtime'],
    ['POST', '/api/agent-runtime/rollback'],
    ['DELETE', '/api/agent-runtime/hermes/installation-1'],
    ['POST', '/mcp'],
    ['POST', `/api/agents/wrong-agent/negotiations/pickup`],
    ['GET', '/api/agents/me/extra'],
  ])('default-denies owner and unrelated surfaces: %s %s', (method, path) => {
    expect(() => assertApiKeyAudienceRoute(request(method, path), principal))
      .toThrow(HermesNegotiatorRouteDeniedError);
  });

  it('is rejected by the provider-free MCP audience gate', () => {
    expect(isHermesNegotiatorAudience({ audience: 'hermes-negotiator', agentId })).toBe(true);
    expect(isHermesNegotiatorAudience(JSON.stringify({ audience: 'hermes-negotiator', agentId }))).toBe(true);
    expect(isHermesNegotiatorAudience({ agentId })).toBe(false);
  });

  it('does not narrow legacy agent-bound keys that have no explicit Hermes audience', () => {
    expect(() => assertApiKeyAudienceRoute(request('GET', '/api/conversations'), {
      ...principal,
      audience: null,
      setupAttemptId: null,
    })).not.toThrow();
  });

  it.each([
    ['missing credential row identity', { id: undefined }],
    ['empty credential row identity', { id: '' }],
    ['missing agent identity', { metadata: { agentId: undefined } }],
    ['empty agent identity', { metadata: { agentId: '' } }],
    ['non-string agent identity', { metadata: { agentId: 42 } }],
    ['missing setup identity', { metadata: { setupAttemptId: undefined } }],
    ['empty setup identity', { metadata: { setupAttemptId: '' } }],
    ['non-string setup identity', { metadata: { setupAttemptId: 42 } }],
    ['wrong credential kind', { metadata: { kind: 'ordinary-agent-key' } }],
    ['missing metadata expiry identity', { metadata: { expiresAt: undefined } }],
    ['mismatched metadata expiry identity', { metadata: { expiresAt: '2027-01-01T00:00:00.000Z' } }],
  ] as const)('rejects dedicated audience authentication before owner lookup for %s', async (_label, override) => {
    const expiresAt = new Date(Date.now() + 60_000);
    const baseMetadata: Record<string, unknown> = {
      audience: HERMES_NEGOTIATOR_AUDIENCE,
      kind: HERMES_NEGOTIATOR_CREDENTIAL_KIND,
      agentId,
      setupAttemptId: 'setup-current',
      expiresAt: expiresAt.toISOString(),
    };
    const credential: ApiKeyAuthenticationCredential = {
      id: 'credential-current',
      referenceId: 'owner-1',
      userId: 'owner-1',
      enabled: true,
      expiresAt,
      metadata: JSON.stringify({ ...baseMetadata, ...('metadata' in override ? override.metadata : {}) }),
      ...('id' in override ? { id: override.id } : {}),
    };
    let ownerLookups = 0;

    await expect(authenticateApiKey(
      request('GET', '/api/agents/me'),
      'dedicated-secret',
      {
        findCredentialByHash: async () => credential,
        findUserById: async () => {
          ownerLookups += 1;
          return { id: 'owner-1', email: null, name: 'Owner' };
        },
      },
    )).rejects.toThrow('Invalid API key');
    expect(ownerLookups).toBe(0);
  });
});
