/**
 * AgentDispatcher is only an external-agent availability lookup. Authored
 * external negotiation turns enter through MCP and NegotiationGraph.
 */

/**
 * Check whether a user has an authorized external agent for the
 * given scope. Type-only by design (no heartbeat freshness) — see IND-410.
 */
export interface AgentDispatcher {
  hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean>;
}
