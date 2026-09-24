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
import { timed } from '../shared/observability/performance.js';
import { safeFallbackSummary } from "./opportunity.presentation.js";
import type { OpportunityDatabase } from '../../platform/database.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const readLog = protocolLogger('Opportunity:Read');

/**
 * Read mode: list opportunities for the user, optionally filtered by networkId.
 * Fast path — no LLM calls.
 */
export async function readOpportunities(
  deps: { database: OpportunityDatabase },
  request: { userId: Id<'users'>; networkId?: Id<'networks'> },
) {
  return timed("OpportunityGraph.read", async () => {
    readLog.verbose('Listing opportunities', {
      userId: request.userId,
      networkId: request.networkId,
    });

    try {
      let networkIdFilter: string | undefined;
      if (request.networkId) {
        const [isMember, isOwner] = await Promise.all([
          deps.database.isNetworkMember(request.networkId, request.userId),
          deps.database.isNetworkOwner(request.networkId, request.userId),
        ]);
        if (!isMember && !isOwner) {
          return {
            readResult: { count: 0, opportunities: [], message: 'Network not found or you are not a member.' },
          };
        }
        networkIdFilter = request.networkId;
      }

      const rawList = await deps.database.getOpportunitiesForUser(request.userId, {
        limit: 30,
        ...(networkIdFilter ? { networkId: networkIdFilter } : {}),
      });
      const list = rawList.filter((opp) => opp.status !== 'expired');

      if (list.length === 0) {
        return {
          readResult: {
            count: 0,
            message: 'You have no opportunities yet. Create or refine an approved signal; matching runs in the background. Review persisted results later from the opportunities read.',
            opportunities: [],
          },
        };
      }

      // Dedupe by counterpart set (same people = one row) so chat does not show "You and X" per network
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
          // actors[0] is typically the viewer with an arbitrary first-target-network value.
          const counterpartActor = opp.actors.find((a: OpportunityActor) => a.userId !== request.userId);
          const actorNetworkId = counterpartActor?.networkId ?? opp.actors[0]?.networkId;
          const [networkRecord, ...profileAndUserPairs] = await Promise.all([
            actorNetworkId ? deps.database.getNetwork(actorNetworkId) : Promise.resolve(null),
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
            networkName: networkRecord?.title ?? (actorNetworkId ?? ''),
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
