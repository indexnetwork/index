/**
 * The opportunity operations that are not discovery.
 *
 * These used to be graph nodes reached through an `operationMode` conditional
 * edge at START — nine one-node paths sharing a state machine they never used.
 * They are plain async functions now; callers invoke the one they mean. Only
 * the discovery pipeline still needs a graph.
 *
 * Each returns the same shape the corresponding node returned, so callers read
 * `readResult` / `mutationResult` exactly as before.
 */

import type { Id, OpportunityActor } from '../../platform/database.js';
import type { EvaluatedOpportunity, EvaluatedOpportunityActor } from './opportunity.state.js';
import type { EvaluatorEntity } from "./opportunity.match-explainer.js";
import { timed } from '../shared/observability/performance.js';
import { safeFallbackSummary } from "./opportunity.presentation.js";
import type { OpportunityMutationResult } from "./opportunity.lifecycle.js";
import { deleteOpportunityLifecycle, updateOpportunityLifecycle } from "./opportunity.lifecycle.js";
import { deleteLog, introEvaluationLog, introValidationLog, readLog, sendLog, updateLog, type OpportunityGraphDeps, type OpportunityState } from "./opportunity.graph.shared.js";

/** Identifies the caller and the opportunity every mutation mode acts on. */
export interface OpportunityMutationRequest {
  userId: Id<'users'>;
  opportunityId: string | undefined;
}

/** Shape the update/delete/send/approve modes return. */
export interface OpportunityMutationOutcome {
  mutationResult: OpportunityMutationResult;
}

/**
 * Read mode: list opportunities for the user, optionally filtered by networkId.
 * Fast path — no LLM calls.
 */
export async function readOpportunities(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: { userId: Id<'users'>; networkId?: Id<'networks'> },
) {
  return timed("OpportunityGraph.read", async () => {
    readLog.verbose('Listing opportunities', {
      userId: request.userId,
      networkId: request.networkId,
    });

    try {
      let indexIdFilter: string | undefined;
      if (request.networkId) {
        const [isMember, isOwner] = await Promise.all([
          deps.database.isNetworkMember(request.networkId, request.userId),
          deps.database.isIndexOwner(request.networkId, request.userId),
        ]);
        if (!isMember && !isOwner) {
          return {
            readResult: { count: 0, opportunities: [], message: 'Network not found or you are not a member.' },
          };
        }
        indexIdFilter = request.networkId;
      }

      const rawList = await deps.database.getOpportunitiesForUser(request.userId, {
        limit: 30,
        ...(indexIdFilter ? { networkId: indexIdFilter } : {}),
      });
      const list = rawList.filter((opp) => opp.status !== 'expired');

      if (list.length === 0) {
        return {
          readResult: {
            count: 0,
            message: 'You have no opportunities yet. Create or refine an approved signal; matching runs in the background. Use list_opportunities later to review persisted results.',
            opportunities: [],
          },
        };
      }

      // Dedupe by counterpart set (same people = one row) so chat does not show "You and X" per index
      const counterpartKey = (opp: (typeof list)[number]) =>
        opp.actors
          .filter((a: OpportunityActor) => a.userId !== request.userId)
          .map((a: OpportunityActor) => a.userId)
          .sort()
          .join(',');
      const byKey = new Map<string, (typeof list)[number]>();
      for (const opp of list) {
        const key = counterpartKey(opp);
        const existing = byKey.get(key);
        const conf = Number(opp.interpretation?.confidence ?? opp.confidence ?? 0);
        const existingConf = existing ? Number(existing.interpretation?.confidence ?? existing.confidence ?? 0) : 0;
        const oppTime = opp.updatedAt instanceof Date ? opp.updatedAt.getTime() : new Date(opp.updatedAt).getTime();
        const existingTime = existing
          ? (existing.updatedAt instanceof Date ? existing.updatedAt.getTime() : new Date(existing.updatedAt).getTime())
          : 0;
        if (!existing || conf > existingConf || (conf === existingConf && oppTime > existingTime)) {
          byKey.set(key, opp);
        }
      }
      const dedupedList = [...byKey.values()];

      const enriched = await Promise.all(
        dedupedList.map(async (opp) => {
          // "Other parties" = every actor who is not the current user.
          const otherParties = opp.actors.filter((a: OpportunityActor) => a.userId !== request.userId);
          const partyIds = otherParties.map((a: OpportunityActor) => a.userId);
          const idsToResolve = partyIds;
          // Use the counterpart's (non-viewer) networkId — it reflects where the match was found.
          // actors[0] is typically the viewer with an arbitrary first-target-index value.
          const counterpartActor = opp.actors.find((a: OpportunityActor) => a.userId !== request.userId);
          const actorIndexId = counterpartActor?.networkId ?? opp.actors[0]?.networkId;
          const [indexRecord, ...profileAndUserPairs] = await Promise.all([
            actorIndexId ? deps.database.getNetwork(actorIndexId) : Promise.resolve(null),
            ...idsToResolve.map(async (uid: string) => {
              const [profile, user] = await Promise.all([
                deps.database.getProfile(uid),
                deps.database.getUser(uid),
              ]);
              return (profile?.identity?.name ?? user?.name ?? 'Unknown') as string;
            }),
          ]);
          const connectedWith = profileAndUserPairs.slice(0, partyIds.length);
          const suggestedBy = null;
          const category = opp.interpretation?.category ?? 'connection';
          const confidence = opp.interpretation?.confidence ?? (opp.confidence ? Number(opp.confidence) : null);
          const source = opp.detection?.source ? (OPPORTUNITY_SOURCE_LABEL[opp.detection.source] ?? opp.detection.source) : null;
          return {
            id: opp.id,
            indexName: indexRecord?.title ?? (actorIndexId ?? ''),
            connectedWith,
            suggestedBy,
            reasoning: safeFallbackSummary(opp.interpretation?.reasoning, {
              counterpartName: connectedWith.join(' and '),
              emptyText: 'Connection opportunity',
            }),
            status: opp.status,
            category,
            confidence: confidence != null ? confidence : null,
            source,
          };
        })
      );

      return {
        readResult: {
          count: enriched.length,
          message: `You have ${enriched.length} opportunity(ies).`,
          opportunities: enriched,
        },
      };
    } catch (err) {
      readLog.error('Failed', { error: err });
      return {
        readResult: { count: 0, opportunities: [], message: 'Failed to list opportunities.' },
      };
    }
  });
}

