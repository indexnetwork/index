---
date: 2026-06-23T23:32:59+0300
author: Yanek Yuk
commit: 4150d08484
branch: dev
repository: index
topic: mcp-oom-hardening
tags: [backend, mcp, railway, rate-limiting, performance]
status: ready
parent: null
phase_count: 4
phases:
  - { n: 1, title: MCP lifecycle cleanup }
  - { n: 2, title: Cheap /mcp HTTP limiter }
  - { n: 3, title: Static MCP metadata cache }
  - { n: 4, title: Verification and docs polish }
unresolved_phase_count: 0
last_updated: 2026-06-23T23:32:59+0300
last_updated_by: Yanek Yuk
---

# MCP OOM Hardening Implementation Plan

## Overview

The Railway `protocol` service is running out of memory because high-churn `/mcp` traffic repeatedly allocates a full MCP server, transport, tool registry, and schema conversion path. This plan preserves the per-request isolation added for MCP response-routing safety, but hardens the hot path by closing both SDK lifecycle objects, adding a cheap HTTP-level `/mcp` limiter before server allocation, and caching static MCP tool metadata/schema conversion.

## Requirements

- Stop recurring Railway OOM restarts for the `protocol` service under `/mcp` traffic.
- Preserve MCP compatibility for Claude Code, Cursor, Hermes, AgentVillage, and API-key clients.
- Preserve per-request MCP server/transport isolation; do not reintroduce cross-client JSON-RPC response routing risk.
- Add a cheap guardrail before expensive MCP allocation for high-churn clients.
- Avoid raw API-key limiter buckets; follow existing verified-JWT-or-IP pre-auth limiter rules.
- Keep all limiter behavior configurable through environment variables and safe under Redis/storage failures.

## Current State Analysis

`/mcp` is dispatched directly in `services/api/src/main.ts` before the decorated controller router, so normal `RateLimit(...)` guards do not apply. `mcpHandler` then drains request bodies, creates a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport`, connects them, handles the request, and only closes the transport. The protocol factory builds a full tool registry and converts every tool schema on each server creation, then builds a second full request-scoped registry inside each tool call.

### Key Discoveries

- `services/api/src/main.ts:480-482` dispatches `/mcp` directly to `mcpHandler(req, corsHeaders)` before controller guards.
- `services/api/src/controllers/mcp.controller.ts:682-688` creates a fresh MCP server and transport per HTTP request.
- `services/api/src/controllers/mcp.controller.ts:857-859` closes only the transport today.
- `node_modules/@modelcontextprotocol/server/dist/index.d.mts:535` exposes `McpServer.close(): Promise<void>`.
- `packages/protocol/src/mcp/mcp.server.ts:464-470` creates a full registry and converts Zod schemas to MCP schemas per server creation.
- `packages/protocol/src/mcp/mcp.server.ts:608-617` rebuilds the registry with request-scoped DB deps for actual tool execution; this must remain scoped because tool handlers capture deps.
- `services/api/src/lib/limiter/identifier.ts:92-120` resolves limiter identity as verified JWT user or IP; raw API keys fall through to IP.
- `services/api/src/guards/limiter.guard.ts:99-104` fails open on limiter storage errors.
- `services/api/src/lib/limiter/mcp.ts:60-88` already implements per-principal/per-tool MCP throttling, but only after MCP transport/server setup and auth resolution.

## Desired End State

```ts
// /mcp request flow from mcpHandler:
const contentLengthCheck = enforceMcpContentLength(req, maxRequestBytes, corsHeaders);
if (contentLengthCheck) return contentLengthCheck;

const rateLimitResponse = await enforceMcpHttpRateLimit(req, corsHeaders);
if (rateLimitResponse) return rateLimitResponse;

