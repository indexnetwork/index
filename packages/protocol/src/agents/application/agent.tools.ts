/**
 * agents/application — agent registration and permission tools.
 *
 * Provides createAgentTools: the canonical factory for participant-agent
 * registration, listing, update, delete, and permission grant/revoke MCP tools.
 *
 * Dependencies:
 * - DefineTool / helpers from shared/agent (unclassified shared infrastructure)
 * - AgentToolDeps from agents/ports (same capability)
 *
 * IND-548: migrated from src/agent/agent.tools.ts.
 * Legacy path (src/agent/agent.tools.ts) is a thin compatibility shim.
 */

import { z } from 'zod';

import type { DefineTool } from '../../shared/agent/tool.helpers.js';
import type { AgentToolDeps } from '../ports/index.js';
import { error, success } from '../../shared/agent/tool.helpers.js';
import { protocolLogger } from '../../shared/observability/protocol.logger.js';

const logger = protocolLogger('ChatTools:Agent');

const AGENT_ACTIONS = [
  'manage:identity',
  'manage:premises',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
] as const;

/**
 * Canonical permission-action enum for the public tool INPUT schemas. Retired
 * `manage:profile` / `manage:contacts` strings are rejected at the schema seam
 * (defense-in-depth: the handler still re-validates via {@link isValidAction}).
 */
const AgentPermissionActionSchema = z.enum(AGENT_ACTIONS);

function invalidActionMessage(action: string) {
  return `Invalid action: ${action}. Valid actions: ${AGENT_ACTIONS.join(', ')}`;
}

function isValidAction(action: string): action is (typeof AGENT_ACTIONS)[number] {
  return (AGENT_ACTIONS as readonly string[]).includes(action);
}

function requireAgentDatabase(deps: AgentToolDeps) {
  if (!deps.agentDatabase) {
    return null;
  }

  return deps.agentDatabase;
}

function ensureAgentScopedAccess(context: { agentId?: string }, requestedAgentId: string): string | null {
  if (context.agentId && context.agentId !== requestedAgentId) {
    return 'This agent can only manage its own registration.';
  }

  return null;
}

function sanitizeAgentForOutput<T extends { transports?: Array<{ channel: string; config: Record<string, unknown> }> }>(agent: T): T {
  return {
    ...agent,
    // Transport config carries private connection material (endpoint secrets,
    // auth headers/tokens). It is never projected to ANY MCP caller — including
    // the agent reading its own record via read_own_agent (IND-599). Channel,
    // priority, and health metadata remain visible; config is fully redacted.
    transports: agent.transports?.map((transport) => ({ ...transport, config: {} })),
  };
}

function sanitizeAgentName(name: string): string | null {
  const cleanName = name.trim();
  return cleanName ? cleanName : null;
}

function normalizePermissions(permissions: string[] | undefined): string[] {
  return [...new Set((permissions ?? []).map((action) => action.trim()).filter(Boolean))];
}

