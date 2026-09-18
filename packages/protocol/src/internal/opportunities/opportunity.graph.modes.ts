/**
 * The opportunity status update: a plain async function, not a graph node.
 * Only the discovery pipeline still needs a graph.
 */

import type { Id, OpportunityDatabase } from '../../platform/database.js';
import { timed } from '../shared/observability/performance.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { updateOpportunityLifecycle, type OpportunityMutationResult } from "./opportunity.lifecycle.js";

const updateLog = protocolLogger('Opportunity:Update');

/**
 * Change opportunity status (accept, reject, etc.).
 * For 'accepted', enforces the self-accept guard: the caller's actor entry
 * must not already have `actedAt` set — i.e. the caller has not yet been
 * the one to advance this opportunity's state. Stamps `actedAt` on accept
 * atomically with the status change via `stampOpportunityActorAction`.
 */
export async function updateOpportunityStatus(
  deps: { database: OpportunityDatabase },
  request: { userId: Id<'users'>; opportunityId: string | undefined; newStatus: string | undefined },
): Promise<{ mutationResult: OpportunityMutationResult }> {
  return timed("OpportunityGraph.update", async () => {
    updateLog.verbose('Updating opportunity status', {
      userId: request.userId,
      opportunityId: request.opportunityId,
      newStatus: request.newStatus,
    });

    try {
      return {
        mutationResult: await updateOpportunityLifecycle(deps.database, {
          opportunityId: request.opportunityId,
          actorUserId: request.userId,
          newStatus: request.newStatus,
        }),
      };
    } catch (err) {
      updateLog.error('Failed', { error: err });
      return { mutationResult: { success: false, error: 'Failed to update opportunity.' } };
    }
  });
}