// Only now do we drain body and allocate SDK server/transport.
const { server, transport } = await createPerRequestTransport();
try {
  return await transport.handleRequest(req);
} finally {
  await Promise.allSettled([transport.close(), server.close()]);
}
```

```ts
// Protocol server registration uses static cached metadata, not repeated schema conversion.
for (const meta of getCachedMcpToolMetadata(deps)) {
  server.registerTool(meta.name, {
    description: meta.description,
    inputSchema: meta.inputSchema,
  }, handlerFor(meta));
}
```

## What We're NOT Doing

- Not pooling or reusing `McpServer` instances across HTTP requests.
- Not pooling or reusing `WebStandardStreamableHTTPServerTransport` instances.
- Not hand-writing cached JSON-RPC responses for `initialize`, `tools/list`, or other MCP methods.
- Not changing database schema or persisted MCP/API-key data.
- Not changing MCP auth/scoping semantics.
- Not removing the existing per-tool MCP limiter; the HTTP limiter is an additional guardrail.

## Decisions

### Preserve per-request MCP server/transport isolation

Ambiguity: the user asked why we cannot “just cache and send” the same result. Some MCP metadata is static, but the SDK owns JSON-RPC envelopes, client capabilities, request IDs, and response routing.

Explored:
- Option A: preserve per-request server/transport isolation while caching static metadata. Evidence: `services/api/src/controllers/mcp.controller.ts:673-680` documents response-routing risk; SDK transport keeps request/stream maps by JSON-RPC id. Pro: safest compatibility profile. Con: still allocates one SDK server per request.
- Option B: pool/reuse server instances or hand-return cached MCP responses. Pro: lower allocation. Con: high risk of cross-client state, elicitation capability bleed, and protocol envelope drift.

Decision: preserve per-request isolation and cache only static metadata/schema conversion. The developer explicitly prioritized not breaking MCP clients.

### Close both SDK lifecycle objects

Simple decision: `mcpHandler` currently closes only the transport, but the SDK exposes `McpServer.close()`. The plan closes both transport and server in the request `finally` path, with failures swallowed like the existing transport close.

### Add a cheap HTTP-level `/mcp` limiter

Ambiguity: whether rate limiting belongs here. It does, as a guardrail before expensive allocation, but it is not the sole fix.

Explored:
- Option A: no HTTP limiter. Pro: zero risk of 429s. Con: high-churn clients still allocate MCP server/registry before any tool-level throttle.
- Option B: HTTP limiter using verified JWT/IP buckets. Evidence: `services/api/src/lib/limiter/identifier.ts:92-120`; `services/api/src/guards/limiter.guard.ts:99-104`. Pro: consistent with existing pre-auth limiter security. Con: distributed traffic may still pass.
- Option C: raw API-key bucket. Pro: more precise for API-key clients. Con: violates precedent because raw credentials can be rotated and should not become pre-auth bucket keys.

Decision: add an HTTP-level `/mcp` limiter using verified JWT user or IP only, fail open on storage errors, and default to `MCP_HTTP_LIMIT_PER_MIN=240` when unset.

### Cache metadata, not request-scoped handlers

Simple decision: cache tool names, descriptions, Zod schemas, JSON schemas, and MCP input schemas keyed by registry-shaping feature flags. Keep request-scoped handler binding at tool execution time because handlers capture `userDb`/`systemDb` deps.

## Phase 1: MCP lifecycle cleanup

### Overview

Closes the MCP SDK server as well as the transport for each request. Depends on nothing; must land before broader allocation changes.

### Changes Required:

#### 1. services/api/src/controllers/mcp.controller.ts:666-860

**File**: `services/api/src/controllers/mcp.controller.ts`
**Changes**: MODIFY — return both server and transport from the per-request factory and close both in `finally`.

```ts
type PerRequestMcpConnection = {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
};

async function closePerRequestMcpConnection(
  connection: Partial<PerRequestMcpConnection> | undefined,
): Promise<void> {
  if (!connection) return;

  const closeOps: Promise<void>[] = [];
  if (connection.transport) {
    closeOps.push(connection.transport.close());
  }
  if (connection.server) {
    closeOps.push(connection.server.close());
  }

  if (closeOps.length === 0) return;
  await Promise.allSettled(closeOps);
}

async function createPerRequestTransport(): Promise<PerRequestMcpConnection> {
  const server = createMcpServerInstance();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return { server, transport };
  } catch (err) {
    await closePerRequestMcpConnection({ server, transport });
    throw err;
  }
}
```

```ts
  let connection: PerRequestMcpConnection | undefined;
  try {
    connection = await createPerRequestTransport();
    const response = await connection.transport.handleRequest(req);

    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  } catch (err) {
    // Existing catch body remains unchanged.
  } finally {
    // Close both SDK lifecycle objects to release accumulated routing/callback state.
    await closePerRequestMcpConnection(connection);
  }
```

### Success Criteria:

#### Automated Verification:
- [ ] Type checking covers the lifecycle signature change: `cd services/api && bun run lint`
- [ ] The old transport-only variable shape is gone: `! rg "let transport: WebStandardStreamableHTTPServerTransport" services/api/src/controllers/mcp.controller.ts`
- [ ] Per-request server close is present: `rg "server\\.close\\(\\)" services/api/src/controllers/mcp.controller.ts` returns at least one match

#### Manual Verification:
- [ ] Confirm the per-request isolation comment still states that server/transport are fresh per request and no pooling/reuse was introduced.
- [ ] Confirm the error path closes partially-created SDK objects if `server.connect(transport)` fails.

## Phase 2: Cheap /mcp HTTP limiter

### Overview

Adds a cheap `/mcp` HTTP request limiter before body draining and MCP server allocation. Depends on Phase 1.

### Changes Required:

#### 1. services/api/src/lib/limiter/config.ts

**File**: `services/api/src/lib/limiter/config.ts`
**Changes**: MODIFY — add an MCP HTTP limiter class and env-backed fallback.

```ts
export type LimiterClass = 'auth_write' | 'read' | 'write' | 'mcp_http';
```

```ts
const CLASS_ENV: Record<LimiterClass, { envVar: string; fallback: number }> = {
  auth_write: { envVar: 'LIMITER_AUTH_WRITE_PER_MIN', fallback: 100 },
  read:       { envVar: 'LIMITER_READ_PER_MIN',       fallback: 1200 },
  write:      { envVar: 'LIMITER_WRITE_PER_MIN',      fallback: 600 },
  mcp_http:   { envVar: 'MCP_HTTP_LIMIT_PER_MIN',     fallback: 240 },
};
```

```ts
export const CLASS_CONFIG: Record<LimiterClass, ClassConfig> = {
  auth_write: resolveClassConfig('auth_write'),
  read:       resolveClassConfig('read'),
  write:      resolveClassConfig('write'),
  mcp_http:   resolveClassConfig('mcp_http'),
};
```

#### 2. services/api/src/lib/limiter/mcp.ts

**File**: `services/api/src/lib/limiter/mcp.ts`
**Changes**: MODIFY — add HTTP-level MCP limiter config and check helper while preserving existing per-tool limiter.

```ts
import { getStorage, resolveClassConfig } from './index';
import { intEnv, isLimiterDisabled } from './config';
import { resolveIdentifier, sha256Truncated } from './identifier';
import type { LimiterStorage } from './storage';
import { log } from '../log';
```

```ts
export interface McpHttpThrottleDecision {
  allowed: boolean;
  retryAfterSec?: number;
  limit?: number;
  remaining?: number;
  resetAt?: number;
}

