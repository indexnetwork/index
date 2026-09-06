/**
 * agents/application — agent registry tools.
 *
 * Provides createAgentTools: the canonical factory for participant-agent
 * registration, listing, update and delete MCP tools, plus `read_own_agent`,
 * which resolves the owner's selected negotiator for a running agent.
 *
 * Dependencies:
 * - DefineTool / helpers from shared/agent (unclassified shared infrastructure)
 * - AgentToolDeps from agents/ports (same capability)
 */

import { z } from 'zod';

import type { DefineTool } from '../shared/agent/tool.helpers.js';
import type { AgentDatabase } from "./agent.repository.port.js";

/** Host capabilities consumed by participant-agent registry tools. */
export type AgentToolDeps = { agentDatabase?: AgentDatabase };
import { error, success } from '../shared/agent/tool.helpers.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('ChatTools:Agent');

function requireAgentDatabase(deps: AgentToolDeps) {
  if (!deps.agentDatabase) {
    return null;
  }

  return deps.agentDatabase;
}

export function createAgentTools(defineTool: DefineTool, deps: AgentToolDeps) {
  const agentDb = requireAgentDatabase(deps);
  if (!agentDb) {
    return [];
  }

  const registerAgent = defineTool({
    name: 'register_agent',
    description:
      'Register a new personal agent for the current user. ' +
      'Use this when connecting an external agent to Index.',
    querySchema: z.object({
      name: z.string().min(1).describe('Display name for the agent.'),
      description: z.string().optional().describe('What the agent does.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const name = query.name.trim();
        if (!name) {
          return error('Agent name is required.');
        }

        const agent = await agentDb.createAgent({
          ownerId: context.userId,
          name,
          description: query.description?.trim() || undefined,
          type: 'external',
        });

        return success({
          message: `Agent "${agent.name}" registered successfully.`,
          agent,
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
      "Read the agent the owner selected to handle negotiations \u2014 the " +
      'record a running agent identifies itself by. Takes no target: only the ' +
      "calling user's own selected negotiator can be returned.",
    querySchema: z.object({}),
    handler: async ({ context }) => {
      try {
        const agent = await agentDb.getSelectedNegotiator(context.userId);
        if (!agent) {
          return error('No negotiator agent is selected. Pick one in the Index web app.');
        }

        return success({ agent });
      } catch (err) {
        logger.error('Failed to read own agent', { err });
        return error('Failed to read agent. Please try again.');
      }
    },
  });

  const listAgents = defineTool({
    name: 'list_agents',
    description: 'List all agents the current user owns.',
    querySchema: z.object({}),
    handler: async ({ context }) => {
      try {
        const agents = await agentDb.listAgentsForUser(context.userId);
        return success({ agents, count: agents.length });
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

        return success({ message: 'Agent updated.', agent: updated });
      } catch (err) {
        logger.error('Failed to update agent', { err });
        return error('Failed to update agent. Please try again.');
      }
    },
  });

  const deleteAgent = defineTool({
    name: 'delete_agent',
    description: 'Soft-delete a personal agent.',
    querySchema: z.object({
      agent_id: z.string().min(1).describe('The agent ID to delete.'),
    }),
    handler: async ({ context, query }) => {
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

  return [
    readOwnAgent,
    registerAgent,
    listAgents,
    updateAgent,
    deleteAgent,
  ] as const;
}
