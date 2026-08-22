import type { ResolvedToolContext } from "../shared/agent/tool.helpers.js";
import type { OpportunityOwnerInteractionProvenance } from "./opportunity.owner-approval.js";

/**
 * Capability-local extension of the resolved tool context for IND-593.
 *
 * The host is the only writer: it binds provenance after authentication and
 * before the registry invokes a tool. Tool input schemas never contain this
 * field, so a caller cannot forge a direct-owner interaction through args or
 * generic context data. Keeping this extension here avoids changing the shared
 * helper that is part of the negotiations/question architecture cycle.
 */
const OWNER_APPROVAL_PROVENANCE = Symbol("ownerApprovalProvenance");

type OwnerApprovalResolvedContext = ResolvedToolContext & {
  readonly [OWNER_APPROVAL_PROVENANCE]: OpportunityOwnerInteractionProvenance;
};

function hasOwnerApprovalProvenance(
  context: ResolvedToolContext,
): context is OwnerApprovalResolvedContext {
  return OWNER_APPROVAL_PROVENANCE in context;
}

/** Bind authoritative host provenance to one resolved tool context. */
export function bindOwnerApprovalProvenance(
  context: ResolvedToolContext,
  provenance: OpportunityOwnerInteractionProvenance,
): void {
  Object.defineProperty(context, OWNER_APPROVAL_PROVENANCE, {
    value: Object.freeze({ ...provenance }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** Read host-bound provenance without accepting any caller-supplied surrogate. */
export function ownerApprovalProvenanceFor(
  context: ResolvedToolContext,
): OpportunityOwnerInteractionProvenance | undefined {
  return hasOwnerApprovalProvenance(context)
    ? context[OWNER_APPROVAL_PROVENANCE]
    : undefined;
}
