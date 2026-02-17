import { describe, it, expect } from 'bun:test';
import {
  WellKnownResponseSchema,
  FederatedUserSchema,
  FederatedIndexSchema,
  FederatedIntentSchema,
  PushIntentRequestSchema,
  UpdateIntentRequestSchema,
  QueryIndexRequestSchema,
  QueryIndexResponseSchema,
  JoinIndexRequestSchema,
  ChatMessageSchema,
} from '../types';

describe('Federation spec types', () => {
  it('validates a well-known response', () => {
    const valid = {
      version: '0.1.0',
      name: 'Test Node',
      baseUrl: 'https://node-a.com',
      endpoints: { users: '/users', indexes: '/indexes', inbox: '/inbox' },
      publicKey: { id: 'https://node-a.com#main-key', pem: '-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----' },
    };
    expect(WellKnownResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects well-known response missing version', () => {
    expect(() => WellKnownResponseSchema.parse({ name: 'X', baseUrl: 'https://x.com' })).toThrow();
  });

  it('validates a federated user', () => {
    const user = { id: 'https://node-a.com/users/abc', name: 'Alice', avatar: null, narrative: null, attributes: null, nodeUrl: 'https://node-a.com' };
    expect(FederatedUserSchema.parse(user)).toEqual(user);
  });

  it('validates a federated index', () => {
    const index = { id: 'https://node-b.com/indexes/xyz', title: 'AI Founders', prompt: 'Looking for AI co-founders', memberCount: 5, nodeUrl: 'https://node-b.com', permissions: null };
    expect(FederatedIndexSchema.parse(index)).toEqual(index);
  });

  it('validates a push intent request', () => {
    const req = { actor: 'https://node-a.com/users/abc', payload: 'Need a Rust dev', embedding: [0.1, -0.2], metadata: {} };
    expect(PushIntentRequestSchema.parse(req)).toEqual(req);
  });

  it('validates a query index request', () => {
    const req = { embedding: [0.1, 0.2], limit: 50, filters: { status: 'ACTIVE' } };
    expect(QueryIndexRequestSchema.parse(req)).toEqual(req);
  });

  it('validates a join index request', () => {
    const req = { actor: 'https://node-a.com/users/abc' };
    expect(JoinIndexRequestSchema.parse(req)).toEqual(req);
  });

  it('validates a federated intent', () => {
    const intent = {
      intentUrl: 'https://node-a.com/indexes/idx1/intents/abc',
      payload: 'Looking for a designer',
      embedding: [0.1, 0.2, -0.3],
      similarity: 0.95,
      userId: 'https://node-a.com/users/alice',
    };
    expect(FederatedIntentSchema.parse(intent)).toEqual(intent);
  });

  it('validates a query index response', () => {
    const response = {
      results: [{
        intentUrl: 'https://node-a.com/indexes/idx1/intents/abc',
        payload: 'test',
        embedding: [0.1],
        userId: 'https://node-a.com/users/u1',
      }],
    };
    expect(QueryIndexResponseSchema.parse(response)).toEqual(response);
  });

  it('validates an update intent request', () => {
    const req = { actor: 'https://node-a.com/users/abc', payload: 'Updated payload' };
    expect(UpdateIntentRequestSchema.parse(req)).toEqual(req);
  });

  it('validates a chat message', () => {
    const msg = {
      type: 'ChatMessage' as const,
      from: 'https://node-a.com/users/alice',
      to: 'https://node-b.com/users/bob',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      content: 'Hello!',
      context: null,
      timestamp: '2026-02-16T10:00:00Z',
    };
    expect(ChatMessageSchema.parse(msg)).toEqual(msg);
  });
});
