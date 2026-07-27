import { describe, expect, test } from 'bun:test';
import type { z } from 'zod';

import { createAgentTools } from '../application/agent.tools.js';
import type { AgentToolDeps } from '../ports/index.js';

/**
 * IND-582 — canonical-only permission actions at the public participant-agent
 * input seam (DB-free).
 *
 * The MCP registry, tool schemas, and grant validation are canonical-only. The
 * retired `manage:profile` / `manage:contacts` strings are tolerated ONLY as
 * pre-existing STORED rows (interpreted by projectStoredPermissionActions during
 * the rolling window); they must never be accepted as public INPUT to
 * `register_agent` or `grant_agent_permission`. These tests prove the retired
 * strings are rejected with the canonical validation message and that no agent
 * is created and no permission granted on the rejected path, while the canonical
 * `manage:identity` / `manage:premises` actions are accepted.
 */

interface CapturedTool {
  name: string;
  handler: (input: { context: Record<string, unknown>; query: unknown }) => Promise<string>;
  querySchema?: z.ZodType;
}

function captureAgentTools(deps: AgentToolDeps): Record<string, CapturedTool> {
  const captured: Record<string, CapturedTool> = {};
  const defineTool = (def: CapturedTool) => {
    captured[def.name] = def;
    return def;
  };
  createAgentTools(defineTool as never, deps);
  return captured;
}

const OWNER_ID = 'user-owner';
const AGENT_ID = 'agent-1';

/** Records every write so rejected paths can assert nothing was persisted. */
interface WriteLog {
  createAgentCalls: Array<{ ownerId: string; name: string }>;
  grantCalls: Array<{ agentId: string; actions: string[] }>;
}

