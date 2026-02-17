import { describe, it, expect, jest } from 'bun:test';
import { FederationController } from '../federation.controller';

describe('FederationController', () => {
  const mockIndexBridge = {
    getIndex: jest.fn(),
    joinIndex: jest.fn(),
  };
  const mockUserBridge = { getUser: jest.fn() };
  const mockIntentBridge = { pushIntent: jest.fn(), queryIndex: jest.fn() };
  const mockChatBridge = { receiveMessage: jest.fn() };

  const controller = new FederationController({
    nodeUrl: 'https://my-node.com',
    version: '0.1.0',
    name: 'My Node',
    publicKeyPem: 'test-pem',
    indexBridge: mockIndexBridge as any,
    userBridge: mockUserBridge as any,
    intentBridge: mockIntentBridge as any,
    chatBridge: mockChatBridge as any,
  });

  it('returns well-known response', async () => {
    const req = new Request('https://my-node.com/.well-known/index-protocol');
    const res = await controller.wellKnown(req);
    const body = await res.json();
    expect(body.version).toBe('0.1.0');
    expect(body.baseUrl).toBe('https://my-node.com');
  });

  it('returns federated index', async () => {
    mockIndexBridge.getIndex.mockResolvedValueOnce({
      id: 'https://my-node.com/indexes/xyz',
      title: 'Test',
      prompt: null,
      permissions: null,
      memberCount: 3,
      nodeUrl: 'https://my-node.com',
    });
    const req = new Request('https://my-node.com/federation/indexes/xyz');
    const res = await controller.getIndex(req, null, { id: 'xyz' });
    const body = await res.json();
    expect(body.title).toBe('Test');
  });

  it('returns 404 for unknown index', async () => {
    mockIndexBridge.getIndex.mockResolvedValueOnce(null);
    const req = new Request('https://my-node.com/federation/indexes/unknown');
    const res = await controller.getIndex(req, null, { id: 'unknown' });
    expect(res.status).toBe(404);
  });
});
