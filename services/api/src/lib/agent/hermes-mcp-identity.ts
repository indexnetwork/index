import type { McpResolvedIdentity } from '@indexnetwork/protocol';

/**
 * Project an already validated standalone Hermes credential into the trusted
 * MCP identity marker consumed by the capability policy.
 */
export function projectHermesAgentMcpIdentity(input: {
  ownerId: string;
  agentId: string;
}): McpResolvedIdentity {
  return {
    userId: input.ownerId,
    agentId: input.agentId,
    isHermesAgent: true,
    networkScopeId: null,
  };
}
