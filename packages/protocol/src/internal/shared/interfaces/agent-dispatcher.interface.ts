/**
 * AgentDispatcher interface (#1494: negotiation turn dispatch removed —
 * external agents are offline in this PR, see the PR body). What remains is
 * `hasExternalAgent`, still used by the opportunity graph to decide the
 * unlimited-maxTurns rule (IND-410) — an unrelated, still-live concern from
 * negotiation turn authoring.
 */

/**
 * Check whether a user has an authorized external (poller) agent for the
 * given scope. Type-only by design (no heartbeat freshness) — see IND-410.
 */
export interface AgentDispatcher {
  hasExternalAgent(
    userId: string,
    scope: { action: string; scopeType: string; scopeId?: string },
  ): Promise<boolean>;
}