const PRIVATE_IPV4 = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^127\./,
  /^169\.254\./,
];

const isPrivateOrLoopbackIp = (ip: string): boolean => {
  if (ip === 'unknown' || ip === '::1') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(lower)) return true;
  return PRIVATE_IPV4.some((re) => re.test(ip));
};
```

```ts
/**
 * Cheap HTTP-level throttle for the `/mcp` endpoint.
 *
 * Runs before MCP server/transport allocation. It intentionally buckets only by
 * verified JWT user or client IP (same pre-auth posture as RateLimit) so raw
 * API keys cannot be rotated to create fresh buckets.
 */
export async function checkMcpHttpRateLimit(
  req: Request,
  storage?: LimiterStorage,
): Promise<McpHttpThrottleDecision> {
  if (isLimiterDisabled()) return { allowed: true };

  try {
    const id = await resolveIdentifier(req);
    if (id.kind === 'ip' && isPrivateOrLoopbackIp(id.value)) {
      return { allowed: true };
    }

    const { perMinute, windowSec } = resolveClassConfig('mcp_http');
    const bucketValue = id.kind === 'user' ? await sha256Truncated(id.value) : id.value;
    const store = storage ?? (await getStorage());
    const hit = await store.hit(`mcp:http:${id.kind}:${bucketValue}`, windowSec, perMinute);
    const remaining = Math.max(0, hit.limit - hit.count);

    if (!hit.allowed) {
      return {
        allowed: false,
        retryAfterSec: retryAfter(hit.resetAt),
        limit: hit.limit,
        remaining,
        resetAt: hit.resetAt,
      };
    }

    return {
      allowed: true,
      limit: hit.limit,
      remaining,
      resetAt: hit.resetAt,
    };
  } catch (err) {
    logger.error('MCP HTTP limiter storage/identity error — failing open', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { allowed: true };
  }
}
```

#### 3. services/api/src/controllers/mcp.controller.ts:24,696-789

**File**: `services/api/src/controllers/mcp.controller.ts`
**Changes**: MODIFY — split content-length precheck from body draining and invoke the HTTP limiter before MCP allocation.

```ts
import { checkMcpRateLimit, checkMcpHttpRateLimit } from '../lib/limiter/mcp';
import type { McpHttpThrottleDecision } from '../lib/limiter/mcp';
```

```ts
function rejectMcpContentLengthTooLarge(
  req: Request,
  maxRequestBytes: number,
  corsHeaders: Record<string, string>,
): Response | null {
  const contentLength = req.headers.get('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > maxRequestBytes) {
    return requestTooLargeResponse(maxRequestBytes, corsHeaders);
  }
  return null;
}

function mcpHttpRateLimitResponse(
  decision: McpHttpThrottleDecision,
  corsHeaders: Record<string, string>,
): Response {
  const retryAfterSeconds = decision.retryAfterSec ?? 60;
  return new Response(
    JSON.stringify({
      error: 'Too Many Requests',
      code: 'RATE_LIMITED',
      class: 'mcp_http',
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...(decision.limit !== undefined ? { 'ratelimit-limit': String(decision.limit) } : {}),
        'ratelimit-remaining': String(decision.remaining ?? 0),
        'ratelimit-reset': String(retryAfterSeconds),
        'retry-after': String(retryAfterSeconds),
        ...corsHeaders,
      },
    },
  );
}
```

```ts
async function enforceMcpRequestSize(
  req: Request,
  maxRequestBytes: number,
  corsHeaders: Record<string, string>,
): Promise<Request | Response> {
  if (!req.body) return req;

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxRequestBytes) {
      await reader.cancel().catch(() => undefined);
      return requestTooLargeResponse(maxRequestBytes, corsHeaders);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
    signal: req.signal,
  });
}
```

```ts
  const maxRequestBytes = getMcpMaxRequestBytes();
  const contentLengthResponse = rejectMcpContentLengthTooLarge(req, maxRequestBytes, corsHeaders);
  if (contentLengthResponse) return contentLengthResponse;

  const httpLimitDecision = await checkMcpHttpRateLimit(req);
  if (!httpLimitDecision.allowed) {
    return mcpHttpRateLimitResponse(httpLimitDecision, corsHeaders);
  }

  // Reject unauthenticated requests at the HTTP level before they reach the MCP transport.
  // The transport catches errors and wraps them as HTTP 200 isError responses, which means
  // Claude Code never sees a 401 and never triggers OAuth. By checking here, we return a
  // proper HTTP 401 + WWW-Authenticate so Claude Code can initiate the OAuth flow.
  const hasAuth = req.headers.has('Authorization') || req.headers.has('x-api-key');
  if (!hasAuth) {
    return new Response(
      JSON.stringify({ error: 'Authentication required: provide Bearer token or x-api-key header' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer resource_metadata="${BASE_URL}/.well-known/oauth-protected-resource"`,
          ...corsHeaders,
        },
      },
    );
  }

  const sizeCheckedRequest = await enforceMcpRequestSize(req, maxRequestBytes, corsHeaders);
  if (sizeCheckedRequest instanceof Response) return sizeCheckedRequest;
  req = sizeCheckedRequest;
```

#### 4. services/api/src/startup.env.ts

**File**: `services/api/src/startup.env.ts`
**Changes**: MODIFY — validate the new optional MCP HTTP limiter env var.

```ts
  // 10. Rate limiting
  LIMITER_AUTH_WRITE_PER_MIN: optionalInt,
  LIMITER_READ_PER_MIN: optionalInt,
  LIMITER_WRITE_PER_MIN: optionalInt,
  MCP_HTTP_LIMIT_PER_MIN: optionalInt,
  LIMITER_IP_HEADERS: z.string().optional(),
  LIMITER_DISABLE: optionalOne,
```

#### 5. services/api/.env.example

**File**: `services/api/.env.example`
**Changes**: MODIFY — document the new MCP HTTP limiter env var near existing rate limiter/MCP settings.

```env
# HTTP-level /mcp request budget. Runs before MCP server/transport allocation.
# Uses the same verified-JWT-or-IP identity model as the route limiter.
MCP_HTTP_LIMIT_PER_MIN=240
```

#### 6. services/api/src/lib/limiter/tests/mcp.spec.ts

**File**: `services/api/src/lib/limiter/tests/mcp.spec.ts`
**Changes**: MODIFY — add unit coverage for the HTTP-level limiter helper.

```ts
import { checkMcpHttpRateLimit, checkMcpRateLimit } from '../mcp';
```

```ts
    process.env.MCP_HTTP_LIMIT_PER_MIN = '3';
    process.env.RAILWAY_ENVIRONMENT = 'test';
```

```ts
  const req = (ip: string, headers: Record<string, string> = {}): Request =>
    new Request('https://protocol.index.network/mcp', {
      headers: { 'x-forwarded-for': ip, ...headers },
    });

  test('HTTP limiter allows up to the MCP HTTP limit, then blocks', async () => {
    const ip = '203.0.113.80';
    for (let i = 0; i < 3; i++) {
      const d = await checkMcpHttpRateLimit(req(ip), s);
      expect(d.allowed).toBe(true);
      expect(d.limit).toBe(3);
    }

    const blocked = await checkMcpHttpRateLimit(req(ip), s);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(3);
    expect(blocked.remaining).toBe(0);
  });

  test('HTTP limiter buckets raw API-key requests by IP, not key value', async () => {
    process.env.MCP_HTTP_LIMIT_PER_MIN = '2';
    const ip = '203.0.113.81';

    expect((await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-one' }), s)).allowed).toBe(true);
    expect((await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-two' }), s)).allowed).toBe(true);

    const blocked = await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-three' }), s);
    expect(blocked.allowed).toBe(false);
  });

  test('HTTP limiter bypasses private/local IPs for local development', async () => {
    process.env.MCP_HTTP_LIMIT_PER_MIN = '1';
    for (let i = 0; i < 5; i++) {
      const d = await checkMcpHttpRateLimit(req('10.0.0.1'), s);
      expect(d.allowed).toBe(true);
    }
  });

  test('HTTP limiter respects LIMITER_DISABLE escape hatch', async () => {
    process.env.LIMITER_DISABLE = '1';
    process.env.MCP_HTTP_LIMIT_PER_MIN = '1';
    const ip = '203.0.113.82';
    for (let i = 0; i < 5; i++) {
      const d = await checkMcpHttpRateLimit(req(ip), s);
      expect(d.allowed).toBe(true);
    }
    delete process.env.LIMITER_DISABLE;
  });

  test('HTTP limiter fails OPEN when storage throws', async () => {
    const throwing = {
      async hit() { throw new Error('redis down'); },
    } as unknown as MemoryStorage;

    const d = await checkMcpHttpRateLimit(req('203.0.113.83'), throwing);
    expect(d.allowed).toBe(true);
  });
```

### Success Criteria:

#### Automated Verification:
- [ ] MCP limiter unit tests pass: `cd services/api && bun test src/lib/limiter/tests/mcp.spec.ts`
- [ ] Startup env accepts the new variable: `rg "MCP_HTTP_LIMIT_PER_MIN" services/api/src/startup.env.ts services/api/.env.example services/api/src/lib/limiter/config.ts` returns matches in all three files
- [ ] MCP handler invokes HTTP limiter before per-request transport creation: `python3 - <<'PY'
from pathlib import Path
s=Path('services/api/src/controllers/mcp.controller.ts').read_text()
assert s.index('const httpLimitDecision = await checkMcpHttpRateLimit') < s.index('connection = await createPerRequestTransport')
PY`

#### Manual Verification:
- [ ] Confirm unauthenticated `/mcp` requests still return HTTP 401 with `WWW-Authenticate` when under the limiter threshold.
- [ ] Confirm chunked requests without `content-length` can be 429/401 before the body is drained.

## Phase 3: Static MCP metadata cache

### Overview

Caches static MCP tool registration metadata and schema conversion without changing per-request server/transport isolation. Depends on Phase 2.

### Changes Required:

#### 1. packages/protocol/src/mcp/mcp.server.ts

**File**: `packages/protocol/src/mcp/mcp.server.ts`
**Changes**: MODIFY — cache static registration metadata and use it for server registration; keep request-scoped registry creation for tool execution.

```ts
import type { ToolDeps, ResolvedToolContext, RawToolDefinition } from '../shared/agent/tool.helpers.js';
```

```ts
type McpToolRegistrationMetadata = Pick<RawToolDefinition, 'name' | 'description' | 'schema'> & {
  jsonSchema: JsonSchemaType;
  inputSchema: ReturnType<typeof fromJsonSchema>;
};

const AGENT_GATE_EXEMPT: ReadonlySet<string> = new Set(['register_agent', 'read_docs', 'scrape_url']);
const mcpToolMetadataCache = new Map<string, McpToolRegistrationMetadata[]>();

export function getMcpToolMetadataCacheKey(deps: Pick<ToolDeps,
  'contactsEnabled' | 'chatSession' | 'agentDatabase' | 'agentDispatcher' | 'questionerEnqueue'
>): string {
  return [
    `contacts:${deps.contactsEnabled === true ? '1' : '0'}`,
    `chat:${deps.chatSession ? '1' : '0'}`,
    `agent:${deps.agentDatabase ? '1' : '0'}`,
    `negotiation:${deps.agentDispatcher ? '1' : '0'}`,
    `questioner:${deps.questionerEnqueue ? '1' : '0'}`,
  ].join('|');
}

export function clearMcpToolMetadataCacheForTests(): void {
  mcpToolMetadataCache.clear();
}

export function getCachedMcpToolMetadata(deps: ToolDeps): readonly McpToolRegistrationMetadata[] {
  const cacheKey = getMcpToolMetadataCacheKey(deps);
  const cached = mcpToolMetadataCache.get(cacheKey);
  if (cached) return cached;

  const registry = createToolRegistry(deps);
  const metadata = Array.from(registry.values()).map((toolDef): McpToolRegistrationMetadata => {
    const jsonSchema = zodToJsonSchema(toolDef.schema) as JsonSchemaType;
    return {
      name: toolDef.name,
      description: toolDef.description,
      schema: toolDef.schema,
      jsonSchema,
      inputSchema: fromJsonSchema(jsonSchema),
    };
  });

  mcpToolMetadataCache.set(cacheKey, metadata);
  logger.verbose(`MCP tool metadata cached with ${metadata.length} tools`, { cacheKey });
  return metadata;
}
```

```ts
  const toolMetadata = getCachedMcpToolMetadata(deps);

  for (const toolDef of toolMetadata) {
    const toolName = toolDef.name;

    server.registerTool(
      toolName,
      {
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
      },
```

```ts
          // Build per-request scoped databases via injected factory.
          // Network-scoped agents are clamped to their bound network plus the user's
          // personal index — they cannot reach other networks even when the user is
          // a member of them. The personal-index reachability is preserved so the
          // agent can still manage its owner's profile and contacts.
          // context.indexScope is now the single source of truth: set by
          // resolveChatContext (full set) and narrowed by applyNetworkScopeToContext.
          const scopedDbs = scopedDepsFactory.create(userId, context.indexScope);

          // Override deps with per-request scoped databases
          const requestDeps: ToolDeps = { ...deps, ...scopedDbs };
          reportDeps = requestDeps;

          // Re-create registry with per-request deps for scoped database access.
          // Do not use cached registration metadata handlers here: tool handlers
          // close over userDb/systemDb when the registry is created.
          const requestRegistry = createToolRegistry(requestDeps);
          const requestTool = requestRegistry.get(toolName);
```

```ts
  logger.verbose(`MCP server created with ${toolMetadata.length} tools`);
  return server;
}
```

#### 2. services/api/tests/mcp.spec.ts

**File**: `services/api/tests/mcp.spec.ts`
**Changes**: MODIFY — preserve server factory compatibility and registry-shape behavior under the metadata cache.

```ts
import {
  clearMcpToolMetadataCacheForTests,
  createMcpServer,
  getCachedMcpToolMetadata,
} from '../../../packages/protocol/src/mcp/mcp.server';
```

```ts
  it('caches static MCP tool metadata by registry-shaping dependencies', () => {
    clearMcpToolMetadataCacheForTests();

    const first = getCachedMcpToolMetadata(mockDeps);
    const second = getCachedMcpToolMetadata(mockDeps);
    const registry = createToolRegistry(mockDeps);

    expect(second).toBe(first);
    expect(first.length).toBe(registry.size);
    expect(first.some((tool) => tool.name === 'list_agents')).toBe(true);
    expect(first.every((tool) => tool.schema && tool.jsonSchema && tool.inputSchema)).toBe(true);

    const withoutAgentTools = getCachedMcpToolMetadata(mockDepsWithoutAgentDb);
    expect(withoutAgentTools).not.toBe(first);
    expect(withoutAgentTools.some((tool) => tool.name === 'list_agents')).toBe(false);
  });
```

#### 3. packages/protocol/src/mcp/tests/mcp.server.spec.ts

**File**: `packages/protocol/src/mcp/tests/mcp.server.spec.ts`
**Changes**: MODIFY — add focused test coverage for cache-key dimensions.

```ts
import { MCP_INSTRUCTIONS, sanitizeMcpResult, buildMcpOnboardingMessage, ONBOARDING_ALLOWED, shouldReportMcpToolError, extractBearerToken, parseClientSurface, getMcpToolMetadataCacheKey } from "../mcp.server.js";
```

```ts
describe('getMcpToolMetadataCacheKey', () => {
  const baseDeps = {
    contactsEnabled: false,
    chatSession: undefined,
    agentDatabase: undefined,
    agentDispatcher: undefined,
    questionerEnqueue: undefined,
  };

  test('changes when registry-shaping dependencies change', () => {
    const base = getMcpToolMetadataCacheKey(baseDeps);

    expect(getMcpToolMetadataCacheKey({ ...baseDeps, contactsEnabled: true })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, chatSession: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, agentDatabase: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, agentDispatcher: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, questionerEnqueue: (async () => undefined) as never })).not.toBe(base);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Protocol MCP tests pass: `cd packages/protocol && bun test src/mcp/tests/mcp.server.spec.ts`
- [ ] Backend MCP factory tests pass: `cd services/api && bun test tests/mcp.spec.ts`
- [ ] Static metadata cache stores no handlers: `python3 - <<'PY'
from pathlib import Path
s=Path('packages/protocol/src/mcp/mcp.server.ts').read_text()
start=s.index('type McpToolRegistrationMetadata')
end=s.index('const AGENT_GATE_EXEMPT')
assert 'handler' not in s[start:end]
PY`
- [ ] Request-scoped registry creation remains in tool execution: `rg "requestRegistry = createToolRegistry\(requestDeps\)" packages/protocol/src/mcp/mcp.server.ts` returns a match

#### Manual Verification:
- [ ] Confirm `createMcpServer()` still constructs a fresh `McpServer` per call and does not reuse SDK server/transport instances.
- [ ] Confirm cached metadata key covers every known registry-shaping dependency: contacts, chat, agent, negotiation, and questioner availability.

## Phase 4: Verification and docs polish

### Overview

Documents the new MCP hardening behavior and adds final implementation-facing verification checks. Depends on Phase 3.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`
**Changes**: MODIFY — update MCP transport throttle documentation to include HTTP-level request limiting and lifecycle/cache hardening.

```md
**MCP transport throttle.** The `/mcp` endpoint is dispatched in `main.ts` before the `/api/*` branch, so it bypasses the normal controller `RateLimit` guards. It therefore has two limiter layers. First, `checkMcpHttpRateLimit` (`src/lib/limiter/mcp.ts`) runs in `mcp.controller.ts` before the request body is drained and before a per-request MCP server/transport is allocated; it keys a cheap `mcp_http` bucket by verified JWT user or client IP (never raw API keys), defaults to `MCP_HTTP_LIMIT_PER_MIN=240`, shares Redis/in-memory limiter storage, honors `LIMITER_DISABLE`, and fails open on limiter storage/identity errors so Redis incidents do not take down MCP. Second, `checkMcpRateLimit` is injected into the protocol MCP server as the `mcpRateLimiter` hook on `ToolDeps` and invoked in `mcp.server.ts` after identity resolves but before any DB work. It keys two buckets per `(userId, agentId)` principal — a per-tool bucket (`MCP_LIMIT_TOOL_PER_MIN`, default 120; `discover_opportunities` is far tighter at `MCP_LIMIT_DISCOVER_PER_MIN`, default 10) and an aggregate backstop (`MCP_LIMIT_PRINCIPAL_PER_MIN`, default 300). The MCP controller still creates a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport` per HTTP request to avoid JSON-RPC response-routing leaks between clients that reuse message IDs; both SDK objects are closed after the response, and static tool registration metadata/schema conversion is cached in `mcp.server.ts` so high-churn clients do not rebuild every tool schema on every request. Do not cache raw MCP/JSON-RPC responses (`initialize`, `tools/list`, or `tools/call`) or pool SDK server/transport objects; the SDK owns envelopes, message IDs, and client-capability state. Complementing this, `discover_opportunities` **coalesces in-flight MCP discovery runs**: a repeat call with an equivalent request returns the existing queued/running run (`coalesced: true`) via `discoveryRuns.listActive()` instead of spawning a duplicate, so re-firing discovery instead of polling `get_discovery_run` no longer multiplies expensive graph runs.
```

#### 2. docs/design/protocol-deep-dive.md

**File**: `docs/design/protocol-deep-dive.md`
**Changes**: MODIFY — document MCP hot-path lifecycle, limiter layers, and the reason server/transport pooling is intentionally avoided.

```md
The HTTP entrypoint for MCP is `services/api/src/controllers/mcp.controller.ts`, dispatched directly from `services/api/src/main.ts` before the decorated `/api/*` router. Because that bypasses controller guards, the controller applies a cheap HTTP-level limiter before expensive work: `checkMcpHttpRateLimit` uses the shared limiter storage and buckets by verified JWT user or client IP under the `mcp_http` class (`MCP_HTTP_LIMIT_PER_MIN`, default 240). Raw API keys are deliberately not bucket keys at this pre-auth layer, matching the normal `RateLimit` guard's credential-rotation defense. The HTTP limiter honors `LIMITER_DISABLE` and fails open on limiter storage/identity errors so Redis incidents do not take down MCP.

MCP also keeps the deeper per-tool limiter: `checkMcpRateLimit` is injected as `ToolDeps.mcpRateLimiter` and runs in `packages/protocol/src/mcp/mcp.server.ts` after identity resolves but before tool DB work. It enforces per-tool and aggregate per-principal buckets, including the tighter `discover_opportunities` budget, so expensive tool cascades remain bounded even when the HTTP request rate is acceptable.

Each accepted MCP HTTP request still gets a fresh `McpServer` and `WebStandardStreamableHTTPServerTransport`. This is intentional: the Streamable HTTP transport tracks response-routing state by JSON-RPC message id, and clients commonly reuse ids such as `2` across independent connections. Pooling a server or transport can route responses or client-capability state across callers, so the controller preserves per-request isolation. The request `finally` path closes both SDK lifecycle objects. Do not hand-write cached MCP/JSON-RPC responses for static-looking methods such as `initialize` or `tools/list`; the SDK owns response envelopes and capability negotiation.

To reduce allocation without changing protocol semantics, `packages/protocol/src/mcp/mcp.server.ts` caches only static tool registration metadata: tool name, description, Zod schema, JSON Schema, and the SDK `fromJsonSchema` input schema wrapper. Request-scoped tool execution still rebuilds the registry after auth with scoped `userDb`/`systemDb`, because tool handlers capture those dependencies when the registry is created.
```

### Success Criteria:

#### Automated Verification:
- [ ] MCP limiter unit tests pass: `cd services/api && bun test src/lib/limiter/tests/mcp.spec.ts`
- [ ] Backend MCP factory tests pass: `cd services/api && bun test tests/mcp.spec.ts`
- [ ] Protocol MCP tests pass: `cd packages/protocol && bun test src/mcp/tests/mcp.server.spec.ts`
- [ ] Documentation mentions both limiter layers: `rg "checkMcpHttpRateLimit|checkMcpRateLimit" CLAUDE.md docs/design/protocol-deep-dive.md`
- [ ] Documentation records the no-pooling invariant: `rg 'fresh `McpServer`|Pooling a server or transport' CLAUDE.md docs/design/protocol-deep-dive.md`
- [ ] Documentation records metadata-only caching: `rg "static tool registration metadata|schema conversion is cached" CLAUDE.md docs/design/protocol-deep-dive.md`
- [ ] Source introduces no server/transport pooling: `rg "cached.*McpServer|McpServer.*pool|WebStandardStreamableHTTPServerTransport.*pool" services packages` returns no intentional pooling implementation
- [ ] New limiter env var is documented and validated: `rg "MCP_HTTP_LIMIT_PER_MIN" services/api/src/startup.env.ts services/api/.env.example services/api/src/lib/limiter/config.ts` returns matches in all three files
- [ ] MCP handler keeps HTTP auth challenge under limiter threshold: inspect `services/api/src/controllers/mcp.controller.ts` and confirm the 401 `WWW-Authenticate` response remains after `checkMcpHttpRateLimit` and before `createPerRequestTransport`
- [ ] Final backend lint passes after all implementation phases: `cd services/api && bun run lint`

#### Manual Verification:
- [ ] Confirm the docs tell future maintainers not to cache raw MCP responses or pool SDK server/transport objects.
- [ ] Confirm docs distinguish the HTTP request limiter from the per-tool MCP limiter.

## Ordering Constraints

- Phase 1 must land before Phase 2 because Phase 2 edits the same request lifecycle area.
- Phase 2 must land before Phase 3 so request volume guardrails are in place before protocol allocation changes.
- Phase 3 must land before Phase 4 so docs describe final behavior.
- No phases are parallel-safe because Phases 1 and 2 both touch `mcp.controller.ts`, and Phase 4 documents decisions made by prior phases.

## Verification Notes

- Run `cd services/api && bun test src/lib/limiter/tests/mcp.spec.ts` after the limiter helper changes.
- Run `cd services/api && bun test tests/mcp.spec.ts` after MCP server factory compatibility changes.
- Run `cd packages/protocol && bun test src/mcp/tests/mcp.server.spec.ts` after protocol metadata-cache changes.
- Run `cd services/api && bun run lint` after backend/controller edits.
- Verify no source introduces server/transport pooling with `rg "cached.*McpServer|McpServer.*pool|WebStandardStreamableHTTPServerTransport.*pool" services packages` returning no intentional pooling implementation.
- Verify all new limiter env vars are present in both `services/api/src/startup.env.ts` and `services/api/.env.example`.
- Verify final code still returns HTTP 401 with `WWW-Authenticate` before MCP transport for missing auth when under the limiter threshold.

## Performance Considerations

- The HTTP-level limiter runs before MCP server allocation and before body draining when the body has no content-length, reducing memory exposure under high-churn or oversized requests.
- Static metadata caching avoids repeated `createToolRegistry(deps)`, `zodToJsonSchema()`, and `fromJsonSchema()` work for registration on every MCP request.
- Request-scoped registry creation remains for actual tool calls because handlers capture scoped DB dependencies; avoiding it requires a larger tool factory refactor and is deferred.
- Closing `McpServer` in addition to transport should release SDK callback/state references earlier and reduce retained per-request objects.

## Migration Notes

No database migration or persisted data change is required. Runtime rollback is to unset/tune `MCP_HTTP_LIMIT_PER_MIN` or set `LIMITER_DISABLE=1` during an incident; code rollback restores previous MCP allocation behavior.

## Pattern References

- `services/api/src/guards/limiter.guard.ts:66-118` — standard fixed-window limiter behavior, fail-open storage handling, and 429 mapping pattern.
- `services/api/src/lib/limiter/identifier.ts:92-120` — verified JWT or IP-only pre-auth identity resolution.
- `services/api/src/lib/limiter/mcp.ts:60-88` — existing MCP per-tool/per-principal limiter shape.
- `services/api/src/controllers/mcp.controller.ts:144-190` — existing module-level graph cache that avoids request-scoped capture.
- `services/api/src/controllers/mcp.controller.ts:673-680` — per-request MCP isolation rationale.
- `packages/protocol/src/mcp/mcp.server.ts:608-617` — request-scoped registry recreation for scoped DB access.

## Developer Context

- Question: “For the Railway OOM fix, should the plan cover only the hot-path fix, or also a broader MCP allocation refactor? Evidence: `/mcp` currently creates a full per-request server at `services/api/src/controllers/mcp.controller.ts:682-688`; prior per-request isolation fixed cross-user routing in commit `7b829fb32f`, so a broad reuse refactor has more risk.” Answer: “Broader refactor.”
- Question: “About to follow the existing pre-auth limiter pattern for `/mcp`: verified JWT users or client IP only (`services/api/src/lib/limiter/identifier.ts:92-120`), fail open on storage errors (`services/api/src/guards/limiter.guard.ts:99-104`), no raw API-key buckets. Confirm that direction, or are we moving off it?” Answer: “Follow pattern.”
- Question: “About to preserve per-request MCP server/transport isolation while reducing allocations around metadata/schema caching. Evidence: current comments cite response-routing risk at `services/api/src/controllers/mcp.controller.ts:673-680`, and SDK transport maps requests by JSON-RPC id. Confirm that direction, or are we moving toward server pooling/reuse?” Answer: “Preserve isolation.”
- Question: “Given that, which default should the cheap HTTP-level `/mcp` limiter use? It will be configurable via `MCP_HTTP_LIMIT_PER_MIN`; this is only the fallback when env is unset.” Answer: “Should we use rate limiter here?” Follow-up decision: include it as a guardrail, not the sole fix.
- Question: “Should this plan include a manual cached-response fast path for static MCP methods like `tools/list`, or stay with safer SDK handling while caching the static metadata it consumes? Evidence: tool metadata is static after registry-shaping flags, but the SDK owns JSON-RPC envelopes and per-client capability state.” Answer: “I don't know you decide. I just don't want people complaining about broken MCP.” Decision: cache metadata only; do not manually cache/return MCP responses.
- Design summary confirmed: proceed.
- Decomposition confirmed: four sequential slices approved.

## Plan History

- Phase 1: MCP lifecycle cleanup — approved as generated
- Phase 2: Cheap /mcp HTTP limiter — revised after Step 8 review: added `mcp_http` to `CLASS_CONFIG` so `Record<LimiterClass, ClassConfig>` remains exhaustive
- Phase 3: Static MCP metadata cache — approved as generated
- Phase 4: Verification and docs polish — approved as generated

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 2 §1 (config.ts) | services/api/src/lib/limiter/config.ts:38 | blocker | actionability | Phase 2 widens `LimiterClass` to include `'mcp_http'` but does not update `CLASS_CONFIG: Record<LimiterClass, ClassConfig>`, so TypeScript will reject the missing `mcp_http` property | Add `mcp_http: resolveClassConfig('mcp_http')` to `CLASS_CONFIG` in the same subsection | applied: added `mcp_http: resolveClassConfig('mcp_http')` to the Phase 2 `CLASS_CONFIG` snippet |

## References

- Runtime evidence gathered from Railway metrics/logs: memory repeatedly ramped to ~31.6 GB on a 32 GB limit; logs showed high `/mcp` churn and repeated tool registry/server creation.
- Git precedent `359806bae2`: MCP transport throttle + duplicate discovery coalescing.
- Git precedent `f759a9b024`, `b0a4bb4829`, `5b494c281c`, `55fb54f5c9`: follow-up hardening for MCP throttle/coalescing.
- Git precedent `7b829fb32f`: per-request MCP transport isolation to prevent cross-user response routing.
- Git precedent `8fd3deca4e`: JSON responses for per-request transports.
- Git precedent `4150d08484`: Hermes plugin now forwards more Index MCP tools, increasing `/mcp` hot-path importance.
