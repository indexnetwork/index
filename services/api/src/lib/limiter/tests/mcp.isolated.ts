import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { MemoryStorage } from '../storage.memory';
import { CLASS_CONFIG } from '../config';
import { checkMcpRateLimit, checkMcpHttpRateLimit, MCP_PRINCIPAL_LIMIT_PER_MIN, MCP_TOOL_LIMIT_PER_MIN } from '../mcp';

const HTTP_LIMIT = CLASS_CONFIG.mcp_http.perMinute;

describe('checkMcpRateLimit', () => {
  const originalEnv = { ...process.env };
  let s: MemoryStorage;
  beforeEach(() => {
    process.env = { ...originalEnv };
    s = new MemoryStorage();
  });
  afterEach(() => {
    s.stop();
    process.env = originalEnv;
  });

  test('allows up to the per-tool limit, then blocks', async () => {
    const input = { userId: 'u1', agentId: 'a1', toolName: 'read_intents' };
    for (let i = 0; i < MCP_TOOL_LIMIT_PER_MIN; i++) {
      const d = await checkMcpRateLimit(input, s);
      expect(d.allowed).toBe(true);
    }
    const blocked = await checkMcpRateLimit(input, s);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe('tool');
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(MCP_TOOL_LIMIT_PER_MIN);
  });

  test('different tools have independent buckets', async () => {
    const base = { userId: 'u1', agentId: 'a1' };
    for (let i = 0; i < MCP_TOOL_LIMIT_PER_MIN; i++) await checkMcpRateLimit({ ...base, toolName: 'read_intents' }, s);
    // read_intents is exhausted, but read_networks has an independent bucket.
    const d = await checkMcpRateLimit({ ...base, toolName: 'read_networks' }, s);
    expect(d.allowed).toBe(true);
  });

  test('different principals have independent buckets', async () => {
    for (let i = 0; i < MCP_TOOL_LIMIT_PER_MIN; i++) await checkMcpRateLimit({ userId: 'u1', agentId: 'a1', toolName: 'read_intents' }, s);
    const otherUser = await checkMcpRateLimit({ userId: 'u2', agentId: 'a1', toolName: 'read_intents' }, s);
    expect(otherUser.allowed).toBe(true);
    const otherAgent = await checkMcpRateLimit({ userId: 'u1', agentId: 'a2', toolName: 'read_intents' }, s);
    expect(otherAgent.allowed).toBe(true);
  });

  test('aggregate per-principal cap blocks even across distinct tools', async () => {
    const base = { userId: 'u9', agentId: 'a9' };
    // Spread the principal budget across enough tools that no per-tool bucket
    // fills first, so the aggregate cap is what blocks.
    const tools = ['read_intents', 'read_networks', 'read_docs', 'list_agents'];
    let spent = 0;
    outer: for (const t of tools) {
      for (let i = 0; i < MCP_TOOL_LIMIT_PER_MIN; i++) {
        if (spent === MCP_PRINCIPAL_LIMIT_PER_MIN) break outer;
        const d = await checkMcpRateLimit({ ...base, toolName: t }, s);
        expect(d.allowed).toBe(true);
        spent += 1;
      }
    }
    const next = await checkMcpRateLimit({ ...base, toolName: 'read_premises' }, s);
    expect(next.allowed).toBe(false);
    expect(next.scope).toBe('principal');
  });

  test('fails OPEN when storage throws', async () => {
    const throwing = {
      async hit() { throw new Error('redis down'); },
    } as unknown as MemoryStorage;
    const d = await checkMcpRateLimit({ userId: 'u1', agentId: 'a1', toolName: 'read_intents' }, throwing);
    expect(d.allowed).toBe(true);
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
    process.env.RAILWAY_ENVIRONMENT = 'test';
  });

  afterEach(() => {
    s.stop();
    process.env = originalEnv;
  });

  test('allows up to the MCP HTTP limit, then blocks', async () => {
    const ip = '203.0.113.80';
    for (let i = 0; i < HTTP_LIMIT; i++) {
      const d = await checkMcpHttpRateLimit(req(ip), s);
      expect(d.allowed).toBe(true);
      expect(d.limit).toBe(HTTP_LIMIT);
    }

    const blocked = await checkMcpHttpRateLimit(req(ip), s);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(blocked.limit).toBe(HTTP_LIMIT);
    expect(blocked.remaining).toBe(0);
  });

  test('buckets raw API-key requests by IP, not key value', async () => {
    const ip = '203.0.113.81';

    // Distinct keys, one IP: the bucket is the IP, so the budget is shared.
    for (let i = 0; i < HTTP_LIMIT; i++) {
      const d = await checkMcpHttpRateLimit(req(ip, { 'x-api-key': `key-${i}` }), s);
      expect(d.allowed).toBe(true);
    }

    const blocked = await checkMcpHttpRateLimit(req(ip, { 'x-api-key': 'key-last' }), s);
    expect(blocked.allowed).toBe(false);
  });

  test('bypasses private/local IPs for local development', async () => {
    for (let i = 0; i < 5; i++) {
      const d = await checkMcpHttpRateLimit(req('10.0.0.1'), s);
      expect(d.allowed).toBe(true);
    }
  });

  test('fails OPEN when storage throws', async () => {
    const throwing = {
      async hit() { throw new Error('redis down'); },
    } as unknown as MemoryStorage;

    const d = await checkMcpHttpRateLimit(req('203.0.113.83'), throwing);
    expect(d.allowed).toBe(true);
  });
});
