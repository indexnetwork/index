import { describe, it, expect } from 'bun:test';
import { FederationController } from '../src/federation/server/federation.controller';
import { Resolver } from '../src/federation/client/resolver';

describe('Federation integration (in-process)', () => {
  const nodeAUrl = 'https://node-a.test';
  const nodeBUrl = 'https://node-b.test';

  // --- Mock bridges mimicking Node B's local data layer ---

  const mockIndexBridge = {
    getIndex: async (id: string) => ({
      id: `${nodeBUrl}/indexes/${id}`,
      title: 'Test Index',
      prompt: 'Test prompt',
      permissions: null,
      memberCount: 2,
      nodeUrl: nodeBUrl,
    }),
    joinIndex: async () => ({ membership: { role: 'member' } }),
  };

  const mockIntentBridge = {
    pushIntent: async (indexId: string, _req: any) => ({
      intentUrl: `${nodeBUrl}/indexes/${indexId}/intents/new-id`,
    }),
    queryIndex: async () => [
      {
        intentUrl: `${nodeBUrl}/indexes/idx1/intents/int1`,
        payload: 'Looking for Rust dev',
        embedding: [0.1, -0.2],
        similarity: 0.95,
        userId: `${nodeBUrl}/users/bob`,
      },
    ],
  };

  const mockUserBridge = {
    getUser: async (id: string) => ({
      id: `${nodeBUrl}/users/${id}`,
      name: 'Bob',
      avatar: null,
      narrative: null,
      attributes: null,
      nodeUrl: nodeBUrl,
    }),
  };

  const mockChatBridge = {
    receiveMessage: async () => {},
  };

  // Instantiate Node B's controller with mock bridges
  const controllerB = new FederationController({
    nodeUrl: nodeBUrl,
    version: '0.1.0',
    name: 'Node B',
    publicKeyPem: 'test-key',
    indexBridge: mockIndexBridge as any,
    userBridge: mockUserBridge as any,
    intentBridge: mockIntentBridge as any,
    chatBridge: mockChatBridge as any,
  });

  it('node A discovers node B', async () => {
    const req = new Request(`${nodeBUrl}/.well-known/index-protocol`);
    const res = await controllerB.wellKnown(req);
    const body = await res.json();
    expect(body.version).toBe('0.1.0');
    expect(body.baseUrl).toBe(nodeBUrl);
    expect(body.endpoints.indexes).toBe('/federation/indexes');
    expect(body.endpoints.inbox).toBe('/federation/inbox');
    expect(body.publicKey.pem).toBe('test-key');
  });

  it('node A fetches an index from node B', async () => {
    const req = new Request(`${nodeBUrl}/federation/indexes/idx1`);
    const res = await controllerB.getIndex(req, null, { id: 'idx1' });
    const body = await res.json();
    expect(body.title).toBe('Test Index');
    expect(body.id).toBe(`${nodeBUrl}/indexes/idx1`);
    expect(body.memberCount).toBe(2);
    expect(body.nodeUrl).toBe(nodeBUrl);
  });

  it('node A pushes intent to node B index', async () => {
    const req = new Request(`${nodeBUrl}/federation/indexes/idx1/intents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: `${nodeAUrl}/users/alice`,
        payload: 'Need a designer',
        embedding: [0.5, 0.3],
        metadata: {},
      }),
    });
    const res = await controllerB.pushIntent(req, null, { id: 'idx1' });
    const body = await res.json();
    expect(body.intentUrl).toContain('intents/new-id');
    expect(res.status).toBe(201);
  });

  it('node A queries node B index', async () => {
    const req = new Request(`${nodeBUrl}/federation/indexes/idx1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding: [0.1, 0.2], limit: 10, filters: {} }),
    });
    const res = await controllerB.queryIndex(req, null, { id: 'idx1' });
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].payload).toBe('Looking for Rust dev');
    expect(body.results[0].similarity).toBe(0.95);
  });

  it('node A sends chat message to node B user', async () => {
    const req = new Request(`${nodeBUrl}/federation/inbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ChatMessage',
        from: `${nodeAUrl}/users/alice`,
        to: `${nodeBUrl}/users/bob`,
        sessionId: '550e8400-e29b-41d4-a716-446655440000',
        content: 'Hey Bob!',
        context: null,
        timestamp: '2026-02-16T10:00:00Z',
      }),
    });
    const res = await controllerB.inbox(req);
    expect(res.status).toBe(202);
  });

  it('resolver correctly identifies local vs remote', () => {
    const resolver = new Resolver(nodeAUrl);
    expect(resolver.isLocal(`${nodeAUrl}/users/alice`)).toBe(true);
    expect(resolver.isLocal(`${nodeBUrl}/indexes/idx1`)).toBe(false);
    expect(resolver.nodeBaseUrl(`${nodeBUrl}/indexes/idx1`)).toBe(nodeBUrl);
    expect(resolver.resourcePath(`${nodeBUrl}/indexes/idx1`)).toBe('/indexes/idx1');
  });
});