/** Human-readable label per detection source, for the read-mode listing. */
const OPPORTUNITY_SOURCE_LABEL: Record<string, string> = {
  chat: 'Suggested in chat',
  opportunity_graph: 'System match',
  manual: 'Manual',
  cron: 'Scheduled',
  member_added: 'Member added',
  // Read-only history: nothing stamps this source any more, but old rows carry it.
};

/**
 * Update mode: change opportunity status (accept, reject, etc.).
 * For 'accepted', enforces the self-accept guard: the caller's actor entry
 * must not already have `actedAt` set — i.e. the caller has not yet been
 * the one to advance this opportunity's state. Stamps `actedAt` on accept
 * atomically with the status change via `stampOpportunityActorAction`.
 */
export async function updateOpportunityStatus(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: OpportunityMutationRequest & { newStatus: string | undefined },
): Promise<OpportunityMutationOutcome> {
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

/** Delete mode: expire/archive an opportunity. */
export async function deleteOpportunity(
  deps: Pick<OpportunityGraphDeps, 'database'>,
  request: OpportunityMutationRequest,
): Promise<OpportunityMutationOutcome> {
  return timed("OpportunityGraph.delete", async () => {
    deleteLog.verbose('Expiring opportunity', {
      userId: request.userId,
      opportunityId: request.opportunityId,
    });

    try {
      return {
        mutationResult: await deleteOpportunityLifecycle(deps.database, {
          opportunityId: request.opportunityId,
          actorUserId: request.userId,
        }),
      };
    } catch (err) {
      deleteLog.error('Failed', { error: err });
      return { mutationResult: { success: false, error: 'Failed to delete opportunity.' } };
    }
  });
}
