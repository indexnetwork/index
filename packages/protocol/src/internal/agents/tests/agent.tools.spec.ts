import { describe, expect, test } from 'bun:test';
import { createAgentTools } from '../../agents/agent.tools.js';
import type { ToolDeps, ResolvedToolContext } from '../../shared/agent/tool.helpers.js';
import { createFakeAgentDb } from './fakes.js';

function makeContext(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: 'user-123',
    userName: 'Alice',
    userEmail: 'a@test.com',
    user: { id: 'user-123', name: 'Alice', email: 'a@test.com', deletedAt: null } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createAgentTools(defineTool as never, { agentDatabase: createFakeAgentDb(), ...deps } as ToolDeps);
  return captured!;
}

describe('register_agent', () => {
  test('returns helpful error message when called from agent context', async () => {
    const tool = captureTool('register_agent', {});
    const contextWithAgent = makeContext({ agentId: 'existing-agent-id' });

    const result = JSON.parse(
      await tool.handler({ context: contextWithAgent, query: { name: 'New Agent' } })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('web app');
    expect(result.error).toContain('user session');
  });

  test('succeeds when called from a user session (no agentId)', async () => {
    const tool = captureTool('register_agent', {});

    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { name: 'My New Agent' } })
    );

    expect(result.success).toBe(true);
    expect(result.data.agent.name).toBe('My New Agent');
  });
});
