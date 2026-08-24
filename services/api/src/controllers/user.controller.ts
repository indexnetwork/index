import { z } from 'zod';

import { Controller, Delete, Get, Patch, Put, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { deprecatedRoute } from '../lib/router/deprecated-route';
import { userService } from '../services/user.service';
import { TaskService } from '../services/task.service';
import { negotiatorMemoryInspectionService } from '../services/negotiator-memory-inspection.service';
import type { NegotiatorMemory, NegotiatorMemoryKind } from '../schemas/database.schema';
import { NegotiationInsightsGenerator } from '@indexnetwork/protocol';
import type { NegotiationDigest } from '@indexnetwork/protocol';

import { log } from '../lib/log';

const logger = log.controller.from('user');

const BATCH_MAX_IDS = 100;

const NEGOTIATOR_MEMORY_KINDS = ['playbook', 'disclosure_rule', 'counterparty_dossier', 'threshold'] as const;

const UpdateNegotiatorMemoryBodySchema = z
  .object({
    content: z.string().trim().min(1).max(4000).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((b) => b.content !== undefined || b.confidence !== undefined, {
    message: 'Provide content and/or confidence',
  });

/** Maps a memory row to the owner-facing DTO (no embedding — it's an implementation detail). */
function mapNegotiatorMemory(row: NegotiatorMemory, subjectMap: ReadonlyMap<string, SpeakerUser>) {
  const subject = row.subjectUserId ? subjectMap.get(row.subjectUserId) : undefined;
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
    subjectUser: row.subjectUserId
      ? { id: row.subjectUserId, name: subject?.name ?? 'Unknown user', avatar: subject?.avatar ?? null }
      : null,
    sourceRefs: row.sourceRefs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type NegotiationThread = Awaited<ReturnType<TaskService['getNegotiationThreadsByUser']>>[number];
type NegotiationMessages = Awaited<ReturnType<TaskService['getMessagesByTaskIds']>>;
type SpeakerUser = { id: string; name: string; avatar: string | null };

type NegotiationTurnData = { action?: string; assessment?: { reasoning?: string; suggestedRoles?: { ownUser?: string; otherUser?: string } } };
type NegotiationOutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; agreedRoles?: Array<{ userId: string; role: string }>; turnCount?: number; reason?: string } };

/**
 * Maps a negotiation thread into the API negotiation DTO.
 * @param thread - Current task and every continuation segment in the thread
 * @param messagesMap - Messages keyed by task id (turn data source)
 * @param userMap - Participant users keyed by id (counterparty + speaker resolution)
 * @param selfId - The id treated as "self" for counterparty/role selection
 * @returns Negotiation DTO with counterparty, outcome, and turns
 */
function mapNegotiationThread(
  thread: NegotiationThread,
  messagesMap: NegotiationMessages,
  userMap: ReadonlyMap<string, SpeakerUser>,
  selfId: string,
) {
  const row = thread.current;
  const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
  const counterpartyId = meta?.sourceUserId === selfId ? meta?.candidateUserId : meta?.sourceUserId;
  const counterparty = counterpartyId ? userMap.get(counterpartyId) : null;

  const outcomePart = (row.artifact?.parts as NegotiationOutcomePart[] | null)?.find((p) => p.kind === 'data');
  const outcomeData = outcomePart?.data;
  const viewerRole = outcomeData?.agreedRoles?.find((r) => r.userId === selfId)?.role ?? null;

  const oldestSegments = [...thread.segmentRows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const segmentOrder = new Map(oldestSegments.map((segment, index) => [segment.id, index]));
  const rawMessages = oldestSegments
    .flatMap((segment) => messagesMap.get(segment.id) ?? [])
    .sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime()
      || (segmentOrder.get(a.taskId ?? '') ?? 0) - (segmentOrder.get(b.taskId ?? '') ?? 0)
      || a.id.localeCompare(b.id),
    );
  const turns = rawMessages.map((msg) => {
    const agentUserId = msg.senderId.replace(/^agent:/, '');
    const speakerUser = userMap.get(agentUserId);
    const dataPart = (msg.parts as Array<{ kind?: string; data?: NegotiationTurnData }>).find((p) => p.kind === 'data');
    const turn = dataPart?.data;
    return {
      speaker: speakerUser
        ? { id: speakerUser.id, name: speakerUser.name, avatar: speakerUser.avatar }
        : { id: agentUserId, name: 'Unknown', avatar: null },
      action: turn?.action ?? 'unknown',
      reasoning: turn?.assessment?.reasoning ?? '',
      suggestedRoles: turn?.assessment?.suggestedRoles ?? null,
      createdAt: msg.createdAt.toISOString(),
    };
  });

  return {
    id: row.id,
    segments: thread.segmentRows.length,
    state: row.state,
    statusMessage: row.statusMessage,
    statusTimestamp: row.statusTimestamp?.toISOString() ?? null,
    counterparty: counterparty
      ? { id: counterparty.id, name: counterparty.name, avatar: counterparty.avatar }
      : { id: counterpartyId ?? 'unknown', name: 'Unknown user', avatar: null },
    outcome: outcomeData
      ? {
          hasOpportunity: outcomeData.hasOpportunity ?? outcomeData.consensus ?? false,
          role: viewerRole,
          turnCount: outcomeData.turnCount ?? 0,
          reason: outcomeData.reason,
        }
      : null,
    turns,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Controller('/users')
export class UserController {
  constructor(
    private readonly taskService: TaskService = new TaskService(),
  ) {}

  @Get('/batch')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getBatch(req: Request, _user: AuthenticatedUser) {
    const url = new URL(req.url);
    const idsParam = url.searchParams.get('ids') ?? '';
    const ids = idsParam
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    const uniqueIds = [...new Set(ids)].slice(0, BATCH_MAX_IDS);
    if (uniqueIds.length === 0) {
      return Response.json({ users: [] });
    }
    logger.verbose('Batch get users requested', { count: uniqueIds.length });
    const rows = await userService.findByIds(uniqueIds);
    const users = rows.map((row) => ({
      id: row.id,
      name: row.name,
      intro: row.intro,
      avatar: row.avatar,
      location: row.location,
      socials: row.socials,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return Response.json({ users });
  }

  /**
   * GET /users/:userId/negotiations — list past negotiations for a user.
   * When the viewer differs from the profile owner, only mutual negotiations are returned.
   * @param req - Request with optional ?limit and ?offset query params
   * @param viewer - Authenticated user from AuthGuard
   * @param params - Route params containing userId
   * @returns JSON with negotiations array
   */
  @Get('/:userId/negotiations')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getNegotiations(req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
    const resultParam = url.searchParams.get('result');
    const result = (['has_opportunity', 'no_opportunity', 'in_progress'] as const).includes(resultParam as never)
      ? (resultParam as 'has_opportunity' | 'no_opportunity' | 'in_progress')
      : undefined;

    const sinceParam = url.searchParams.get('since');
    if (sinceParam) {
      const parsed = new Date(sinceParam);
      if (isNaN(parsed.getTime())) {
        return Response.json({ error: `Invalid since parameter: "${sinceParam}". Use an ISO 8601 date string.` }, { status: 400 });
      }
    }
    const validSince = sinceParam ? new Date(sinceParam) : undefined;

    const isSelf = viewer.id === params.userId;
    const mutualWithUserId = isSelf ? undefined : viewer.id;

    try {
      const threads = await this.taskService.getNegotiationThreadsByUser(params.userId, { limit, offset, mutualWithUserId, result, since: validSince });

      const taskIds = threads.flatMap((thread) => thread.segmentRows.map((row) => row.id));
      const messagesMap = await this.taskService.getMessagesByTaskIds(taskIds);

      const participantIds = new Set<string>();
      for (const thread of threads) {
        for (const row of thread.segmentRows) {
          const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
          if (meta?.sourceUserId) participantIds.add(meta.sourceUserId);
          if (meta?.candidateUserId) participantIds.add(meta.candidateUserId);
        }
      }

      const participantUsers = participantIds.size > 0
        ? await userService.findByIds([...participantIds])
        : [];
      const userMap = new Map(participantUsers.map((u) => [u.id, u]));

      const negotiations = threads.map((thread) => mapNegotiationThread(thread, messagesMap, userMap, params.userId));

      return Response.json({ negotiations });
    } catch (err) {
      logger.error('Failed to fetch negotiations', { userId: params.userId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to fetch negotiations' }, { status: 500 });
    }
  }

  /**
   * GET /users/:userId/negotiations/insights — generate an aggregated insight summary of the user's negotiations.
   * Self-only: returns 403 if the viewer is not the profile owner.
   * @param _req - Request (unused)
   * @param viewer - Authenticated user from AuthGuard
   * @param params - Route params containing userId
   * @returns JSON with insights object containing a summary string
   */
  @Get('/:userId/negotiations/insights')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getNegotiationInsights(_req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    if (viewer.id !== params.userId) {
      return Response.json({ error: 'Insights are only available for your own negotiations' }, { status: 403 });
    }

    try {
      const rows = await this.taskService.getNegotiationsByUser(params.userId, { limit: 50, offset: 0 });
      if (rows.length === 0) {
        return Response.json({ insights: null });
      }

      const participantIds = new Set<string>();
      for (const row of rows) {
        const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
        if (meta?.sourceUserId) participantIds.add(meta.sourceUserId);
        if (meta?.candidateUserId) participantIds.add(meta.candidateUserId);
      }
      const participantUsers = participantIds.size > 0 ? await userService.findByIds([...participantIds]) : [];
      const userMap = new Map(participantUsers.map((u) => [u.id, u]));

      const taskIds = rows.map((r) => r.id);
      const messagesMap = await this.taskService.getMessagesByTaskIds(taskIds);

      type OutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; agreedRoles?: Array<{ userId: string; role: string }> } };
      type TurnData = { assessment?: { reasoning?: string } };

      let opportunityCount = 0;
      let noOpportunityCount = 0;
      let inProgressCount = 0;
      const roleCounts: Record<string, number> = {};
      const reasoningExcerpts: string[] = [];
      const counterpartyCounts = new Map<string, { id: string; name: string; avatar: string | null; count: number }>();

      for (const row of rows) {
        const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
        const counterpartyId = meta?.sourceUserId === params.userId ? meta?.candidateUserId : meta?.sourceUserId;
        if (counterpartyId) {
          const cp = userMap.get(counterpartyId);
          if (cp) {
            const existing = counterpartyCounts.get(counterpartyId);
            if (existing) {
              existing.count++;
            } else {
              counterpartyCounts.set(counterpartyId, { id: cp.id, name: cp.name, avatar: cp.avatar, count: 1 });
            }
          }
        }

        const outcomePart = (row.artifact?.parts as OutcomePart[] | null)?.find((p) => p.kind === 'data');
        const outcomeData = outcomePart?.data;

        if (!outcomeData) {
          inProgressCount++;
        } else if (outcomeData.hasOpportunity ?? outcomeData.consensus) {
          opportunityCount++;
          const viewerRole = outcomeData.agreedRoles?.find((r) => r.userId === params.userId)?.role;
          if (viewerRole) {
            const label = viewerRole === 'agent' ? 'Helper' : viewerRole === 'patient' ? 'Seeker' : 'Peer';
            roleCounts[label] = (roleCounts[label] ?? 0) + 1;
          }
        } else {
          noOpportunityCount++;
        }

        if (reasoningExcerpts.length < 8) {
          const msgs = messagesMap.get(row.id) ?? [];
          for (const msg of msgs) {
            if (reasoningExcerpts.length >= 8) break;
            const dataPart = (msg.parts as Array<{ kind?: string; data?: TurnData }>).find((p) => p.kind === 'data');
            const reasoning = dataPart?.data?.assessment?.reasoning;
            if (reasoning) reasoningExcerpts.push(reasoning.slice(0, 150));
          }
        }
      }

      const topCounterparties = [...counterpartyCounts.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const digest: NegotiationDigest = {
        totalCount: rows.length,
        opportunityCount,
        noOpportunityCount,
        inProgressCount,
        roleDistribution: roleCounts,
        counterparties: [...counterpartyCounts.values()].map((c) => c.name).slice(0, 10),
        reasoningExcerpts,
      };

      const generator = new NegotiationInsightsGenerator();
      const summary = await generator.invoke(digest);

      return Response.json({
        insights: {
          summary: summary ?? null,
          stats: {
            totalCount: rows.length,
            opportunityCount,
            noOpportunityCount,
            inProgressCount,
            roleDistribution: roleCounts,
            topCounterparties,
          },
        },
      });
    } catch (err) {
      logger.error('Failed to generate negotiation insights', { userId: params.userId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to generate insights' }, { status: 500 });
    }
  }

  /**
   * GET /users/:userId/negotiator/memories — list the user's negotiator's
   * private memory (P5.4). Optional `?kind=` and `?intentId=` filters
   * (intentId narrows to memories learned from that intent's negotiations).
   *
   * Strict self-only — stricter than the neighbor negotiations route, which
   * permits other viewers with mutual filtering. Negotiator memories are
   * private operational knowledge: ANY non-self caller gets 403, mutuals
   * included, no carve-outs.
   */
  @Get('/:userId/negotiator/memories')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listNegotiatorMemories(req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    if (viewer.id !== params.userId) {
      return Response.json({ error: 'Negotiator memories are only available to their owner' }, { status: 403 });
    }

    const url = new URL(req.url);
    const kindParam = url.searchParams.get('kind');
    if (kindParam && !NEGOTIATOR_MEMORY_KINDS.includes(kindParam as never)) {
      return Response.json({ error: `Invalid kind: "${kindParam}". Use one of: ${NEGOTIATOR_MEMORY_KINDS.join(', ')}` }, { status: 400 });
    }
    const intentIdParam = url.searchParams.get('intentId')?.trim() || undefined;

    try {
      const rows = await negotiatorMemoryInspectionService.list(
        params.userId,
        kindParam || intentIdParam
          ? {
            ...(kindParam ? { kind: kindParam as NegotiatorMemoryKind } : {}),
            ...(intentIdParam ? { intentId: intentIdParam } : {}),
          }
          : undefined,
      );

      const subjectIds = [...new Set(rows.map((r) => r.subjectUserId).filter((id): id is string => !!id))];
      const subjectUsers = subjectIds.length > 0 ? await userService.findByIds(subjectIds) : [];
      const subjectMap = new Map<string, SpeakerUser>(subjectUsers.map((u) => [u.id, u]));

      return Response.json({ memories: rows.map((row) => mapNegotiatorMemory(row, subjectMap)) });
    } catch (err) {
      logger.error('Failed to list negotiator memories', { userId: params.userId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to list negotiator memories' }, { status: 500 });
    }
  }

  /**
   * PATCH /users/:userId/negotiator/memories/:memoryId — edit a memory's
   * content and/or confidence (P5.4). Content edits re-embed so similarity
   * retrieval never serves stale meaning. Strict self-only (403 otherwise).
   */
  @Patch('/:userId/negotiator/memories/:memoryId')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateNegotiatorMemory(req: Request, viewer: AuthenticatedUser, params: { userId: string; memoryId: string }) {
    if (viewer.id !== params.userId) {
      return Response.json({ error: 'Negotiator memories are only available to their owner' }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = UpdateNegotiatorMemoryBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
    }

    try {
      const updated = await negotiatorMemoryInspectionService.update(params.userId, params.memoryId, parsed.data);
      if (!updated) {
        return Response.json({ error: 'Memory not found' }, { status: 404 });
      }
      return Response.json({ memory: mapNegotiatorMemory(updated, new Map()) });
    } catch (err) {
      logger.error('Failed to update negotiator memory', { userId: params.userId, memoryId: params.memoryId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to update negotiator memory' }, { status: 500 });
    }
  }

  /**
   * DELETE /users/:userId/negotiator/memories/:memoryId — remove a memory
   * (P5.4). Takes effect for the next retrieval immediately (P5.3 reads live
   * rows per session). Strict self-only (403 otherwise).
   */
  @Delete('/:userId/negotiator/memories/:memoryId')
  @UseGuards(RateLimit('write'), AuthGuard)
  async deleteNegotiatorMemory(_req: Request, viewer: AuthenticatedUser, params: { userId: string; memoryId: string }) {
    if (viewer.id !== params.userId) {
      return Response.json({ error: 'Negotiator memories are only available to their owner' }, { status: 403 });
    }

    try {
      const deleted = await negotiatorMemoryInspectionService.remove(params.userId, params.memoryId);
      if (!deleted) {
        return Response.json({ error: 'Memory not found' }, { status: 404 });
      }
      return Response.json({ success: true });
    } catch (err) {
      logger.error('Failed to delete negotiator memory', { userId: params.userId, memoryId: params.memoryId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to delete negotiator memory' }, { status: 500 });
    }
  }

  /**
   * PUT /users/me/key — update the authenticated user's key.
   * @param req - Request with JSON body `{ key: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns Updated user or validation error
   */
  @Put('/me/key')
  @deprecatedRoute('user.update-key')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateKey(req: Request, user: AuthenticatedUser) {
    let body: { key?: string };
    try {
      body = (await req.json()) as { key?: string };
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.key || typeof body.key !== 'string') {
      return Response.json({ error: 'key is required' }, { status: 400 });
    }

    const result = await userService.updateKey(user.id, body.key);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ user: result.user });
  }

  @Get('/:userId')
  @UseGuards(RateLimit('read'))
  async getUser(_req: Request, _user: unknown, params: { userId: string }) {
    logger.verbose('Get user requested', { userId: params.userId });
    const user = await userService.findByIdOrKey(params.userId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const socials = await userService.getSocials(user.id);
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        key: user.key,
        intro: user.intro,
        avatar: user.avatar,
        location: user.location,
        socials,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }
}
