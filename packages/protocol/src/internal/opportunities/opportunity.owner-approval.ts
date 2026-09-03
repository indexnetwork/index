/**
 * IND-593: protocol-owned owner-approval authority port.
 *
 * Every registered MCP-agent opportunity state change (send/accept/reject)
 * requires an explicit owner-issued, fresh, atomically single-use proof bound
 * to the exact opportunity, target action, owner principal, acting agent, and
 * current server-derived interaction. The protocol owns this verifier/consumer
 * contract and the fail-closed boundary in `update_opportunity`; the host
 * injects the concrete authority (challenge store + signed-proof issuance).
 *
 * Direct authenticated-owner interactions (REST/chat/CLI) traverse the same
 * boundary through `attestOwnerInteraction`: the host attests the
 * server-derived principal and interaction provenance of the already
 * authenticated owner session. Caller-controlled identity or proof-binding
 * fields are never trusted by either path — the binding below is always
 * derived from the resolved tool context.
 *
 * A2A negotiation approvals, agent self-acknowledgment
 * (`acknowledgedUptakeQuestionIds`), and server-generated advisory/challenge
 * values are explicitly NOT substitutes for owner authorization.
 */

/** Owner-gated opportunity actions. `expired` is a system transition and is not gated. */
export type OpportunityOwnerAction = 'send' | 'accept' | 'reject';

/** Maps an update_opportunity target status to its owner-gated action, or null when ungated. */
export function opportunityOwnerActionForStatus(status: string): OpportunityOwnerAction | null {
  switch (status) {
    case 'pending':
      return 'send';
    case 'accepted':
      return 'accept';
    case 'rejected':
      return 'reject';
    default:
      return null;
  }
}

/**
 * Server-derived proof binding. Built exclusively from the resolved tool
 * context and validated tool input — never from caller-supplied binding
 * fields. `agentId` is present exactly when a registered agent acts.
 */
export interface OpportunityOwnerApprovalBinding {
  opportunityId: string;
  action: OpportunityOwnerAction;
  ownerId: string;
  agentId?: string;
}

/** Server-derived transport surface of the current interaction. */
export type OpportunityOwnerInteractionSurface = 'mcp' | 'chat' | 'rest';

/**
 * Trusted interaction/surface provenance for a non-agent tool call (IND-593
 * Batch B). Derived exclusively from the resolved server context — the host
 * composition binds `isSessionAuth` from the authenticated request identity,
 * and the surface follows the composition root (MCP server, chat factory,
 * REST tool service). Tool arguments and caller-supplied fields can never
 * populate it. The host authority attests ONLY a genuine direct owner
 * session (`sessionAuthenticated` on a non-chat surface); chat/CLI/H2A/A2A
 * and other mediated surfaces fail closed with `untrusted_provenance`.
 */
export interface OpportunityOwnerInteractionProvenance {
  surface: OpportunityOwnerInteractionSurface;
  /** True only when the host bound an authenticated owner session (never an API key or a mediated agent) to this exact request. */
  sessionAuthenticated: boolean;
}

/** Attestation input: the server-derived binding plus trusted provenance. */
export type OpportunityOwnerApprovalAttestation = OpportunityOwnerApprovalBinding & {
  provenance: OpportunityOwnerInteractionProvenance;
};

/** Stable, testable denial reasons for the fail-closed owner-approval boundary. */
export type OpportunityOwnerApprovalDenialReason =
  /** No proof presented (or no authority wired); a fresh interaction challenge is attached. */
  | 'missing'
  /** Proof fails authenticity/structure checks (bad signature, unknown interaction, foreign token). */
  | 'forged'
  /** Proof or underlying challenge has expired. */
  | 'stale'
  /** Proof is not bound to an exact opportunities/action/owner/agent/interaction. */
  | 'generic'
  /** Proof binding mismatches the current server-derived binding. */
  | 'wrong_owner'
  | 'wrong_agent'
  | 'wrong_action'
  | 'wrong_opportunity'
  /** Proof was already consumed; single-use is atomic. */
  | 'replayed'
  /** The interaction's server-derived provenance cannot mint or attest owner authority; an owner-issued proof is required. */
  | 'untrusted_provenance'
  /** The authority's store or configuration failed; nothing is admitted. */
  | 'unavailable';

/**
 * Fresh, server-derived interaction challenge returned with a `missing`
 * denial. The owner explicitly approves this exact interaction (bound to the
 * full server-derived binding) to obtain a one-time proof.
 */
export interface OpportunityOwnerApprovalChallenge {
  interactionId: string;
  expiresAt: string;
}

export type OpportunityOwnerApprovalVerdict =
  | { kind: 'admitted' }
  | {
      kind: 'denied';
      reason: OpportunityOwnerApprovalDenialReason;
      challenge?: OpportunityOwnerApprovalChallenge;
    };

/**
 * Authoritative owner-proof verifier/consumer, injected by the host.
 * Implementations MUST fail closed and MUST make consumption atomically
 * single-use: a denied verification never consumes a proof; a successful one
 * consumes it exactly once, even under concurrent calls.
 */
export interface OpportunityOwnerApprovalAuthority {
  /**
   * Verify and atomically consume an agent-presented proof against the
   * server-derived binding. When `proof` is undefined the implementation
   * registers the current interaction as a fresh challenge and denies with
   * reason `missing`, attaching the challenge so the agent can relay it to the
   * owner for explicit approval.
   */
  consumeAgentProof(
    proof: string | undefined,
    binding: OpportunityOwnerApprovalBinding & { agentId: string },
  ): Promise<OpportunityOwnerApprovalVerdict>;
  /**
   * Traverse the same boundary for a non-agent interaction. The host attests
   * ONLY a genuine direct authenticated-owner session, judged from the
   * server-derived principal and interaction/surface provenance — this is
   * authoritative host derivation, not a bypass. Mediated surfaces
   * (chat/CLI/H2A/A2A) and absent or malformed provenance fail closed with
   * `untrusted_provenance`.
   */
  attestOwnerInteraction(
    binding: OpportunityOwnerApprovalAttestation,
  ): Promise<OpportunityOwnerApprovalVerdict>;
}