function makeDeps(log: WriteLog): AgentToolDeps {
  return {
    agentDatabase: {
      createAgent: async (input: { ownerId: string; name: string }) => {
        log.createAgentCalls.push({ ownerId: input.ownerId, name: input.name });
        return {
          id: AGENT_ID,
          ownerId: input.ownerId,
          name: input.name,
          description: null,
          type: 'external',
          status: 'active',
          metadata: {},
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      grantPermission: async (input: { agentId: string; actions: string[] }) => {
        log.grantCalls.push({ agentId: input.agentId, actions: [...input.actions] });
        return {
          id: 'permission-1',
          agentId: input.agentId,
          userId: OWNER_ID,
          scope: 'global',
          scopeId: null,
          actions: input.actions,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      deleteAgent: async () => undefined,
      getAgent: async () => ({
        id: AGENT_ID,
        ownerId: OWNER_ID,
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      getAgentWithRelations: async () => ({
        id: AGENT_ID,
        ownerId: OWNER_ID,
        name: 'Agent',
        description: null,
        type: 'external',
        status: 'active',
        metadata: {},
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        transports: [],
        permissions: [],
      }),
    } as unknown as AgentToolDeps['agentDatabase'],
  } as AgentToolDeps;
}

const sessionContext = { userId: OWNER_ID };

function parse(result: string) {
  return JSON.parse(result) as { success: boolean; error?: string; data?: Record<string, unknown> };
}

const RETIRED_ACTIONS = ['manage:profile', 'manage:contacts'] as const;
const CANONICAL_ACTIONS = ['manage:identity', 'manage:premises'] as const;
const EXPECTED_MESSAGE =
  'Valid actions: manage:identity, manage:premises, manage:intents, manage:networks, manage:opportunities, manage:negotiations';

describe('public permission INPUT schemas are canonical-only (IND-582)', () => {
  // The public tool input schemas reject retired strings at the schema seam
  // (defense-in-depth ahead of the retained handler validation).
  const tools = captureAgentTools(makeDeps({ createAgentCalls: [], grantCalls: [] }));

  test('register_agent.permissions rejects retired strings and accepts canonical actions', () => {
    const schema = tools.register_agent!.querySchema!;
    for (const retired of RETIRED_ACTIONS) {
      expect(schema.safeParse({ name: 'Agent', permissions: [retired] }).success, retired).toBe(false);
    }
    expect(schema.safeParse({ name: 'Agent', permissions: [...CANONICAL_ACTIONS] }).success).toBe(true);
    // A retired string mixed with a canonical one still fails the whole array.
    expect(schema.safeParse({ name: 'Agent', permissions: ['manage:identity', 'manage:contacts'] }).success).toBe(false);
  });

  test('grant_agent_permission.actions rejects retired strings and accepts canonical actions', () => {
    const schema = tools.grant_agent_permission!.querySchema!;
    for (const retired of RETIRED_ACTIONS) {
      expect(schema.safeParse({ agent_id: AGENT_ID, actions: [retired] }).success, retired).toBe(false);
    }
    expect(schema.safeParse({ agent_id: AGENT_ID, actions: [...CANONICAL_ACTIONS] }).success).toBe(true);
    expect(schema.safeParse({ agent_id: AGENT_ID, actions: ['manage:profile', 'manage:identity'] }).success).toBe(false);
  });
});

describe('register_agent — canonical-only permission input (IND-582)', () => {
  for (const retired of RETIRED_ACTIONS) {
    test(`rejects a retired ${retired} permission and creates no agent`, async () => {
      const log: WriteLog = { createAgentCalls: [], grantCalls: [] };
      const tools = captureAgentTools(makeDeps(log));

      const result = parse(await tools.register_agent!.handler({
        context: sessionContext,
        query: { name: 'Agent', permissions: [retired] },
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Invalid action: ${retired}.`);
      expect(result.error).toContain(EXPECTED_MESSAGE);
      // Retired input is rejected before any write.
      expect(log.createAgentCalls).toEqual([]);
      expect(log.grantCalls).toEqual([]);
    });
  }

  test('accepts canonical manage:identity + manage:premises and grants them', async () => {
    const log: WriteLog = { createAgentCalls: [], grantCalls: [] };
    const tools = captureAgentTools(makeDeps(log));

    const result = parse(await tools.register_agent!.handler({
      context: sessionContext,
      query: { name: 'Agent', permissions: ['manage:identity', 'manage:premises'] },
    }));

    expect(result.success).toBe(true);
    expect(log.createAgentCalls).toEqual([{ ownerId: OWNER_ID, name: 'Agent' }]);
    expect(log.grantCalls).toEqual([{ agentId: AGENT_ID, actions: ['manage:identity', 'manage:premises'] }]);
  });
});

describe('grant_agent_permission — canonical-only permission input (IND-582)', () => {
  for (const retired of RETIRED_ACTIONS) {
    test(`rejects a retired ${retired} permission and grants nothing`, async () => {
      const log: WriteLog = { createAgentCalls: [], grantCalls: [] };
      const tools = captureAgentTools(makeDeps(log));

      const result = parse(await tools.grant_agent_permission!.handler({
        context: sessionContext,
        query: { agent_id: AGENT_ID, actions: [retired] },
      }));

      expect(result.success).toBe(false);
      expect(result.error).toContain(`Invalid action: ${retired}.`);
      expect(result.error).toContain(EXPECTED_MESSAGE);
      expect(log.grantCalls).toEqual([]);
    });
  }

  test('rejects a retired action mixed with a canonical one, granting nothing', async () => {
    const log: WriteLog = { createAgentCalls: [], grantCalls: [] };
    const tools = captureAgentTools(makeDeps(log));

    const result = parse(await tools.grant_agent_permission!.handler({
      context: sessionContext,
      query: { agent_id: AGENT_ID, actions: ['manage:identity', 'manage:contacts'] },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid action: manage:contacts.');
    expect(log.grantCalls).toEqual([]);
  });

  test('accepts canonical manage:identity + manage:premises and grants them', async () => {
    const log: WriteLog = { createAgentCalls: [], grantCalls: [] };
    const tools = captureAgentTools(makeDeps(log));

    const result = parse(await tools.grant_agent_permission!.handler({
      context: sessionContext,
      query: { agent_id: AGENT_ID, actions: ['manage:identity', 'manage:premises'] },
    }));

    expect(result.success).toBe(true);
    expect(log.grantCalls).toEqual([{ agentId: AGENT_ID, actions: ['manage:identity', 'manage:premises'] }]);
  });
});
