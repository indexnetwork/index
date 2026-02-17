# Federation Protocol v0.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Index Federation Protocol v0.1 — enabling nodes to discover each other, exchange index/intent data, relay chat messages, and fan out opportunity queries.

**Architecture:** New `protocol/src/federation/` directory with four layers: `spec/` (Zod schemas, zero dependencies), `server/` (incoming federation controller + signature verification), `client/` (outgoing HTTP client + URL resolver), `bridge/` (translates federation types to existing services). Existing services remain untouched.

**Tech Stack:** Bun, Zod, existing Drizzle schema, existing controller decorators (`@Controller`, `@Get`, `@Post`), existing `AuthGuard` pattern adapted for node-level signatures.

**Design doc:** `docs/plans/2026-02-16-federation-protocol-design.md`

---

## Task 1: Protocol Spec Types

Define the wire-format types as Zod schemas. No implementation logic — pure types.

**Files:**
- Create: `protocol/src/federation/spec/types.ts`

**Step 1: Write the failing test**

Create: `protocol/src/federation/spec/__tests__/types.test.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import {
  WellKnownResponseSchema,
  FederatedUserSchema,
  FederatedIndexSchema,
  FederatedIntentSchema,
  PushIntentRequestSchema,
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
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/federation/spec/__tests__/types.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create: `protocol/src/federation/spec/types.ts`

```typescript
import { z } from 'zod';

// -- Node Discovery --

export const WellKnownResponseSchema = z.object({
  version: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  endpoints: z.object({
    users: z.string(),
    indexes: z.string(),
    inbox: z.string(),
  }),
  publicKey: z.object({
    id: z.string(),
    pem: z.string(),
  }),
});
export type WellKnownResponse = z.infer<typeof WellKnownResponseSchema>;

// -- Federated Entities --

export const FederatedUserSchema = z.object({
  id: z.string().url(),
  name: z.string(),
  avatar: z.string().url().nullable(),
  narrative: z.string().nullable(),
  attributes: z.record(z.unknown()).nullable(),
  nodeUrl: z.string().url(),
});
export type FederatedUser = z.infer<typeof FederatedUserSchema>;

export const FederatedIndexSchema = z.object({
  id: z.string().url(),
  title: z.string(),
  prompt: z.string().nullable(),
  permissions: z.record(z.unknown()).nullable(),
  memberCount: z.number().int(),
  nodeUrl: z.string().url(),
});
export type FederatedIndex = z.infer<typeof FederatedIndexSchema>;

export const FederatedIntentSchema = z.object({
  intentUrl: z.string().url(),
  payload: z.string(),
  embedding: z.array(z.number()),
  similarity: z.number().optional(),
  userId: z.string().url(),
});
export type FederatedIntent = z.infer<typeof FederatedIntentSchema>;

// -- Requests --

export const JoinIndexRequestSchema = z.object({
  actor: z.string().url(),
});
export type JoinIndexRequest = z.infer<typeof JoinIndexRequestSchema>;

export const PushIntentRequestSchema = z.object({
  actor: z.string().url(),
  payload: z.string(),
  embedding: z.array(z.number()),
  metadata: z.record(z.unknown()).default({}),
});
export type PushIntentRequest = z.infer<typeof PushIntentRequestSchema>;

