import type { Id, Opportunity, OpportunityActor, OpportunityGraphDatabase, OpportunityNetworkEligibility } from '../../shared/interfaces/database.interface.js';

/** Narrow final-boundary port for opportunity persistence admission and guarded reactivation. */
export type OpportunityPersistenceAdmissionPort = Pick<
  OpportunityGraphDatabase,
  'getActiveNetworkMembershipPairs' | 'getNetworkIdsForIntent' | 'getNetworkMemberships' | 'updateOpportunityStatusIfNetworkEligible'
>;

type EvaluatedPersistenceCandidate = {
  actors: Array<{ userId: Id<'users'>; networkId?: Id<'networks'> | null }>;
};

export interface OpportunityPersistenceAdmissionInput<T extends EvaluatedPersistenceCandidate> {
  ownerUserId: Id<'users'>;
  triggerIntentId?: Id<'intents'>;
  networkId?: Id<'networks'>;
  indexScope?: readonly Id<'networks'>[];
  evaluatedOpportunities: readonly T[];
}

export type OpportunityPersistenceAdmission<T extends EvaluatedPersistenceCandidate> =
  | { kind: 'empty_scope' }
  | {
    kind: 'admitted';
    allowedNetworkIds: Id<'networks'>[];
    networkEligibility: OpportunityNetworkEligibility;
    evaluatedOpportunities: T[];
  };

/**
 * Recomputes the owner-side scope at the final write boundary and removes
 * evaluator outputs whose actor/network anchors are no longer active.
 */
export async function admitOpportunityPersistence<T extends EvaluatedPersistenceCandidate>(
  database: OpportunityPersistenceAdmissionPort,
  input: OpportunityPersistenceAdmissionInput<T>,
): Promise<OpportunityPersistenceAdmission<T>> {
  const memberships = await database.getNetworkMemberships(input.ownerUserId);
  let allowedNetworkIds = memberships.map((membership) => membership.networkId);
  if (input.triggerIntentId) {
    const assignments = new Set(await database.getNetworkIdsForIntent(input.triggerIntentId));
    allowedNetworkIds = allowedNetworkIds.filter((networkId) => assignments.has(networkId));
  }
  const explicitScope = input.networkId ? [input.networkId] : input.indexScope;
  if (explicitScope !== undefined) {
    const explicitlyAllowed = new Set(explicitScope);
    allowedNetworkIds = allowedNetworkIds.filter((networkId) => explicitlyAllowed.has(networkId));
  }
  allowedNetworkIds = [...new Set(allowedNetworkIds)];
  if (allowedNetworkIds.length === 0) return { kind: 'empty_scope' };

  const allowedNetworks = new Set(allowedNetworkIds);
  const requestedPairs = input.evaluatedOpportunities.flatMap((evaluated) =>
    evaluated.actors.flatMap((actor) => actor.networkId
      ? [{ userId: actor.userId, networkId: actor.networkId }]
      : []),
  );
  const activePairs = await database.getActiveNetworkMembershipPairs(requestedPairs);
  const activePairKeys = new Set(activePairs.map((pair) => `${pair.userId}\u0000${pair.networkId}`));
  const evaluatedOpportunities = input.evaluatedOpportunities.filter((evaluated) =>
    evaluated.actors.length > 0
    && evaluated.actors.every((actor) =>
      actor.networkId != null
      && allowedNetworks.has(actor.networkId)
      && activePairKeys.has(`${actor.userId}\u0000${actor.networkId}`)),
  );
  return {
    kind: 'admitted',
    allowedNetworkIds,
    networkEligibility: {
      ownerUserId: input.ownerUserId,
      allowedNetworkIds,
      ...(input.triggerIntentId ? { triggerIntentId: input.triggerIntentId } : {}),
    },
    evaluatedOpportunities,
  };
}

export interface EligibleStatusUpdateObserver {
  onUnavailableAdapter?: () => void;
}

/**
 * Produces the guarded status-update handler used when dedup reactivates an
 * existing row. Existing non-introducer actor anchors are rechecked in the
 * same adapter operation as the status transition.
 */
export function createEligibleOpportunityStatusUpdater(
  database: OpportunityPersistenceAdmissionPort,
  allowedNetworkIds: readonly Id<'networks'>[],
  networkEligibility: OpportunityNetworkEligibility,
  observer?: EligibleStatusUpdateObserver,
): (
  opportunityId: string,
  status: Opportunity['status'],
  existingActors: OpportunityActor[],
  expectedStatus: Opportunity['status'],
) => Promise<Opportunity | null> {
  const allowedNetworks = new Set(allowedNetworkIds);
  return async (opportunityId, status, existingActors, expectedStatus) => {
    const anchors = existingActors.filter((actor) => actor.role !== 'introducer');
    if (anchors.length === 0 || anchors.some((actor) => !allowedNetworks.has(actor.networkId))) {
      return null;
    }
    if (!database.updateOpportunityStatusIfNetworkEligible) {
      observer?.onUnavailableAdapter?.();
      return null;
    }
    return database.updateOpportunityStatusIfNetworkEligible(
      opportunityId,
      status,
      anchors,
      networkEligibility,
      expectedStatus,
    );
  };
}