export function createAgentTools(defineTool: DefineTool, deps: AgentToolDeps) {
  const agentDb = requireAgentDatabase(deps);
  if (!agentDb) {
    return [];
  }

  const registerAgent = defineTool({
    name: 'register_agent',
    description:
      'Register a new personal agent for the current user. Optionally configure initial permissions. ' +
      'Use this when connecting an external agent to Index.',
    querySchema: z.object({
      name: z.string().min(1).describe('Display name for the agent.'),
      description: z.string().optional().describe('What the agent does.'),
      permissions: z.array(AgentPermissionActionSchema).optional().describe('Optional initial permission actions to grant. Valid values: manage:identity, manage:premises, manage:intents, manage:networks, manage:opportunities, manage:negotiations.'),
    }),
    handler: async ({ context, query }) => {
      if (context.agentId) {
        return error(
          'Agent registration must be done from a user session (web UI or personal API key), ' +
          'not from within an existing agent context. To register a new agent, visit the Index web app.'
        );
      }

      try {
        const name = sanitizeAgentName(query.name);
        if (!name) {
          return error('Agent name is required.');
        }

        const permissions = normalizePermissions(query.permissions);
        for (const permission of permissions) {
          if (!isValidAction(permission)) {
            return error(invalidActionMessage(permission));
          }
        }

        const agent = await agentDb.createAgent({
          ownerId: context.userId,
          name,
          description: query.description?.trim() || undefined,
          type: 'external',
        });

        try {
          if (permissions.length > 0) {
            await agentDb.grantPermission({
              agentId: agent.id,
              userId: context.userId,
              scope: 'global',
              actions: permissions,
            });
          }
        } catch (setupError) {
          try {
            await agentDb.deleteAgent(agent.id);
          } catch {
            // Best-effort cleanup to avoid leaving partially registered agents behind.
          }

          throw setupError;
        }

        const fullAgent = await agentDb.getAgentWithRelations(agent.id);
        return success({
          message: `Agent "${agent.name}" registered successfully.`,
          agent: sanitizeAgentForOutput(fullAgent ?? ({ ...agent, transports: [], permissions: [] })),
        });
      } catch (err) {
        logger.error('Failed to register agent', { err });
        return error('Failed to register agent. Please try again.');
      }
    },
  });

  const readOwnAgent = defineTool({
    name: 'read_own_agent',
    description:
      "Read the calling agent's own registration record \u2014 its identity, " +
      'transports, and granted permissions. Returns only the authenticated ' +
      'agent\u2019s own record; no other agent can be named or targeted. Use this ' +
      'when an agent needs to inspect its own configuration.',
    querySchema: z.object({}),
    handler: async ({ context }) => {
      // Defense-in-depth: the capability policy only admits registered active
      // agent principals here, but never trust the caller — require an agent
      // context and resolve strictly the caller's OWN record (no target input).
      if (!context.agentId) {
        return error('read_own_agent is only available to a registered agent principal.');
      }

      try {
        const agent = await agentDb.getAgentWithRelations(context.agentId);
        if (!agent || agent.ownerId !== context.userId) {
          return error('Agent not found');
        }

        return success({ agent: sanitizeAgentForOutput(agent) });
      } catch (err) {
        logger.error('Failed to read own agent', { err });
        return error('Failed to read agent. Please try again.');
      }
    },
  });

  const listAgents = defineTool({
    name: 'list_agents',
    description: 'List all agents the current user owns or has authorized.',
    querySchema: z.object({}),
    handler: async ({ context }) => {
      try {
        const agents = await agentDb.listAgentsForUser(context.userId);
        const filteredAgents = context.agentId
          ? agents.filter((agent) => agent.id === context.agentId)
          : agents;
        return success({
          agents: filteredAgents.map((agent) => sanitizeAgentForOutput(agent)),
          count: filteredAgents.length,
        });
      } catch (err) {
        logger.error('Failed to list agents', { err });
        return error('Failed to list agents. Please try again.');
      }
    },
  });

  const updateAgent = defineTool({
    name: 'update_agent',
    description: 'Update an agent name, description, or status.',
    querySchema: z.object({
      agent_id: z.string().min(1).describe('The agent ID to update.'),
      name: z.string().optional().describe('Updated display name.'),
      description: z.string().optional().describe('Updated description.'),
      status: z.enum(['active', 'inactive']).optional().describe('Updated status.'),
    }),
    handler: async ({ context, query }) => {
      const scopeError = ensureAgentScopedAccess(context, query.agent_id);
      if (scopeError) {
        return error(scopeError);
      }

      try {
        const agent = await agentDb.getAgent(query.agent_id);
        if (!agent || agent.ownerId !== context.userId) {
          return error('Agent not found');
        }

        if (agent.type === 'system') {
          return error('System agents cannot be modified');
        }

        const updates: { name?: string; description?: string | null; status?: 'active' | 'inactive' } = {};
        if (query.name !== undefined) {
          const name = query.name.trim();
          if (!name) {
            return error('Agent name is required');
          }
          updates.name = name;
        }
        if (query.description !== undefined) {
          updates.description = query.description.trim() || null;
        }
        if (query.status) {
          updates.status = query.status;
        }

        if (Object.keys(updates).length === 0) {
          return error('At least one field is required.');
        }

        const updated = await agentDb.updateAgent(query.agent_id, updates);
        if (!updated) {
          return error('Agent not found');
        }

        const fullAgent = await agentDb.getAgentWithRelations(query.agent_id);
        return success({
          message: 'Agent updated.',
          agent: sanitizeAgentForOutput(fullAgent ?? ({ ...updated, transports: [], permissions: [] })),
        });
      } catch (err) {
        logger.error('Failed to update agent', { err });
        return error('Failed to update agent. Please try again.');
      }
    },
  });

  const deleteAgent = defineTool({
    name: 'delete_agent',
    description: 'Soft-delete a personal agent and deactivate its transports.',
    querySchema: z.object({
      agent_id: z.string().min(1).describe('The agent ID to delete.'),
    }),
    handler: async ({ context, query }) => {
      const scopeError = ensureAgentScopedAccess(context, query.agent_id);
      if (scopeError) {
        return error(scopeError);
      }

      try {
        const agent = await agentDb.getAgent(query.agent_id);
        if (!agent || agent.ownerId !== context.userId) {
          return error('Agent not found');
        }
        if (agent.type === 'system') {
          return error('System agents cannot be deleted');
        }

        await agentDb.deleteAgent(query.agent_id);
        return success({ message: `Agent "${agent.name}" deleted.` });
      } catch (err) {
        logger.error('Failed to delete agent', { err });
        return error('Failed to delete agent. Please try again.');
      }
    },
  });

  const grantAgentPermission = defineTool({
    name: 'grant_agent_permission',
    description: 'Grant one or more permissions to an agent for the current user. ' +
      'Valid actions: manage:identity, manage:premises, manage:intents, manage:networks, manage:opportunities, manage:negotiations.',
    querySchema: z.object({
      agent_id: z.string().min(1).describe('The agent ID to grant permissions to.'),
      actions: z.array(AgentPermissionActionSchema).min(1).describe('Permission actions to grant. Valid values: manage:identity, manage:premises, manage:intents, manage:networks, manage:opportunities, manage:negotiations.'),
      scope: z.enum(['global', 'node', 'network']).optional().describe('Optional permission scope.'),
      scope_id: z.string().optional().describe('Scope target ID for node/network scopes.'),
    }),
    handler: async ({ context, query }) => {
      const scopeError = ensureAgentScopedAccess(context, query.agent_id);
      if (scopeError) {
        return error(scopeError);
      }

      const actions = normalizePermissions(query.actions);
      if (actions.length === 0) {
        return error('At least one non-empty action is required.');
      }

      for (const action of actions) {
        if (!isValidAction(action)) {
          return error(invalidActionMessage(action));
        }
      }

      if ((query.scope === 'network' || query.scope === 'node') && !query.scope_id?.trim()) {
        return error(`scope_id is required for ${query.scope} permissions.`);
      }

      try {
        const agent = await agentDb.getAgent(query.agent_id);
        if (!agent || agent.ownerId !== context.userId) {
          return error('Agent not found');
        }

        const permission = await agentDb.grantPermission({
          agentId: query.agent_id,
          userId: context.userId,
          scope: query.scope,
          scopeId: query.scope === 'global' || query.scope === undefined ? undefined : query.scope_id?.trim(),
          actions,
        });

        return success({ message: 'Permission granted.', permission });
      } catch (err) {
        logger.error('Failed to grant permission', { err });
        return error('Failed to grant permission. Please try again.');
      }
    },
  });

  const revokeAgentPermission = defineTool({
    name: 'revoke_agent_permission',
    description: 'Revoke a specific permission from an agent.',
    querySchema: z.object({
      agent_id: z.string().min(1).describe('The agent ID that owns the permission.'),
      permission_id: z.string().min(1).describe('The permission ID to revoke.'),
    }),
    handler: async ({ context, query }) => {
      const scopeError = ensureAgentScopedAccess(context, query.agent_id);
      if (scopeError) {
        return error(scopeError);
      }

      try {
        const agent = await agentDb.getAgentWithRelations(query.agent_id);
        if (!agent || agent.ownerId !== context.userId) {
          return error('Agent not found');
        }

        const permission = agent.permissions.find((item) => item.id === query.permission_id);
        if (!permission) {
          return error('Permission not found');
        }

        await agentDb.revokePermission(query.permission_id);
        return success({ message: 'Permission revoked.' });
      } catch (err) {
        logger.error('Failed to revoke permission', { err });
        return error('Failed to revoke permission. Please try again.');
      }
    },
  });

  return [
    readOwnAgent,
    registerAgent,
    listAgents,
    updateAgent,
    deleteAgent,
    grantAgentPermission,
    revokeAgentPermission,
  ] as const;
}
