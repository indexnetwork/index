/**
 * agents/application — agent registry tools.
 *
 * Provides createAgentTools: `read_own_agent`, which resolves the owner's
 * selected negotiator for a running agent. Agents are created, updated and
 * deleted from a signed-in session over the host's REST surface, never from a
 * credential, so no CRUD tool is registered here.
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

  return [readOwnAgent] as const;
}
