import { describe, it, expect, jest, beforeEach } from 'bun:test';
import { FederationClient } from '../federation.client';

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as any;

describe('FederationClient', () => {
  const client = new FederationClient({
    localBaseUrl: 'https://my-node.com',
    privateKeyPem: '',
    keyId: 'https://my-node.com#main-key',
  });

  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('fetches well-known from a remote node', async () => {
    const wellKnown = {
      version: '0.1.0',
      name: 'Remote Node',
      baseUrl: 'https://remote.com',
      endpoints: { users: '/users', indexes: '/indexes', inbox: '/inbox' },
      publicKey: { id: 'https://remote.com#main-key', pem: 'test-pem' },
    };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => wellKnown });

    const result = await client.discoverNode('https://remote.com');
    expect(result).toEqual(wellKnown);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://remote.com/.well-known/index-protocol',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('queries a remote index', async () => {
    const response = { results: [{ intentUrl: 'https://remote.com/indexes/1/intents/2', payload: 'test', embedding: [0.1], userId: 'https://remote.com/users/u1' }] };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const result = await client.queryIndex('https://remote.com/indexes/1', { embedding: [0.1, 0.2], limit: 10, filters: {} });
    expect(result.results).toHaveLength(1);
  });

  it('pushes intent to remote index', async () => {
    const response = { intentUrl: 'https://remote.com/indexes/1/intents/new-id' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => response });

    const result = await client.pushIntent('https://remote.com/indexes/1', {
      actor: 'https://my-node.com/users/alice',
      payload: 'Looking for Rust dev',
      embedding: [0.1, -0.2],
      metadata: {},
    });
    expect(result.intentUrl).toBe('https://remote.com/indexes/1/intents/new-id');
  });

  it('sends chat message to remote node', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 202 });

    await client.sendChatMessage('https://remote.com', {
      type: 'ChatMessage' as const,
      from: 'https://my-node.com/users/alice',
      to: 'https://remote.com/users/bob',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Hello!',
      context: null,
      timestamp: new Date().toISOString(),
    });
    expect(mockFetch).toHaveBeenCalled();
  });
});
