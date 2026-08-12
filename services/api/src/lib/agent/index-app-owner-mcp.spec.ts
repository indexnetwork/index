import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { validateIndexAppOwnerMcpEnvelope } from './index-app-owner-mcp';

const mcpController = readFileSync(new URL('../../controllers/mcp.controller.ts', import.meta.url), 'utf8');

const call = (overrides: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id: 'native-request-1',
  method: 'tools/call',
  params: { name: 'create_intent', arguments: { description: 'Meet climate founders', autoApprove: true } },
  ...overrides,
});

describe('Index app owner MCP envelope boundary', () => {
  it('authenticates and records dedicated owner-product context before generic MCP allocation', () => {
    const handler = mcpController.match(/export async function mcpHandler[\s\S]*?let connection/)?.[0] ?? '';
    expect(handler).toContain('validateIndexAppOwnerMcpEnvelope');
    expect(handler).toContain('resolveIndexAppOwnerCredential');
    expect(handler).toContain('recordRequestAuthContext');
    expect(handler).toContain('INDEX_APP_OWNER_AUDIENCE');
    expect(handler).toContain("req.method !== 'POST' || new URL(req.url).pathname !== '/mcp'");
    expect(handler.indexOf('validateIndexAppOwnerMcpEnvelope')).toBeLessThan(handler.indexOf('let connection'));
  });
  it('admits only one exact create_intent tools/call shape', () => {
    expect(validateIndexAppOwnerMcpEnvelope(call())).toBe(true);
    expect(validateIndexAppOwnerMcpEnvelope(call({ method: 'tools/list' }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({ method: 'prompts/list' }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({ method: 'resources/list' }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({ id: undefined }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope([{ ...call() }])).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope({ ...call(), extra: true })).toBe(false);
  });

  it('denies arbitrary/dangerous tools, batching, notifications and alternate RPC forms', () => {
    for (const name of ['delete_agent', 'grant_agent_permission', 'read_user_contexts', 'arbitrary']) {
      expect(validateIndexAppOwnerMcpEnvelope(call({
        params: { name, arguments: { description: 'x' } },
      })), name).toBe(false);
    }
    expect(validateIndexAppOwnerMcpEnvelope(call({ jsonrpc: '2.1' }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({ id: 1 }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({ params: { name: 'create_intent' } }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({
      params: { name: 'create_intent', arguments: { description: 'x', unknown: true } },
    }))).toBe(false);
  });

  it('applies global and exact argument bounds without bool/number or null coercion', () => {
    expect(validateIndexAppOwnerMcpEnvelope(call({
      params: { name: 'create_intent', arguments: { description: true } },
    }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({
      params: { name: 'create_intent', arguments: { description: 'x', autoApprove: 1 } },
    }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({
      params: { name: 'create_intent', arguments: { description: null } },
    }))).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope(call({
      params: { name: 'create_intent', arguments: { description: 'x'.repeat(65_537) } },
    }))).toBe(false);
    let deep: unknown = 'x';
    for (let i = 0; i < 17; i += 1) deep = { nested: deep };
    expect(validateIndexAppOwnerMcpEnvelope(deep)).toBe(false);
    expect(validateIndexAppOwnerMcpEnvelope({ many: Array.from({ length: 101 }, (_, i) => i) })).toBe(false);
  });
});
