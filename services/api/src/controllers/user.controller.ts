import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { userService } from '../services/user.service';
import { TaskService } from '../services/task.service';

import { log } from '../lib/log';

const logger = log.controller.from('user');

const BATCH_MAX_IDS = 100;

type NegotiationThread = Awaited<ReturnType<TaskService['getNegotiationThreadsByUser']>>[number];
type NegotiationMessages = Awaited<ReturnType<TaskService['getMessagesByTaskIds']>>;
type SpeakerUser = { id: string; name: string; avatar: string | null };

type NegotiationTurnData = { action?: string; assessment?: { reasoning?: string; suggestedRoles?: { ownUser?: string; otherUser?: string } } };
type NegotiationOutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; agreedRoles?: Array<{ userId: string; role: string }>; turnCount?: number; reason?: string } };

/**
 * Maps a negotiation thread into the API negotiation DTO.
 * @param thread - Current task and every task in the opportunity thread
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