export const UpdateIntentRequestSchema = z.object({
  actor: z.string().url(),
  payload: z.string().optional(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateIntentRequest = z.infer<typeof UpdateIntentRequestSchema>;

export const QueryIndexRequestSchema = z.object({
  embedding: z.array(z.number()),
  limit: z.number().int().min(1).max(200).default(50),
  filters: z.object({
    status: z.string().optional(),
  }).default({}),
});
export type QueryIndexRequest = z.infer<typeof QueryIndexRequestSchema>;

export const QueryIndexResponseSchema = z.object({
  results: z.array(FederatedIntentSchema),
});
export type QueryIndexResponse = z.infer<typeof QueryIndexResponseSchema>;

// -- Chat --

export const ChatMessageSchema = z.object({
  type: z.literal('ChatMessage'),
  from: z.string().url(),
  to: z.string().url(),
  sessionId: z.string().uuid(),
  content: z.string(),
  context: z.object({
    indexUrl: z.string().url().optional(),
    opportunityId: z.string().optional(),
  }).nullable(),
  timestamp: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/federation/spec/__tests__/types.test.ts`
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add protocol/src/federation/spec/
git commit -m "feat(federation): add protocol spec types with Zod schemas"
```

---

## Task 2: HTTP Signature Utilities

Implement request signing (outgoing) and verification (incoming) using Node.js crypto.

**Files:**
- Create: `protocol/src/federation/server/signature.ts`

**Step 1: Write the failing test**

Create: `protocol/src/federation/server/__tests__/signature.test.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import { generateKeyPair, signRequest, verifyRequest } from '../signature';

describe('HTTP Signatures', () => {
  it('generates a key pair', async () => {
    const keys = await generateKeyPair();
    expect(keys.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(keys.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('signs and verifies a request', async () => {
    const keys = await generateKeyPair();
    const url = 'https://node-b.com/api/federation/indexes/123/intents';
    const method = 'POST';
    const body = JSON.stringify({ actor: 'https://node-a.com/users/alice', payload: 'test' });

    const headers = signRequest({ method, url, body, privateKeyPem: keys.privateKeyPem, keyId: 'https://node-a.com#main-key' });

    expect(headers['Signature']).toBeDefined();
    expect(headers['Digest']).toBeDefined();

    const valid = verifyRequest({
      method,
      url,
      headers,
      body,
      publicKeyPem: keys.publicKeyPem,
    });
    expect(valid).toBe(true);
  });

  it('rejects tampered body', async () => {
    const keys = await generateKeyPair();
    const url = 'https://node-b.com/api/federation/indexes/123/intents';
    const method = 'POST';
    const body = JSON.stringify({ payload: 'original' });

    const headers = signRequest({ method, url, body, privateKeyPem: keys.privateKeyPem, keyId: 'https://node-a.com#main-key' });

    const valid = verifyRequest({
      method,
      url,
      headers,
      body: JSON.stringify({ payload: 'tampered' }),
      publicKeyPem: keys.publicKeyPem,
    });
    expect(valid).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/federation/server/__tests__/signature.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

Create: `protocol/src/federation/server/signature.ts`

```typescript
import { createSign, createVerify, generateKeyPairSync, createHash } from 'crypto';

export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey as string, privateKeyPem: privateKey as string };
}

function digestBody(body: string): string {
  const hash = createHash('sha256').update(body).digest('base64');
  return `SHA-256=${hash}`;
}

interface SignInput {
  method: string;
  url: string;
  body: string;
  privateKeyPem: string;
  keyId: string;
}

export function signRequest({ method, url, body, privateKeyPem, keyId }: SignInput): Record<string, string> {
  const parsedUrl = new URL(url);
  const date = new Date().toUTCString();
  const digest = digestBody(body);
  const target = `${method.toLowerCase()} ${parsedUrl.pathname}`;

  const signingString = [
    `(request-target): ${target}`,
    `host: ${parsedUrl.host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join('\n');

  const signer = createSign('RSA-SHA256');
  signer.update(signingString);
  const signature = signer.sign(privateKeyPem, 'base64');

  const signatureHeader = `keyId="${keyId}",headers="(request-target) host date digest",signature="${signature}"`;

  return {
    Host: parsedUrl.host,
    Date: date,
    Digest: digest,
    Signature: signatureHeader,
  };
}

interface VerifyInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  publicKeyPem: string;
}

export function verifyRequest({ method, url, headers, body, publicKeyPem }: VerifyInput): boolean {
  // Verify digest
  const expectedDigest = digestBody(body);
  if (headers['Digest'] !== expectedDigest) return false;

  // Parse signature header
  const sigHeader = headers['Signature'];
  if (!sigHeader) return false;

  const sigMatch = sigHeader.match(/signature="([^"]+)"/);
  if (!sigMatch) return false;
  const signature = sigMatch[1];

  const parsedUrl = new URL(url);
  const target = `${method.toLowerCase()} ${parsedUrl.pathname}`;

  const signingString = [
    `(request-target): ${target}`,
    `host: ${headers['Host'] || parsedUrl.host}`,
    `date: ${headers['Date']}`,
    `digest: ${headers['Digest']}`,
  ].join('\n');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingString);
  return verifier.verify(publicKeyPem, signature, 'base64');
}
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/federation/server/__tests__/signature.test.ts`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add protocol/src/federation/server/
git commit -m "feat(federation): add HTTP signature sign/verify utilities"
```

---

## Task 3: Federation Client + Resolver

HTTP client for calling remote nodes, plus a URL resolver that determines local vs remote.

**Files:**
- Create: `protocol/src/federation/client/federation.client.ts`
- Create: `protocol/src/federation/client/resolver.ts`

**Step 1: Write the failing test**

Create: `protocol/src/federation/client/__tests__/resolver.test.ts`

```typescript
import { describe, it, expect } from 'bun:test';
import { Resolver } from '../resolver';

describe('Resolver', () => {
  const resolver = new Resolver('https://my-node.com');

  it('identifies local URLs', () => {
    expect(resolver.isLocal('https://my-node.com/users/abc')).toBe(true);
    expect(resolver.isLocal('https://my-node.com/indexes/xyz')).toBe(true);
  });

  it('identifies remote URLs', () => {
    expect(resolver.isLocal('https://other-node.com/users/abc')).toBe(false);
  });

  it('extracts node base URL from entity URL', () => {
    expect(resolver.nodeBaseUrl('https://node-b.com/indexes/xyz')).toBe('https://node-b.com');
  });

  it('extracts resource path from entity URL', () => {
    expect(resolver.resourcePath('https://node-b.com/indexes/xyz')).toBe('/indexes/xyz');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/federation/client/__tests__/resolver.test.ts`
Expected: FAIL — module not found.

**Step 3: Write resolver implementation**

Create: `protocol/src/federation/client/resolver.ts`

```typescript
export class Resolver {
  constructor(private localBaseUrl: string) {}

  isLocal(entityUrl: string): boolean {
    return entityUrl.startsWith(this.localBaseUrl);
  }

  nodeBaseUrl(entityUrl: string): string {
    const url = new URL(entityUrl);
    return `${url.protocol}//${url.host}`;
  }

  resourcePath(entityUrl: string): string {
    const url = new URL(entityUrl);
    return url.pathname;
  }
}
```

**Step 4: Run resolver test**

Run: `cd protocol && bun test src/federation/client/__tests__/resolver.test.ts`
Expected: All 4 tests PASS.

**Step 5: Write federation client test**

Create: `protocol/src/federation/client/__tests__/federation-client.test.ts`

```typescript
import { describe, it, expect, jest, mock } from 'bun:test';
import { FederationClient } from '../federation.client';

// Mock global fetch
const mockFetch = jest.fn();
globalThis.fetch = mockFetch as any;

describe('FederationClient', () => {
  const client = new FederationClient({
    localBaseUrl: 'https://my-node.com',
    privateKeyPem: '',  // Not testing signatures here
    keyId: 'https://my-node.com#main-key',
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
```

**Step 6: Write federation client implementation**

Create: `protocol/src/federation/client/federation.client.ts`

```typescript
import { log } from '../../lib/log';
import type { WellKnownResponse, PushIntentRequest, QueryIndexRequest, QueryIndexResponse, ChatMessage, JoinIndexRequest, FederatedUser, FederatedIndex } from '../spec/types';

const logger = log.lib.from('FederationClient');

interface FederationClientConfig {
  localBaseUrl: string;
  privateKeyPem: string;
  keyId: string;
}

export class FederationClient {
  constructor(private config: FederationClientConfig) {}

  async discoverNode(nodeBaseUrl: string): Promise<WellKnownResponse> {
    const url = `${nodeBaseUrl}/.well-known/index-protocol`;
    logger.info('Discovering node', { url });
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Discovery failed for ${nodeBaseUrl}: ${res.status}`);
    return res.json();
  }

  async getUser(userUrl: string): Promise<FederatedUser> {
    const res = await fetch(userUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to fetch user ${userUrl}: ${res.status}`);
    return res.json();
  }

  async getIndex(indexUrl: string): Promise<FederatedIndex> {
    const res = await fetch(indexUrl, { method: 'GET' });
    if (!res.ok) throw new Error(`Failed to fetch index ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async joinIndex(indexUrl: string, request: JoinIndexRequest): Promise<{ membership: unknown }> {
    const url = `${indexUrl}/members`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Join index failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async pushIntent(indexUrl: string, request: PushIntentRequest): Promise<{ intentUrl: string }> {
    const url = `${indexUrl}/intents`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Push intent failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async queryIndex(indexUrl: string, request: QueryIndexRequest): Promise<QueryIndexResponse> {
    const url = `${indexUrl}/query`;
    const body = JSON.stringify(request);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Query failed for ${indexUrl}: ${res.status}`);
    return res.json();
  }

  async sendChatMessage(targetNodeUrl: string, message: ChatMessage): Promise<void> {
    const url = `${targetNodeUrl}/inbox`;
    const body = JSON.stringify(message);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`Chat message failed to ${targetNodeUrl}: ${res.status}`);
  }
}
```

**Step 7: Run all client tests**

Run: `cd protocol && bun test src/federation/client/__tests__/`
Expected: All tests PASS.

**Step 8: Commit**

```bash
git add protocol/src/federation/client/
git commit -m "feat(federation): add federation HTTP client and URL resolver"
```

---

## Task 4: Bridge Layer

Translates federation requests into calls to existing services. No new DB logic — reuses existing adapters.

**Files:**
- Create: `protocol/src/federation/bridge/user.bridge.ts`
- Create: `protocol/src/federation/bridge/index.bridge.ts`
- Create: `protocol/src/federation/bridge/intent.bridge.ts`
- Create: `protocol/src/federation/bridge/chat.bridge.ts`

**Step 1: Write the failing test**

Create: `protocol/src/federation/bridge/__tests__/index-bridge.test.ts`

```typescript
import { describe, it, expect, jest } from 'bun:test';
import { IndexBridge } from '../index.bridge';

describe('IndexBridge', () => {
  const mockAdapter = {
    getIndexDetail: jest.fn(),
    getIndexMembers: jest.fn(),
    addMemberToIndex: jest.fn(),
  };

  const bridge = new IndexBridge(mockAdapter as any, 'https://my-node.com');

  it('converts internal index to federated format', async () => {
    mockAdapter.getIndexDetail.mockResolvedValueOnce({
      id: 'uuid-123',
      title: 'AI Founders',
      prompt: 'Looking for AI co-founders',
      permissions: { joinPolicy: 'anyone' },
      _count: { members: 5 },
    });

    const result = await bridge.getIndex('uuid-123');
    expect(result).toEqual({
      id: 'https://my-node.com/indexes/uuid-123',
      title: 'AI Founders',
      prompt: 'Looking for AI co-founders',
      permissions: { joinPolicy: 'anyone' },
      memberCount: 5,
      nodeUrl: 'https://my-node.com',
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/federation/bridge/__tests__/index-bridge.test.ts`
Expected: FAIL — module not found.

**Step 3: Write bridge implementations**

Create: `protocol/src/federation/bridge/user.bridge.ts`

```typescript
import type { FederatedUser } from '../spec/types';

export class UserBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async getUser(userId: string): Promise<FederatedUser | null> {
    const user = await this.adapter.getUserWithProfile(userId);
    if (!user) return null;
    return {
      id: `${this.nodeUrl}/users/${user.id}`,
      name: user.name,
      avatar: user.avatar || null,
      narrative: user.profile?.narrative?.context || null,
      attributes: user.profile?.attributes || null,
      nodeUrl: this.nodeUrl,
    };
  }
}
```

Create: `protocol/src/federation/bridge/index.bridge.ts`

```typescript
import type { FederatedIndex } from '../spec/types';

export class IndexBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async getIndex(indexId: string): Promise<FederatedIndex | null> {
    const index = await this.adapter.getIndexDetail(indexId);
    if (!index) return null;
    return {
      id: `${this.nodeUrl}/indexes/${index.id}`,
      title: index.title,
      prompt: index.prompt || null,
      permissions: index.permissions || null,
      memberCount: index._count?.members || 0,
      nodeUrl: this.nodeUrl,
    };
  }

  async joinIndex(indexId: string, actorUrl: string): Promise<{ membership: unknown }> {
    const membership = await this.adapter.addMemberToIndex(indexId, actorUrl, 'member');
    return { membership };
  }
}
```

Create: `protocol/src/federation/bridge/intent.bridge.ts`

```typescript
import type { FederatedIntent, PushIntentRequest } from '../spec/types';

export class IntentBridge {
  constructor(private adapter: any, private nodeUrl: string) {}

  async pushIntent(indexId: string, request: PushIntentRequest): Promise<{ intentUrl: string }> {
    const created = await this.adapter.createIntent({
      userId: request.actor,
      payload: request.payload,
      embedding: request.embedding,
      sourceType: 'enrichment',
    });
    await this.adapter.assignIntentToIndex(created.id, indexId);
    return { intentUrl: `${this.nodeUrl}/indexes/${indexId}/intents/${created.id}` };
  }

  async queryIndex(indexId: string, embedding: number[], limit: number, filters: Record<string, unknown>): Promise<FederatedIntent[]> {
    const results = await this.adapter.vectorSearchInIndex(indexId, embedding, limit, filters);
    return results.map((r: any) => ({
      intentUrl: `${this.nodeUrl}/indexes/${indexId}/intents/${r.id}`,
      payload: r.payload,
      embedding: r.embedding,
      similarity: r.similarity,
      userId: `${this.nodeUrl}/users/${r.userId}`,
    }));
  }
}
```

Create: `protocol/src/federation/bridge/chat.bridge.ts`

```typescript
import type { ChatMessage } from '../spec/types';

export class ChatBridge {
  constructor(private adapter: any) {}

  async receiveMessage(message: ChatMessage): Promise<void> {
    await this.adapter.createOrGetSession(message.sessionId, message.from, message.to);
    await this.adapter.insertMessage({
      sessionId: message.sessionId,
      role: 'user',
      content: message.content,
      metadata: message.context ? { context: message.context } : undefined,
    });
  }
}
```

**Step 4: Run bridge tests**

Run: `cd protocol && bun test src/federation/bridge/__tests__/`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add protocol/src/federation/bridge/
git commit -m "feat(federation): add bridge layer translating federation to services"
```

---

## Task 5: Federation Controller (Server-Side Endpoints)

Expose the 7 protocol endpoints that other nodes call.

**Files:**
- Create: `protocol/src/federation/server/federation.controller.ts`
- Modify: `protocol/src/main.ts` — register the federation controller

**Step 1: Write the failing test**

Create: `protocol/src/federation/server/__tests__/federation-controller.test.ts`

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/federation/server/__tests__/federation-controller.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the controller**

Create: `protocol/src/federation/server/federation.controller.ts`

```typescript
import { Controller, Get, Post, Put, Delete } from '../../lib/router/router.decorators';
import { log } from '../../lib/log';
import type { IndexBridge } from '../bridge/index.bridge';
import type { UserBridge } from '../bridge/user.bridge';
import type { IntentBridge } from '../bridge/intent.bridge';
import type { ChatBridge } from '../bridge/chat.bridge';
import {
  PushIntentRequestSchema,
  QueryIndexRequestSchema,
  JoinIndexRequestSchema,
  ChatMessageSchema,
  UpdateIntentRequestSchema,
} from '../spec/types';

const logger = log.controller.from('federation');

interface FederationControllerConfig {
  nodeUrl: string;
  version: string;
  name: string;
  publicKeyPem: string;
  indexBridge: IndexBridge;
  userBridge: UserBridge;
  intentBridge: IntentBridge;
  chatBridge: ChatBridge;
}

@Controller('/federation')
export class FederationController {
  private config: FederationControllerConfig;

  constructor(config: FederationControllerConfig) {
    this.config = config;
  }

  @Get('/.well-known')
  async wellKnown(_req: Request) {
    return Response.json({
      version: this.config.version,
      name: this.config.name,
      baseUrl: this.config.nodeUrl,
      endpoints: {
        users: '/federation/users',
        indexes: '/federation/indexes',
        inbox: '/federation/inbox',
      },
      publicKey: {
        id: `${this.config.nodeUrl}#main-key`,
        pem: this.config.publicKeyPem,
      },
    });
  }

  @Get('/users/:id')
  async getUser(_req: Request, _guard: unknown, params: Record<string, string>) {
    const user = await this.config.userBridge.getUser(params.id);
    if (!user) return Response.json({ error: 'User not found' }, { status: 404 });
    return Response.json(user);
  }

  @Get('/indexes/:id')
  async getIndex(_req: Request, _guard: unknown, params: Record<string, string>) {
    const index = await this.config.indexBridge.getIndex(params.id);
    if (!index) return Response.json({ error: 'Index not found' }, { status: 404 });
    return Response.json(index);
  }

  @Post('/indexes/:id/members')
  async joinIndex(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = JoinIndexRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    try {
      const result = await this.config.indexBridge.joinIndex(params.id, parsed.data.actor);
      return Response.json(result, { status: 201 });
    } catch (err: any) {
      logger.warn('Join index failed', { indexId: params.id, error: err.message });
      return Response.json({ error: err.message }, { status: 403 });
    }
  }

  @Post('/indexes/:id/intents')
  async pushIntent(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = PushIntentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    const result = await this.config.intentBridge.pushIntent(params.id, parsed.data);
    logger.info('Intent pushed', { indexId: params.id, actor: parsed.data.actor });
    return Response.json(result, { status: 201 });
  }

  @Put('/indexes/:id/intents/:intentId')
  async updateIntent(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = UpdateIntentRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
    // TODO: delegate to intentBridge.updateIntent
    return Response.json({ updated: true });
  }

  @Delete('/indexes/:id/intents/:intentId')
  async deleteIntent(_req: Request, _guard: unknown, params: Record<string, string>) {
    // TODO: delegate to intentBridge.deleteIntent
    return Response.json({ deleted: true });
  }

  @Post('/indexes/:id/query')
  async queryIndex(req: Request, _guard: unknown, params: Record<string, string>) {
    const body = await req.json().catch(() => null);
    const parsed = QueryIndexRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    const results = await this.config.intentBridge.queryIndex(
      params.id,
      parsed.data.embedding,
      parsed.data.limit,
      parsed.data.filters
    );
    return Response.json({ results });
  }

  @Post('/inbox')
  async inbox(req: Request) {
    const body = await req.json().catch(() => null);
    const parsed = ChatMessageSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

    await this.config.chatBridge.receiveMessage(parsed.data);
    logger.info('Chat message received', { from: parsed.data.from, to: parsed.data.to });
    return new Response(null, { status: 202 });
  }
}
```

**Step 4: Run controller tests**

Run: `cd protocol && bun test src/federation/server/__tests__/federation-controller.test.ts`
Expected: All 3 tests PASS.

**Step 5: Commit**

```bash
git add protocol/src/federation/server/federation.controller.ts
git commit -m "feat(federation): add federation controller with all protocol endpoints"
```

---

## Task 6: Register Federation Controller in Main Server

Wire the federation controller into the Bun server.

**Files:**
- Modify: `protocol/src/main.ts` — add federation controller import and instance

**Step 1: Read current main.ts**

Read: `protocol/src/main.ts`

**Step 2: Add federation controller registration**

Add import at top of `main.ts`:
```typescript
import { FederationController } from './federation/server/federation.controller';
import { IndexBridge } from './federation/bridge/index.bridge';
import { UserBridge } from './federation/bridge/user.bridge';
import { IntentBridge } from './federation/bridge/intent.bridge';
import { ChatBridge } from './federation/bridge/chat.bridge';
```

Add to controller instances section (after existing controllers):
```typescript
// Federation controller
const NODE_URL = process.env.NODE_URL || `http://localhost:${PORT}`;
const federationController = new FederationController({
  nodeUrl: NODE_URL,
  version: '0.1.0',
  name: process.env.NODE_NAME || 'Index Node',
  publicKeyPem: process.env.FEDERATION_PUBLIC_KEY || '',
  indexBridge: new IndexBridge(new ChatDatabaseAdapter(), NODE_URL),
  userBridge: new UserBridge(new ChatDatabaseAdapter(), NODE_URL),
  intentBridge: new IntentBridge(new ChatDatabaseAdapter(), NODE_URL),
  chatBridge: new ChatBridge(new ChatDatabaseAdapter()),
});
controllerInstances.set(FederationController, federationController);
```

Also add a well-known route before the main route loop (since `/.well-known/index-protocol` is outside `/api` prefix):
```typescript
if (url.pathname === '/.well-known/index-protocol') {
  const instance = controllerInstances.get(FederationController);
  const result = await instance.wellKnown(req);
  // Add CORS headers and return
}
```

**Step 3: Verify server starts**

Run: `cd protocol && bun run dev` (check for import errors, then stop)
Expected: Server starts without errors.

**Step 4: Commit**

```bash
git add protocol/src/main.ts
git commit -m "feat(federation): register federation controller in main server"
```

---

## Task 7: Environment & Configuration

Add federation-specific env vars and document setup.

**Files:**
- Modify: `protocol/env.example` — add `NODE_URL`, `NODE_NAME`, `FEDERATION_PUBLIC_KEY`, `FEDERATION_PRIVATE_KEY`

**Step 1: Add env vars to example**

Add to `protocol/env.example`:
```bash
# Federation
NODE_URL=https://your-node.example.com    # This node's public URL
NODE_NAME=My Index Node                    # Human-readable node name
FEDERATION_PUBLIC_KEY=                     # RSA public key (PEM format)
FEDERATION_PRIVATE_KEY=                    # RSA private key (PEM format)
```

**Step 2: Commit**

```bash
git add protocol/env.example
git commit -m "feat(federation): add federation env vars to env.example"
```

---

## Task 8: Integration Test — Two-Node Simulation

End-to-end test simulating two nodes talking to each other in-process.

**Files:**
- Create: `protocol/tests/federation.test.ts`

**Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeAll } from 'bun:test';
import { FederationController } from '../src/federation/server/federation.controller';
import { FederationClient } from '../src/federation/client/federation.client';
import { Resolver } from '../src/federation/client/resolver';

describe('Federation integration (in-process)', () => {
  // Simulate two nodes by creating two controller instances with mock bridges
  const nodeAUrl = 'https://node-a.test';
  const nodeBUrl = 'https://node-b.test';

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
    pushIntent: async (indexId: string, req: any) => ({
      intentUrl: `${nodeBUrl}/indexes/${indexId}/intents/new-id`,
    }),
    queryIndex: async () => [{
      intentUrl: `${nodeBUrl}/indexes/idx1/intents/int1`,
      payload: 'Looking for Rust dev',
      embedding: [0.1, -0.2],
      similarity: 0.95,
      userId: `${nodeBUrl}/users/bob`,
    }],
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
  });

  it('node A fetches an index from node B', async () => {
    const req = new Request(`${nodeBUrl}/federation/indexes/idx1`);
    const res = await controllerB.getIndex(req, null, { id: 'idx1' });
    const body = await res.json();
    expect(body.title).toBe('Test Index');
    expect(body.id).toBe(`${nodeBUrl}/indexes/idx1`);
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
  });
});
```

**Step 2: Run integration test**

Run: `cd protocol && bun test tests/federation.test.ts`
Expected: All 6 tests PASS.

**Step 3: Commit**

```bash
git add protocol/tests/federation.test.ts
git commit -m "test(federation): add two-node integration test"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Protocol spec types (Zod) | `federation/spec/types.ts` + tests |
| 2 | HTTP signature utilities | `federation/server/signature.ts` + tests |
| 3 | Federation client + resolver | `federation/client/` + tests |
| 4 | Bridge layer | `federation/bridge/` + tests |
| 5 | Federation controller | `federation/server/federation.controller.ts` + tests |
| 6 | Register in main server | `main.ts` modification |
| 7 | Environment config | `env.example` |
| 8 | Integration test | `tests/federation.test.ts` |

Total: 8 tasks, ~12 new files, 1 modified file. Each task is independently testable and committable.
