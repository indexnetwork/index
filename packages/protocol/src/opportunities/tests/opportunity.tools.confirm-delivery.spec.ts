// Stub API key to prevent module-level createModel() from throwing — only set when absent
process.env.OPENROUTER_API_KEY ||= 'test-key-unused';

import { mock, describe, expect, it } from 'bun:test';
import { z } from 'zod';

import { createOpportunityTools } from '../opportunity.tools.js';
import type { ToolDeps, DefineTool } from '../../shared/agent/tool.helpers.js';

// Minimal passthrough defineTool that mirrors the real registration shape.
function defineTool<T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: unknown; query: z.infer<T> }) => Promise<string>;
}) {
  return opts;
}

function parseResult(text: string) {
  return JSON.parse(text) as {
    success: boolean;
    data?: { status?: string };
    error?: string;
    code?: string;
    retryable?: boolean;
  };
}

const OPP_ID = 'c2505011-2e45-426e-81dd-b9abb9b72023';
const AGENT_ID = 'a-test-agent';
const USER_ID = 'u-test-user';

function makeDeps(confirm: ToolDeps['deliveryLedger'] extends infer L
  ? L extends { confirmOpportunityDelivery: infer F }
    ? F
    : never
  : never): ToolDeps {
  return {
    deliveryLedger: { confirmOpportunityDelivery: confirm } as unknown as ToolDeps['deliveryLedger'],
  } as unknown as ToolDeps;
}

function getConfirmTool(deps: ToolDeps) {
  const tools = createOpportunityTools(defineTool as unknown as DefineTool, deps);
  return tools.find((t: { name: string }) => t.name === 'confirm_opportunity_delivery')!;
}

const agentContext = {
  userId: USER_ID,
  agentId: AGENT_ID,
  isMcp: true,
  userName: 'Agent Owner',
  userNetworks: [],
};

describe('confirm_opportunity_delivery — retry-classified errors', () => {
  it('returns success with status on a committed delivery', async () => {
    const deps = makeDeps(mock(async () => 'confirmed' as const));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('confirmed');
  });

  it('treats already_delivered as success (idempotent re-confirm)', async () => {
    const deps = makeDeps(mock(async () => 'already_delivered' as const));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(true);
    expect(res.data?.status).toBe('already_delivered');
  });

  it('marks opportunity_not_found as a permanent (non-retryable) failure', async () => {
    const deps = makeDeps(mock(async () => { throw new Error('opportunity_not_found'); }));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('opportunity_not_found');
    expect(res.retryable).toBe(false);
  });

  it('marks not_authorized as a permanent (non-retryable) failure', async () => {
    const deps = makeDeps(mock(async () => { throw new Error('not_authorized'); }));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('not_authorized');
    expect(res.retryable).toBe(false);
  });

  it('marks an unknown/transient backend error as retryable', async () => {
    const deps = makeDeps(mock(async () => { throw new Error('ECONNREFUSED'); }));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('confirm_failed');
    expect(res.retryable).toBe(true);
  });

  it('rejects a non-agent MCP context as non-retryable unauthenticated', async () => {
    const deps = makeDeps(mock(async () => 'confirmed' as const));
    const res = parseResult(await getConfirmTool(deps).handler({ context: { ...agentContext, agentId: undefined }, query: { opportunityId: OPP_ID, trigger: 'digest' } }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('unauthenticated');
    expect(res.retryable).toBe(false);
  });

  it('rejects a malformed opportunity id as non-retryable', async () => {
    const deps = makeDeps(mock(async () => 'confirmed' as const));
    const res = parseResult(await getConfirmTool(deps).handler({ context: agentContext, query: { opportunityId: 'not-a-uuid', trigger: 'digest' } }));
    expect(res.success).toBe(false);
    expect(res.code).toBe('invalid_opportunity_id');
    expect(res.retryable).toBe(false);
  });
});
