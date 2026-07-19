import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryStorage } from '../storage.memory';
import { checkMcpRateLimit, checkMcpHttpRateLimit } from '../mcp';

describe('checkMcpRateLimit', () => {
  const originalEnv = { ...process.env };
  let s: MemoryStorage;
  beforeEach(() => {
    process.env = { ...originalEnv };
    s = new MemoryStorage();
    process.env.MCP_LIMIT_DISCOVER_PER_MIN = '3';
    process.env.MCP_LIMIT_TOOL_PER_MIN = '5';
    process.env.MCP_LIMIT_PRINCIPAL_PER_MIN = '1000';
    delete process.env.LIMITER_DISABLE;
  });
  afterEach(() => {
    s.stop();
    process.env = originalEnv;
  });

  test('allows up to the per-tool limit, then blocks', async () => {
    const input = { userId: 'u1', agentId: 'a1', toolName: 'discover_opportunities' };
    for (let i = 0; i < 3; i++) {
      const d = await checkMcpRateLimit(input, s);
      expect(d.allowed).toBe(true);
    }
    const blocked = await checkMcpRateLimit(input, s);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('tool');
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(3);
  });

  test('different tools have independent buckets', async () => {
    const base = { userId: 'u1', agentId: 'a1' };
    for (let i = 0; i < 3; i++) await checkMcpRateLimit({ ...base, toolName: 'discover_opportunities' }, s);
    // discover is now exhausted, but read_intents has its own (5/min) bucket
    const d = await checkMcpRateLimit({ ...base, toolName: 'read_intents' }, s);
    expect(d.allowed).toBe(true);
  });

  test('different principals have independent buckets', async () => {
    for (let i = 0; i < 3; i++) await checkMcpRateLimit({ userId: 'u1', agentId: 'a1', toolName: 'discover_opportunities' }, s);
    const otherUser = await checkMcpRateLimit({ userId: 'u2', agentId: 'a1', toolName: 'discover_opportunities' }, s);
    expect(otherUser.allowed).toBe(true);
    const otherAgent = await checkMcpRateLimit({ userId: 'u1', agentId: 'a2', toolName: 'discover_opportunities' }, s);
    expect(otherAgent.allowed).toBe(true);
  });

  test('aggregate per-principal cap blocks even across distinct tools', async () => {
    process.env.MCP_LIMIT_PRINCIPAL_PER_MIN = '4';
    process.env.MCP_LIMIT_TOOL_PER_MIN = '100';
    const base = { userId: 'u9', agentId: 'a9' };
    const tools = ['read_intents', 'read_networks', 'read_docs', 'list_agents'];
    for (const t of tools) {
      const d = await checkMcpRateLimit({ ...base, toolName: t }, s);
      expect(d.allowed).toBe(true);
    }
    const fifth = await checkMcpRateLimit({ ...base, toolName: 'read_premises' }, s);
    expect(fifth.allowed).toBe(false);
    expect(fifth.scope).toBe('principal');
  });

  test('fails OPEN when storage throws', async () => {
    const throwing = {
      async hit() { throw new Error('redis down'); },
    } as unknown as MemoryStorage;
    const d = await checkMcpRateLimit({ userId: 'u1', agentId: 'a1', toolName: 'discover_opportunities' }, throwing);
    expect(d.allowed).toBe(true);
  });

  test('respects LIMITER_DISABLE escape hatch', async () => {
    process.env.LIMITER_DISABLE = '1';
    const input = { userId: 'u1', agentId: 'a1', toolName: 'discover_opportunities' };
    for (let i = 0; i < 10; i++) {
      const d = await checkMcpRateLimit(input, s);
      expect(d.allowed).toBe(true);
    }
    delete process.env.LIMITER_DISABLE;
  });
});

describe('checkMcpHttpRateLimit', () => {
  const originalEnv = { ...process.env };
  let s: MemoryStorage;

  const req = (ip: string, headers: Record<string, string> = {}): Request =>
    new Request('https://protocol.index.network/mcp', {
      headers: { 'x-forwarded-for': ip, ...headers },
    });

  beforeEach(() => {
    process.env = { ...originalEnv };
    s = new MemoryStorage();
    process.env.MCP_HTTP_LIMIT_PER_MIN = '3';
    process.env.RAILWAY_ENVIRONMENT = 'test';
    delete process.env.LIMITER_DISABLE;
  });

  afterEach(() => {
    s.stop();
    process.env = originalEnv;
  });

  test('allows up to the MCP HTTP limit, then blocks', async () => {
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

  test('buckets raw API-key requests by IP, not key value', async () => {
    process.env.MCP_HTTP_LIMIT_PER_MIN = '2';
    const ip = '203.0.113.81';

    expect((await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-one' }), s)).allowed).toBe(true);
    expect((await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-two' }), s)).allowed).toBe(true);

    const blocked = await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-three' }), s);
    expect(blocked.allowed).toBe(false);
  });

  test('bypasses private/local IPs for local development', async () => {
    process.env.MCP_HTTP_LIMIT_PER_MIN = '1';
    for (let i = 0; i < 5; i++) {
      const d = await checkMcpHttpRateLimit(req('10.0.0.1'), s);
      expect(d.allowed).toBe(true);
    }
  });

  test('respects LIMITER_DISABLE escape hatch', async () => {
    process.env.LIMITER_DISABLE = '1';
    process.env.MCP_HTTP_LIMIT_PER_MIN = '1';
    const ip = '203.0.113.82';
    for (let i = 0; i < 5; i++) {
      const d = await checkMcpHttpRateLimit(req(ip), s);
      expect(d.allowed).toBe(true);
    }
    delete process.env.LIMITER_DISABLE;
  });

  test('fails OPEN when storage throws', async () => {
    const throwing = {
      async hit() { throw new Error('redis down'); },
    } as unknown as MemoryStorage;

    const d = await checkMcpHttpRateLimit(req('203.0.113.83'), throwing);
    expect(d.allowed).toBe(true);
  });
});
