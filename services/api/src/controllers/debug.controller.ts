import { eq, and, sql, desc, asc, min, max, count, inArray, gte, lte } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { canUserSeeOpportunity, isActionableForViewer } from '@indexnetwork/protocol';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { intents, hydeDocuments, intentNetworks, networks, networkMembers, opportunities, negotiations as negotiationsTable, negotiationTurns } from '../schemas/database.schema';
import { conversations, conversationParticipants, conversationMetadata, messages } from '../schemas/conversation.schema';

import { buildIntentAssignmentDiagnostic, buildIntentDebugRecord, buildIntentPipelineHealthDiagnostic, buildVerificationAnalysisDiagnostic } from '../services/debug-intent-diagnostics.service';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { DebugGuard } from '../guards/debug.guard';
import { RateLimit } from '../guards/limiter.guard';

type RouteParams = Record<string, string>;

const logger = log.controller.from('debug');

/**
 * Debug controller exposing diagnostic endpoints for internal use.
 * All routes are gated by DebugGuard (dev-only or explicit opt-in)
 * and AuthGuard (valid JWT or API key required).
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
  @UseGuards(RateLimit('read'), DebugGuard, AuthGuard)
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
        semanticEntropy: intents.semanticEntropy,
        referentialAnchor: intents.referentialAnchor,
        intentMode: intents.intentMode,
        speechActType: intents.speechActType,
        felicityAuthority: intents.felicityAuthority,
        felicitySincerity: intents.felicitySincerity,
        felicityClarity: intents.felicityClarity,
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
        networkId: intentNetworks.networkId,
        networkTitle: networks.title,
        indexPrompt: networks.prompt,
        relevancyScore: intentNetworks.relevancyScore,
        assignmentMetadata: intentNetworks.assignmentMetadata,
      })
      .from(intentNetworks)
      .innerJoin(networks, eq(intentNetworks.networkId, networks.id))
      .where(eq(intentNetworks.intentId, intentId));

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

    const intentResponse = buildIntentDebugRecord(intent);

    const hydeDocumentsResponse = {
      count: hydeStats?.count ?? 0,
      oldestGeneratedAt: hydeStats?.oldestGeneratedAt?.toISOString() ?? null,
      newestGeneratedAt: hydeStats?.newestGeneratedAt?.toISOString() ?? null,
    };

    const indexAssignments = indexRows.map(buildIntentAssignmentDiagnostic);

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
          networkId: o.context?.networkId ?? counterpart?.networkId ?? null,
        };
      }),
    };

    // ── 6. Build diagnosis ────────────────────────────────────────────
    const hasHydeDocuments = (hydeStats?.count ?? 0) > 0;
    const isInAtLeastOneIndex = indexRows.length > 0;
    const hasOpportunities = opportunityRows.length > 0;
    const verificationAnalysis = buildVerificationAnalysisDiagnostic(intent);

    // Check if all opportunities are filtered from the radar (using role-aware helpers)
    const actionableCount = opportunityRows.filter((o) => {
      const actors = o.actors as Array<{ userId: string; role: string; approved?: boolean }>;
      return (
        canUserSeeOpportunity(actors, o.status, user.id) &&
        isActionableForViewer(actors, o.status, user.id)
      );
    }).length;
    const allOpportunitiesFilteredFromRadar = hasOpportunities && actionableCount === 0;

    // Build filterReasons: list non-actionable statuses with counts
    const filterReasons: string[] = [];
    if (allOpportunitiesFilteredFromRadar) {
      for (const [status, cnt] of Object.entries(byStatus)) {
        filterReasons.push(`${status}: ${cnt}`);
      }
    }

    const diagnosis = {
      ...buildIntentPipelineHealthDiagnostic({
        hasEmbedding: intent.hasEmbedding,
        verificationAnalysis,
        hasHydeDocuments,
        isInAtLeastOneIndex,
      }),
      hasOpportunities,
      allOpportunitiesFilteredFromRadar,
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
   * Returns a radar-level diagnostic snapshot for the authenticated user.
   * Gathers intent stats, network memberships, opportunity aggregates,
   * simulated radar-view filtering, and a pipeline-health diagnosis.
   * @param _req - Incoming request (unused beyond guard processing)
   * @param user - Authenticated user from AuthGuard
   * @returns Diagnostic JSON payload for the user's radar view
   */
  @Get('/radar')
  @UseGuards(RateLimit('read'), DebugGuard, AuthGuard)
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
    const inAtLeastOneIndex = indexedIntentIds.size;

    // Orphaned = active but not in any index
    const orphaned = activeIntents.filter((i) => !indexedIntentIds.has(i.id)).length;

    // ── 2. Fetch user's indexes (via networkMembers) ───────────────────────
    const memberIndexRows = await db
      .select({
        networkId: networkMembers.networkId,
        title: networks.title,
      })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(eq(networkMembers.userId, user.id));

    // Count user's intents assigned to each index
    const indexIntentCounts: Record<string, number> = {};
    if (memberIndexRows.length > 0 && totalIntents > 0) {
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
              memberIndexRows.map((r) => sql`${r.networkId}`),
              sql`, `,
            )})`,
          ),
        )
        .groupBy(intentNetworks.networkId);

      for (const row of countRows) {
        indexIntentCounts[row.networkId] = row.count;
      }
    }

    const indexesResponse = memberIndexRows.map((r) => ({
      networkId: r.networkId,
      title: r.title,
      userIntentsAssigned: indexIntentCounts[r.networkId] ?? 0,
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
    const intentsHaveHydeDocuments = hasActiveIntents && withHydeDocuments > 0;
    const intentsAreIndexed = hasActiveIntents && inAtLeastOneIndex > 0;
    const hasOpportunities = opportunityRows.length > 0;
    const opportunitiesReachRadar = cardsReturned > 0;

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
        intentsHaveHydeDocuments,
        intentsAreIndexed,
        hasOpportunities,
        opportunitiesReachRadar,
        bottleneck,
      },
    });
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
  @UseGuards(RateLimit('read'), DebugGuard, AuthGuard)
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

    const meta = (convMeta?.metadata ?? {}) as { title?: string; networkId?: string; _sessionMeta?: unknown };
    const session = {
      id: conv.id,
      title: meta.title ?? null,
      networkId: meta.networkId ?? null,
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

    type NegotiationTurnEntry = {
      turnIndex: number;
      actor: 'initiator' | 'responder';
      action: string;
      message: string;
      createdAt: string;
    };

    type NegotiationDebugEntry = {
      opportunityId: string;
      initiatorUserId: string;
      responderUserId: string;
      awaitingUserId: string | null;
      turns: NegotiationTurnEntry[];
      outcome: { status: string; negotiationOutcome: string | null; turnCount: number } | null;
      startedAt: string;
      endedAt: string;
      durationMs: number;
      turnsTruncated?: boolean;
    };

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
      negotiations?: NegotiationDebugEntry[];
    }> = [];

    // Track raw debugMeta and message createdAt per turn index for later negotiation hydration
    const rawDebugMetaByTurnIndex = new Map<number, Record<string, unknown>>();
    const msgCreatedAtByTurnIndex = new Map<number, Date>();

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

        const turnIndex = turns.length;
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

        // Capture raw debugMeta and message timestamp for negotiation hydration
        if (source && typeof source === 'object') {
          rawDebugMetaByTurnIndex.set(turnIndex, source as Record<string, unknown>);
        }
        if (msg.createdAt) {
          msgCreatedAtByTurnIndex.set(turnIndex, msg.createdAt);
        }
      }
    }

    // ── 5. Hydrate negotiation data for each turn ─────────────────────────
    for (const [turnIndex, rawMeta] of rawDebugMetaByTurnIndex.entries()) {
      // Safely extract orchestratorNegotiations.opportunityIds (pointer path)
      const orchNeg = rawMeta.orchestratorNegotiations;
      const oppIds = orchNeg && typeof orchNeg === 'object'
        ? (orchNeg as Record<string, unknown>).opportunityIds
        : undefined;
      const pointerIds = Array.isArray(oppIds)
        ? oppIds.filter((id): id is string => typeof id === 'string')
        : [];

      let effectiveOpportunityIds: string[] | null = pointerIds.length > 0 ? pointerIds : null;

      // Fallback: if no pointer, query by time-window for legacy messages
      if (!effectiveOpportunityIds) {
        const msgTs = msgCreatedAtByTurnIndex.get(turnIndex);
        if (!msgTs) continue;
        const WINDOW_MS = 10 * 60 * 1000;
        const fromTs = new Date(msgTs.getTime() - WINDOW_MS);
        const toTs = new Date(msgTs.getTime() + WINDOW_MS);
        const oppsInWindow = await db
          .select({ id: opportunities.id })
          .from(opportunities)
          .where(and(
            sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ userId: user.id }])}::jsonb`,
            sql`${opportunities.detection}->>'source' = 'chat'`,
            gte(opportunities.createdAt, fromTs),
            lte(opportunities.createdAt, toTs),
          ));
        if (oppsInWindow.length === 0) continue;
        effectiveOpportunityIds = oppsInWindow.map((o) => o.id);
      }

      const opportunityIds = effectiveOpportunityIds;

      const negotiationRows = await db
        .select()
        .from(negotiationsTable)
        .where(inArray(negotiationsTable.opportunityId, opportunityIds));

      const oppRows = await db
        .select({ id: opportunities.id, status: opportunities.status })
        .from(opportunities)
        .where(inArray(opportunities.id, opportunityIds));
      const oppStatusById = new Map(oppRows.map((o) => [o.id, o.status]));

      const negotiations: NegotiationDebugEntry[] = [];

      for (const negotiation of negotiationRows) {
        const TURN_LIMIT = 20;
        const turnRows = await db
          .select()
          .from(negotiationTurns)
          .where(eq(negotiationTurns.negotiationId, negotiation.id))
          .orderBy(asc(negotiationTurns.turnIndex))
          .limit(TURN_LIMIT + 1);

        const turnsTruncated = turnRows.length > TURN_LIMIT;
        const negTurns: NegotiationTurnEntry[] = turnRows.slice(0, TURN_LIMIT).map((turn) => ({
          turnIndex: turn.turnIndex,
          actor: turn.seatUserId === negotiation.initiatorUserId ? 'initiator' : 'responder',
          action: turn.action,
          message: turn.message,
          createdAt: turn.createdAt.toISOString(),
        }));

        const oppStatus = oppStatusById.get(negotiation.opportunityId) ?? null;
        negotiations.push({
          opportunityId: negotiation.opportunityId,
          initiatorUserId: negotiation.initiatorUserId,
          responderUserId: negotiation.responderUserId,
          awaitingUserId: negotiation.awaitingUserId,
          turns: negTurns,
          outcome: oppStatus !== null
            ? { status: oppStatus, negotiationOutcome: negotiation.outcome, turnCount: negTurns.length }
            : null,
          startedAt: negotiation.createdAt.toISOString(),
          endedAt: negotiation.updatedAt.toISOString(),
          durationMs: negotiation.updatedAt.getTime() - negotiation.createdAt.getTime(),
          ...(turnsTruncated ? { turnsTruncated: true } : {}),
        });
      }

      if (negotiations.length > 0) {
        turns[turnIndex].negotiations = negotiations;
      }
    }

    return Response.json({
      sessionId: session.id,
      exportedAt: new Date().toISOString(),
      title: session.title ?? null,
      networkId: session.networkId ?? null,
      messages: chatMessages,
      turns,
      sessionMetadata: sessionMeta?.metadata ?? null,
    });
  }
}
