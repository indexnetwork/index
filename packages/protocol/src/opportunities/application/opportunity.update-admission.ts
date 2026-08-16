import type { Opportunity, OpportunityGraphDatabase, OpportunityStatus } from '../../shared/interfaces/database.interface.js';

/** Narrow persistence read port for authorizing a user-driven opportunity update. */
export type OpportunityUpdateAdmissionPort = Pick<OpportunityGraphDatabase, 'getOpportunity'>;

const BLOCKED_UPDATE_STATUSES = new Set<OpportunityStatus>([
  'accepted',
  'rejected',
  'expired',
  'negotiating',
]);

export interface OpportunityUpdateAdmissionInput {
  opportunityId: string;
  viewerId: string;
  scopedNetworkId?: string;
  selectedIntentScope?: { scopeType?: 'intent'; scopeId?: string };
}

export type OpportunityUpdateAdmission =
  | { kind: 'admitted'; opportunity: Opportunity }
  | { kind: 'denied'; message: string };

function matchesSelectedIntentScope(
  opportunity: Opportunity,
  viewerId: string,
  scope?: { scopeType?: 'intent'; scopeId?: string },
): boolean {
  if (scope?.scopeType !== 'intent' || !scope.scopeId) return true;
  if (opportunity.detection?.triggeredBy === scope.scopeId) return true;
  return opportunity.actors?.some((actor) => actor.userId === viewerId && actor.intent === scope.scopeId) ?? false;
}

/**
 * Authorizes mutation only after an opaque existence/actor check, then applies
 * lifecycle, viewer-network, and selected-intent boundaries in that order.
 */
export async function admitOpportunityUpdate(
  database: OpportunityUpdateAdmissionPort,
  input: OpportunityUpdateAdmissionInput,
): Promise<OpportunityUpdateAdmission> {
  const opportunity = await database.getOpportunity(input.opportunityId);
  if (!opportunity) return { kind: 'denied', message: 'Opportunity not found.' };

  if (!opportunity.actors?.some((actor) => actor.userId === input.viewerId)) {
    return { kind: 'denied', message: 'Opportunity not found.' };
  }
  if (BLOCKED_UPDATE_STATUSES.has(opportunity.status)) {
    return {
      kind: 'denied',
      message: `This opportunity is already ${opportunity.status} and cannot be updated.`,
    };
  }
  if (input.scopedNetworkId && !opportunity.actors?.some(
    (actor) => actor.userId === input.viewerId && actor.networkId === input.scopedNetworkId,
  )) {
    return { kind: 'denied', message: 'Opportunity not found.' };
  }
  if (!matchesSelectedIntentScope(opportunity, input.viewerId, input.selectedIntentScope)) {
    return { kind: 'denied', message: 'Opportunity not found.' };
  }
  return { kind: 'admitted', opportunity };
}
