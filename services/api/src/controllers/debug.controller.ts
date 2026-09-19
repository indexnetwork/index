import { eq, and, sql, desc, count } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { canUserSeeOpportunity, isActionableForViewer } from '@indexnetwork/protocol';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { intents, intentNetworks, networks, networkMembers, opportunities } from '../schemas/database.schema';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { DebugGuard } from '../guards/debug.guard';

const logger = log.controller.from('debug');

/**
 * Debug controller exposing diagnostic endpoints for internal use.
 * All routes are gated by DebugGuard (dev-only or explicit opt-in)
 * and AuthGuard (valid JWT or API key required).
 *
 * @remarks Read-only diagnostic endpoints query the database directly (known
 * exception for debug-only code).
 */
@Controller('/debug')
export class DebugController {

  /**
   * Returns a radar-level diagnostic snapshot for the authenticated user.
   * Gathers intent stats, network memberships, opportunity aggregates,
   * simulated radar-view filtering, and a pipeline-health diagnosis.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @returns Diagnostic JSON payload for the user's radar view
   */
  @Get('/radar')
  @UseGuards(DebugGuard, AuthGuard)
  async getRadarDebug(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Radar debug request', { userId: user.id });

    // ── 1. Fetch user's intents ──────────────────────────────────────────
    const userIntents = await db
      .select({
        id: intents.id,
        hasEmbedding: sql<boolean>`${intents.embedding} IS NOT NULL`.as('has_embedding'),
        isArchived: sql<boolean>`${intents.archivedAt} IS NOT NULL`.as('is_archived'),
      })
      .from(intents)
      .where(eq(intents.userId, user.id));

    const totalIntents = userIntents.length;
    const activeIntents = userIntents.filter((i) => !i.isArchived);
    const archivedIntents = userIntents.filter((i) => i.isArchived);
    const withEmbeddings = activeIntents.filter((i) => i.hasEmbedding).length;

    // Count active intents assigned to at least one network
    const indexedIntentRows = activeIntents.length > 0
      ? await db
          .selectDistinct({ intentId: intentNetworks.intentId })
          .from(intentNetworks)
          .where(
            sql`${intentNetworks.intentId} IN (${sql.join(
              activeIntents.map((i) => sql`${i.id}`),
              sql`, `,
            )})`,
          )
      : [];
    const indexedIntentIds = new Set(indexedIntentRows.map((r) => r.intentId));
    const inAtLeastOneNetwork = indexedIntentIds.size;

    // Orphaned = active but not in any network
    const orphaned = activeIntents.filter((i) => !indexedIntentIds.has(i.id)).length;

    // ── 2. Fetch user's networks (via networkMembers) ───────────────────────
    const memberNetworkRows = await db
      .select({
        networkId: networkMembers.networkId,
        title: networks.title,
      })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(eq(networkMembers.userId, user.id));

    // Count user's intents assigned to each network
    const networkIntentCounts: Record<string, number> = {};
    if (memberNetworkRows.length > 0 && totalIntents > 0) {
      const countRows = await db
        .select({
          networkId: intentNetworks.networkId,
          count: count().as('count'),
        })
        .from(intentNetworks)
        .where(
          and(
            sql`${intentNetworks.intentId} IN (${sql.join(
              userIntents.map((i) => sql`${i.id}`),
              sql`, `,
            )})`,
            sql`${intentNetworks.networkId} IN (${sql.join(
              memberNetworkRows.map((r) => sql`${r.networkId}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(intentNetworks.networkId);

      for (const row of countRows) {
        networkIntentCounts[row.networkId] = row.count;
      }
    }

    const networksResponse = memberNetworkRows.map((r) => ({
      networkId: r.networkId,
      title: r.title,
      userIntentsAssigned: networkIntentCounts[r.networkId] ?? 0,
    }));

    // ── 3. Fetch all opportunities for the user ──────────────────────────
    const opportunityRows = await db
      .select({
        id: opportunities.id,
        actors: opportunities.actors,
        status: opportunities.status,
        confidence: opportunities.confidence,
        createdAt: opportunities.createdAt,
      })
      .from(opportunities)
      .where(
        sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ userId: user.id }])}::jsonb`,
      )
      .orderBy(desc(opportunities.createdAt));

    // Aggregate by status
    const oppByStatus: Record<string, number> = {};
    for (const o of opportunityRows) {
      oppByStatus[o.status] = (oppByStatus[o.status] ?? 0) + 1;
    }

    // ── 4. Simulate radar view filtering ──────────────────────────────────
    let notVisible = 0;
    let notActionable = 0;
    const seenCounterparts = new Set<string>();
    let duplicateCounterpart = 0;
    let cardsReturned = 0;

    for (const opp of opportunityRows) {
      const actors = opp.actors as Array<{ userId: string; role: string; approved?: boolean }>;

      if (!canUserSeeOpportunity(actors, opp.status, user.id)) {
        notVisible++;
        continue;
      }

      if (!isActionableForViewer(actors, opp.status, user.id)) {
        notActionable++;
        continue;
      }

      // Dedup by counterpart userId
      const counterpart = actors.find((a) => a.userId !== user.id);
      if (counterpart) {
        if (seenCounterparts.has(counterpart.userId)) {
          duplicateCounterpart++;
          continue;
        }
        seenCounterparts.add(counterpart.userId);
      }

      cardsReturned++;
    }

    // ── 5. Build diagnosis ───────────────────────────────────────────────
    const hasActiveIntents = activeIntents.length > 0;
    const intentsHaveEmbeddings = hasActiveIntents && withEmbeddings > 0;
    const intentsAreIndexed = hasActiveIntents && inAtLeastOneNetwork > 0;
    const hasOpportunities = opportunityRows.length > 0;
    const opportunitiesReachRadar = cardsReturned > 0;

    let bottleneck: string | null = null;
    if (!hasActiveIntents) {
      bottleneck = 'No active intents';
    } else if (!intentsAreIndexed) {
      bottleneck = `${orphaned} active intents not assigned to any network`;
    } else if (!hasOpportunities) {
      bottleneck = 'No opportunities discovered yet';
    } else if (!opportunitiesReachRadar) {
      bottleneck = `All ${opportunityRows.length} opportunities filtered out of radar view`;
    }

    return Response.json({
      exportedAt: new Date().toISOString(),
      userId: user.id,
      intents: {
        total: totalIntents,
        byStatus: {
          active: activeIntents.length,
          archived: archivedIntents.length,
        },
        withEmbeddings,
        inAtLeastOneNetwork,
        orphaned,
      },
      networks: networksResponse,
      opportunities: {
        total: opportunityRows.length,
        byStatus: oppByStatus,
        actionable: cardsReturned,
      },
      radarView: {
        cardsReturned,
        filteredOut: {
          notActionable,
          duplicateCounterpart,
          notVisible,
        },
      },
      diagnosis: {
        hasActiveIntents,
        intentsHaveEmbeddings,
        intentsAreIndexed,
        hasOpportunities,
        opportunitiesReachRadar,
        bottleneck,
      },
    });
  }

}
