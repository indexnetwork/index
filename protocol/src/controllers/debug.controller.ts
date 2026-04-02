import { eq, and, sql, desc, asc, inArray, min, max, count } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
// TODO: fix layering violation — controller should not import protocol directly
// eslint-disable-next-line boundaries/dependencies
import { canUserSeeOpportunity, isActionableForViewer } from '../lib/protocol/support/opportunity.utils';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import {
  intents,
  hydeDocuments,
  intentIndexes,
  indexes,
  indexMembers,
  opportunities,
} from '../schemas/database.schema';
import {
  conversations,
  conversationParticipants,
  conversationMetadata,
  messages,
} from '../schemas/conversation.schema';
import { debugService } from '../services/debug.service';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { DebugGuard } from '../guards/debug.guard';

type RouteParams = Record<string, string>;

const logger = log.controller.from('debug');

/**
 * Debug controller exposing diagnostic endpoints for internal use.
 * All routes are gated by DebugGuard (dev-only or explicit opt-in)
 * and AuthGuard (valid JWT required).
 *
 * @remarks Read-only diagnostic endpoints query the database directly (known
 * exception for debug-only code). The discovery runner delegates to
 * {@link DebugService} for adapter instantiation and graph execution.
 */
@Controller('/debug')
export class DebugController {
  /**
   * Returns a full diagnostic snapshot for a single intent.
   * Gathers the intent record, HyDE document stats, index assignments,
   * related opportunities, and a pipeline-health diagnosis object.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the intent `id`
   * @returns Diagnostic JSON payload
   */
  @Get('/intents/:id')
  @UseGuards(DebugGuard, AuthGuard)
  async getIntentDebug(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const intentId = params?.id;
    if (!intentId) {
      return Response.json({ error: 'Intent ID is required' }, { status: 400 });
    }

    logger.verbose('Intent debug request', { intentId, userId: user.id });

    // ── 1. Fetch intent record (scoped to authenticated user) ─────────
    const [intent] = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        confidence: intents.semanticEntropy,
        inferenceType: intents.intentMode,
        sourceType: intents.sourceType,
        hasEmbedding: sql<boolean>`${intents.embedding} IS NOT NULL`.as('has_embedding'),
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        archivedAt: intents.archivedAt,
      })
      .from(intents)
      .where(and(eq(intents.id, intentId), eq(intents.userId, user.id)))
      .limit(1);

    if (!intent) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }

    // ── 2. Fetch HyDE document stats ──────────────────────────────────
    const [hydeStats] = await db
      .select({
        count: count().as('count'),
        oldestGeneratedAt: min(hydeDocuments.createdAt).as('oldest'),
        newestGeneratedAt: max(hydeDocuments.createdAt).as('newest'),
      })
      .from(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, 'intent'),
          eq(hydeDocuments.sourceId, intentId),
        ),
      );

    // ── 3. Fetch index assignments with title and prompt ──────────────
    const indexRows = await db
      .select({
        indexId: intentIndexes.indexId,
        indexTitle: indexes.title,
        indexPrompt: indexes.prompt,
      })
      .from(intentIndexes)
      .innerJoin(indexes, eq(intentIndexes.indexId, indexes.id))
      .where(eq(intentIndexes.intentId, intentId));

    // ── 4. Fetch opportunities referencing this intent ─────────────────
    const opportunityRows = await db
      .select({
        id: opportunities.id,
        actors: opportunities.actors,
        confidence: opportunities.confidence,
        status: opportunities.status,
        createdAt: opportunities.createdAt,
        context: opportunities.context,
      })
      .from(opportunities)
      .where(
        sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ intent: intentId }])}::jsonb`,
      )
      .orderBy(desc(opportunities.createdAt));

    // ── 5. Build response shapes ──────────────────────────────────────

    const intentResponse = {
      id: intent.id,
      text: intent.payload,
      summary: intent.summary,
      status: intent.archivedAt ? 'archived' : 'active',
      confidence: intent.confidence,
      inferenceType: intent.inferenceType,
      sourceType: intent.sourceType,
      hasEmbedding: intent.hasEmbedding,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    };

    const hydeDocumentsResponse = {
      count: hydeStats?.count ?? 0,
      oldestGeneratedAt: hydeStats?.oldestGeneratedAt?.toISOString() ?? null,
      newestGeneratedAt: hydeStats?.newestGeneratedAt?.toISOString() ?? null,
    };

    const indexAssignments = indexRows.map((r) => ({
      indexId: r.indexId,
      indexTitle: r.indexTitle,
      indexPrompt: r.indexPrompt,
    }));

    // Aggregate opportunities by status
    const byStatus: Record<string, number> = {};
    for (const o of opportunityRows) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    }

    const opportunitiesResponse = {
      total: opportunityRows.length,
      byStatus,
      items: opportunityRows.map((o) => {
        // Find the counterpart actor (the one whose intent is NOT this one)
        const counterpart = o.actors.find((a) => a.intent !== intentId);
        return {
          opportunityId: o.id,
          counterpartUserId: counterpart?.userId ?? null,
          confidence: Number(o.confidence),
          status: o.status,
          createdAt: o.createdAt.toISOString(),
          indexId: o.context?.indexId ?? counterpart?.indexId ?? null,
        };
      }),
    };

    // ── 6. Build diagnosis ────────────────────────────────────────────
    const hasHydeDocuments = (hydeStats?.count ?? 0) > 0;
    const isInAtLeastOneIndex = indexRows.length > 0;
    const hasOpportunities = opportunityRows.length > 0;

    // Check if all opportunities are filtered from home (using role-aware helpers)
    const actionableCount = opportunityRows.filter((o) => {
      const actors = o.actors as Array<{ userId: string; role: string }>;
      return (
        canUserSeeOpportunity(actors, o.status, user.id) &&
        isActionableForViewer(actors, o.status, user.id)
      );
    }).length;
    const allOpportunitiesFilteredFromHome = hasOpportunities && actionableCount === 0;

    // Build filterReasons: list non-actionable statuses with counts
    const filterReasons: string[] = [];
    if (allOpportunitiesFilteredFromHome) {
      for (const [status, cnt] of Object.entries(byStatus)) {
        filterReasons.push(`${status}: ${cnt}`);
      }
    }

    const diagnosis = {
      hasEmbedding: intent.hasEmbedding,
      hasHydeDocuments,
      isInAtLeastOneIndex,
      hasOpportunities,
      allOpportunitiesFilteredFromHome,
      filterReasons,
    };

    return Response.json({
      exportedAt: new Date().toISOString(),
      intent: intentResponse,
      hydeDocuments: hydeDocumentsResponse,
      indexAssignments,
      opportunities: opportunitiesResponse,
      diagnosis,
    });
  }

  /**
   * Returns a home-level diagnostic snapshot for the authenticated user.
   * Gathers intent stats, index memberships, opportunity aggregates,
   * simulated home-view filtering, and a pipeline-health diagnosis.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @returns Diagnostic JSON payload for the user's home view
   */
  @Get('/home')
  @UseGuards(DebugGuard, AuthGuard)
  async getHomeDebug(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Home debug request', { userId: user.id });

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

    // Count active intents that have at least one HyDE document
    const hydeIntentRows = activeIntents.length > 0
      ? await db
          .selectDistinct({ sourceId: hydeDocuments.sourceId })
          .from(hydeDocuments)
          .where(
            and(
              eq(hydeDocuments.sourceType, 'intent'),
              sql`${hydeDocuments.sourceId} IN (${sql.join(
                activeIntents.map((i) => sql`${i.id}`),
                sql`, `,
              )})`,
            ),
          )
      : [];
    const withHydeDocuments = hydeIntentRows.length;

    // Count active intents assigned to at least one index
    const indexedIntentRows = activeIntents.length > 0
      ? await db
          .selectDistinct({ intentId: intentIndexes.intentId })
          .from(intentIndexes)
          .where(
            sql`${intentIndexes.intentId} IN (${sql.join(
              activeIntents.map((i) => sql`${i.id}`),
              sql`, `,
            )})`,
          )
      : [];
    const indexedIntentIds = new Set(indexedIntentRows.map((r) => r.intentId));
    const inAtLeastOneIndex = indexedIntentIds.size;

    // Orphaned = active but not in any index
    const orphaned = activeIntents.filter((i) => !indexedIntentIds.has(i.id)).length;

    // ── 2. Fetch user's indexes (via indexMembers) ───────────────────────
    const memberIndexRows = await db
      .select({
        indexId: indexMembers.indexId,
        title: indexes.title,
      })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(eq(indexMembers.userId, user.id));

    // Count user's intents assigned to each index
    const indexIntentCounts: Record<string, number> = {};
    if (memberIndexRows.length > 0 && totalIntents > 0) {
      const countRows = await db
        .select({
          indexId: intentIndexes.indexId,
          count: count().as('count'),
        })
        .from(intentIndexes)
        .where(
          and(
            sql`${intentIndexes.intentId} IN (${sql.join(
              userIntents.map((i) => sql`${i.id}`),
              sql`, `,
            )})`,
            sql`${intentIndexes.indexId} IN (${sql.join(
              memberIndexRows.map((r) => sql`${r.indexId}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(intentIndexes.indexId);

      for (const row of countRows) {
        indexIntentCounts[row.indexId] = row.count;
      }
    }

    const indexesResponse = memberIndexRows.map((r) => ({
      indexId: r.indexId,
      title: r.title,
      userIntentsAssigned: indexIntentCounts[r.indexId] ?? 0,
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

    // ── 4. Simulate home view filtering ──────────────────────────────────
    let notVisible = 0;
    let notActionable = 0;
    const seenCounterparts = new Set<string>();
    let duplicateCounterpart = 0;
    let cardsReturned = 0;

    for (const opp of opportunityRows) {
      const actors = opp.actors as Array<{ userId: string; role: string }>;

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
    const intentsHaveHydeDocuments = hasActiveIntents && withHydeDocuments > 0;
    const intentsAreIndexed = hasActiveIntents && inAtLeastOneIndex > 0;
    const hasOpportunities = opportunityRows.length > 0;
    const opportunitiesReachHome = cardsReturned > 0;

    let bottleneck: string | null = null;
    if (!hasActiveIntents) {
      bottleneck = 'No active intents';
    } else if (!intentsHaveEmbeddings) {
      const missing = activeIntents.filter((i) => !i.hasEmbedding).length;
      bottleneck = `${missing} intents missing embeddings`;
    } else if (!intentsHaveHydeDocuments) {
      const missingHyde = activeIntents.filter(
        (i) => !hydeIntentRows.some((h) => h.sourceId === i.id),
      ).length;
      bottleneck = `${missingHyde} intents missing HyDE documents`;
    } else if (!intentsAreIndexed) {
      bottleneck = `${orphaned} active intents not assigned to any index`;
    } else if (!hasOpportunities) {
      bottleneck = 'No opportunities discovered yet';
    } else if (!opportunitiesReachHome) {
      bottleneck = `All ${opportunityRows.length} opportunities filtered out of home view`;
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
        withHydeDocuments,
        inAtLeastOneIndex,
        orphaned,
      },
      indexes: indexesResponse,
      opportunities: {
        total: opportunityRows.length,
        byStatus: oppByStatus,
        actionable: cardsReturned,
      },
      homeView: {
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
        intentsHaveHydeDocuments,
        intentsAreIndexed,
        hasOpportunities,
        opportunitiesReachHome,
        bottleneck,
      },
    });
  }

  /**
   * Runs the opportunity discovery pipeline for a specific intent and returns
   * the full graph trace. WARNING: This DOES persist results (creates/reactivates
   * opportunities). Gated by DebugGuard (dev/staging only).
   * Use this to diagnose why background discovery produces no matches.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the intent `id`
   * @returns Full discovery trace with candidates, evaluation, and persist results
   */
  @Post('/intents/:id/discover')
  @UseGuards(DebugGuard, AuthGuard)
  async runIntentDiscoveryDebug(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const intentId = params?.id;
    if (!intentId) {
      return Response.json({ error: 'Intent ID is required' }, { status: 400 });
    }

    logger.verbose('Intent discovery debug request', { intentId, userId: user.id });

    // ── 1. Gather pre-flight diagnostics ────────────────────────────────
    const preflightResult = await debugService.getDiscoveryPreflight(intentId, user.id);
    if (!preflightResult) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }

    const { preflight, intentPayload, userIndexIds } = preflightResult;

    // ── 2. Bail early if no candidate pool ──────────────────────────────
    if (userIndexIds.length === 0) {
      return Response.json({
        exportedAt: new Date().toISOString(),
        preflight,
        result: null,
        diagnosis: 'User has no index memberships — cannot discover opportunities.',
      });
    }
    if (preflight.candidatePool.otherMembersInIndexes === 0) {
      return Response.json({
        exportedAt: new Date().toISOString(),
        preflight,
        result: null,
        diagnosis: 'No other members in user\'s indexes — no candidates to match against.',
      });
    }

    // ── 3. Run the opportunity graph ────────────────────────────────────
    try {
      const result = await debugService.runDiscoveryGraph(intentId, user.id, intentPayload);

      return Response.json({
        exportedAt: new Date().toISOString(),
        preflight,
        result,
      });
    } catch (err) {
      logger.error('Intent discovery debug failed', { intentId, error: err });
      return Response.json({
        exportedAt: new Date().toISOString(),
        preflight,
        result: null,
        diagnosis: `Graph execution failed: ${err instanceof Error ? err.message : String(err)}`,
      }, { status: 500 });
    }
  }

  /**
   * Returns a debug-friendly view of a chat session and its messages.
   * Includes message list plus per-turn debug metadata (graph, iterations, tools)
   * extracted from the message's subgraphResults JSONB field.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the session `id`
   * @returns Diagnostic JSON payload for the chat session
   */
  @Get('/chat/:id')
  @UseGuards(DebugGuard, AuthGuard)
  async getChatDebug(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const sessionId = params?.id;
    if (!sessionId) {
      return Response.json({ error: 'Session ID is required' }, { status: 400 });
    }

    logger.verbose('Chat debug request', { sessionId, userId: user.id });

    // ── 1. Fetch session (scoped to authenticated user) ──────────────────
    // Verify the user is a participant of this conversation
    const [participant] = await db
      .select({ participantId: conversationParticipants.participantId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, sessionId),
          eq(conversationParticipants.participantId, user.id),
          eq(conversationParticipants.participantType, 'user'),
        ),
      )
      .limit(1);

    if (!participant) {
      return Response.json({ error: 'Chat session not found' }, { status: 404 });
    }

    // Fetch conversation + metadata
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, sessionId))
      .limit(1);

    if (!conv) {
      return Response.json({ error: 'Chat session not found' }, { status: 404 });
    }

    const [convMeta] = await db
      .select({ metadata: conversationMetadata.metadata })
      .from(conversationMetadata)
      .where(eq(conversationMetadata.conversationId, sessionId))
      .limit(1);

    const meta = (convMeta?.metadata ?? {}) as { title?: string; indexId?: string; _sessionMeta?: unknown };
    const session = {
      id: conv.id,
      title: meta.title ?? null,
      indexId: meta.indexId ?? null,
      userId: user.id,
    };

    // ── 2. Fetch messages ordered by creation time ───────────────────────
    const rawMessageRows = await db
      .select({
        id: messages.id,
        role: messages.role,
        parts: messages.parts,
        metadata: messages.metadata,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, sessionId))
      .orderBy(asc(messages.createdAt));

    // Map to a shape compatible with the rest of the method
    const messageRows = rawMessageRows.map((m) => {
      const parts = m.parts as Array<{ type?: string; text?: string }>;
      const content = parts?.[0]?.text ?? '';
      const msgMeta = (m.metadata ?? {}) as Record<string, unknown>;
      const mappedRole = m.role === 'agent' ? 'assistant' : 'user';
      return {
        id: m.id,
        role: mappedRole as 'user' | 'assistant' | 'system',
        content,
        routingDecision: msgMeta.routingDecision ?? null,
        subgraphResults: msgMeta.subgraphResults ?? null,
        debugMeta: msgMeta.debugMeta ?? null,
        createdAt: m.createdAt,
      };
    });

    // ── 3. Build metadata map from messages.metadata ─────────────────────
    const metadataByMessageId = new Map(
      messageRows
        .filter((m) => m.role === 'assistant' && m.debugMeta)
        .map((m) => [m.id, { messageId: m.id, debugMeta: m.debugMeta }]),
    );

    // Fetch session metadata
    const sessionMeta = meta._sessionMeta ? { metadata: meta._sessionMeta } : null;

    // ── 4. Build messages and turns ──────────────────────────────────────
    const chatMessages: Array<{ role: string; content: string }> = [];
    const turns: Array<{
      messageIndex: number;
      graph: string | null;
      iterations: number | null;
      tools: Array<{
        name: string;
        args: Record<string, unknown>;
        resultSummary: string;
        success: boolean;
        durationMs: number;
        steps: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
        graphs: Array<{
          name: string;
          durationMs: number;
          agents: Array<{ name: string; durationMs: number }>;
        }>;
      }>;
    }> = [];

    for (const msg of messageRows) {
      const messageIndex = chatMessages.length;
      chatMessages.push({ role: msg.role, content: msg.content });

      if (msg.role === 'assistant') {
        const msgMetadata = metadataByMessageId.get(msg.id);
        const debugMetaFromMetadata = msgMetadata?.debugMeta as {
          graph?: string;
          iterations?: number;
          tools?: Array<{
            name: string;
            args?: Record<string, unknown>;
            resultSummary?: string;
            success?: boolean;
            durationMs?: number;
            steps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>;
            graphs?: Array<{
              name: string;
              durationMs: number;
              agents: Array<{ name: string; durationMs: number }>;
            }>;
          }>;
        } | undefined;

        // Fall back to subgraphResults for older messages without metadata
        const fallbackMeta = !debugMetaFromMetadata
          ? (msg.subgraphResults as Record<string, unknown> | null)?.debugMeta as typeof debugMetaFromMetadata
          : undefined;
        const source = debugMetaFromMetadata ?? fallbackMeta;

        turns.push({
          messageIndex,
          graph: source?.graph ?? null,
          iterations: typeof source?.iterations === 'number' ? source.iterations : null,
          tools: Array.isArray(source?.tools)
            ? source.tools.map((t) => ({
                name: t.name ?? 'unknown',
                args: t.args ?? {},
                resultSummary: t.resultSummary ?? '',
                success: t.success ?? true,
                durationMs: t.durationMs ?? 0,
                steps: t.steps ?? [],
                graphs: t.graphs ?? [],
              }))
            : [],
        });
      }
    }

    return Response.json({
      sessionId: session.id,
      exportedAt: new Date().toISOString(),
      title: session.title ?? null,
      indexId: session.indexId ?? null,
      messages: chatMessages,
      turns,
      sessionMetadata: sessionMeta?.metadata ?? null,
    });
  }
}
