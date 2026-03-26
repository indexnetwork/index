import { z } from 'zod';

import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { contactService } from '../services/contact.service';
import { TaskService } from '../services/task.service';
import { NegotiationService } from '../services/negotiation.service';
import { NegotiationInsightsGenerator } from '../lib/protocol/agents/negotiation.insights.generator';
import type { NegotiationDigest } from '../lib/protocol/agents/negotiation.insights.generator';
import { log } from '../lib/log';

const logger = log.controller.from('user');

const AddContactBodySchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).optional(),
});

const BATCH_MAX_IDS = 100;

@Controller('/users')
export class UserController {
  constructor(
    private readonly taskService: TaskService = new TaskService(),
    private readonly negotiationService: NegotiationService = new NegotiationService(),
  ) {}

  @Get('/batch')
  @UseGuards(AuthGuard)
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
      isGhost: row.isGhost,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
    return Response.json({ users });
  }

  /**
   * POST /users/contacts — manually add a contact by email (creates ghost user if not registered).
   * @param req - Request with JSON body `{ email: string; name?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns JSON `{ result }` with the import outcome, or 400 if email is invalid
   */
  @Post('/contacts')
  @UseGuards(AuthGuard)
  async addContact(req: Request, user: AuthenticatedUser) {
    const parsed = AddContactBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'A valid email is required' }, { status: 400 });
    }
    logger.verbose('Add contact requested', { userId: user.id });
    const result = await contactService.addContact(user.id, parsed.data.email, { name: parsed.data.name });
    return Response.json({ result });
  }

  /**
   * POST /users/:userId/negotiations — trigger a discovery negotiation with the target user.
   * @param _req - Request (unused)
   * @param viewer - Authenticated user from AuthGuard
   * @param params - Route params containing userId (the target)
   * @returns 201 with negotiation summary, or 409 if negotiations already exist
   */
  @Post('/:userId/negotiations')
  @UseGuards(AuthGuard)
  async triggerNegotiation(_req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    if (viewer.id === params.userId) {
      return Response.json({ error: 'Cannot negotiate with yourself' }, { status: 400 });
    }

    try {
      const targetUser = await userService.findById(params.userId);
      if (!targetUser) {
        return Response.json({ error: 'User not found' }, { status: 404 });
      }

      const existing = await this.taskService.getNegotiationsByUser(viewer.id, {
        limit: 1,
        mutualWithUserId: params.userId,
        result: 'in_progress',
      });
      if (existing.length > 0) {
        return Response.json({ error: 'Negotiation already in progress with this user' }, { status: 409 });
      }

      await this.negotiationService.triggerDiscoveryNegotiation(viewer.id, params.userId);

      const rows = await this.taskService.getNegotiationsByUser(viewer.id, {
        limit: 1,
        mutualWithUserId: params.userId,
      });
      if (rows.length === 0) {
        return Response.json({ error: 'Negotiation completed but task not found' }, { status: 500 });
      }

      const row = rows[0];
      const taskIds = [row.id];
      const messagesMap = await this.taskService.getMessagesByTaskIds(taskIds);

      const participantIds = new Set<string>();
      const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
      if (meta?.sourceUserId) participantIds.add(meta.sourceUserId);
      if (meta?.candidateUserId) participantIds.add(meta.candidateUserId);

      const participantUsers = participantIds.size > 0
        ? await userService.findByIds([...participantIds])
        : [];
      const userMap = new Map(participantUsers.map((u) => [u.id, u]));

      type TurnData = { action?: string; assessment?: { fitScore?: number; reasoning?: string; suggestedRoles?: { ownUser?: string; otherUser?: string } } };
      type OutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; finalScore?: number; agreedRoles?: Array<{ userId: string; role: string }>; turnCount?: number; reason?: string } };

      const counterpartyId = meta?.sourceUserId === viewer.id ? meta?.candidateUserId : meta?.sourceUserId;
      const counterparty = counterpartyId ? userMap.get(counterpartyId) : null;

      const outcomePart = (row.artifact?.parts as OutcomePart[] | null)?.find((p) => p.kind === 'data');
      const outcomeData = outcomePart?.data;
      const viewerRole = outcomeData?.agreedRoles?.find((r) => r.userId === viewer.id)?.role ?? null;

      const rawMessages = messagesMap.get(row.id) ?? [];
      const turns = rawMessages.map((msg) => {
        const agentUserId = msg.senderId.replace(/^agent:/, '');
        const speakerUser = userMap.get(agentUserId);
        const dataPart = (msg.parts as Array<{ kind?: string; data?: TurnData }>).find((p) => p.kind === 'data');
        const turn = dataPart?.data;
        return {
          speaker: speakerUser
            ? { id: speakerUser.id, name: speakerUser.name, avatar: speakerUser.avatar }
            : { id: agentUserId, name: 'Unknown', avatar: null },
          action: turn?.action ?? 'unknown',
          fitScore: turn?.assessment?.fitScore ?? 0,
          reasoning: turn?.assessment?.reasoning ?? '',
          suggestedRoles: turn?.assessment?.suggestedRoles ?? null,
          createdAt: msg.createdAt.toISOString(),
        };
      });

      const negotiation = {
        id: row.id,
        counterparty: counterparty
          ? { id: counterparty.id, name: counterparty.name, avatar: counterparty.avatar }
          : { id: counterpartyId ?? 'unknown', name: 'Unknown user', avatar: null },
        outcome: outcomeData
          ? {
              hasOpportunity: outcomeData.hasOpportunity ?? outcomeData.consensus ?? false,
              finalScore: outcomeData.finalScore ?? 0,
              role: viewerRole,
              turnCount: outcomeData.turnCount ?? 0,
              reason: outcomeData.reason,
            }
          : null,
        turns,
        createdAt: row.createdAt.toISOString(),
      };

      return Response.json({ negotiation }, { status: 201 });
    } catch (err) {
      logger.error('Failed to trigger negotiation', { userId: params.userId, error: err instanceof Error ? err.message : String(err) });
      return Response.json({ error: 'Failed to trigger negotiation' }, { status: 500 });
    }
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
  @UseGuards(AuthGuard)
  async getNegotiations(req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
    const resultParam = url.searchParams.get('result');
    const result = (['has_opportunity', 'no_opportunity', 'in_progress'] as const).includes(resultParam as never)
      ? (resultParam as 'has_opportunity' | 'no_opportunity' | 'in_progress')
      : undefined;

    const isSelf = viewer.id === params.userId;
    const mutualWithUserId = isSelf ? undefined : viewer.id;

    try {
      const rows = await this.taskService.getNegotiationsByUser(params.userId, { limit, offset, mutualWithUserId, result });

      const taskIds = rows.map((r) => r.id);
      const messagesMap = await this.taskService.getMessagesByTaskIds(taskIds);

      const participantIds = new Set<string>();
      for (const row of rows) {
        const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
        if (meta?.sourceUserId) participantIds.add(meta.sourceUserId);
        if (meta?.candidateUserId) participantIds.add(meta.candidateUserId);
      }

      const participantUsers = participantIds.size > 0
        ? await userService.findByIds([...participantIds])
        : [];
      const userMap = new Map(participantUsers.map((u) => [u.id, u]));

      type TurnData = { action?: string; assessment?: { fitScore?: number; reasoning?: string; suggestedRoles?: { ownUser?: string; otherUser?: string } } };
      type OutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; finalScore?: number; agreedRoles?: Array<{ userId: string; role: string }>; turnCount?: number; reason?: string } };

      const negotiations = rows.map((row) => {
        const meta = row.metadata as { sourceUserId?: string; candidateUserId?: string } | null;
        const counterpartyId = meta?.sourceUserId === params.userId ? meta?.candidateUserId : meta?.sourceUserId;
        const counterparty = counterpartyId ? userMap.get(counterpartyId) : null;

        const outcomePart = (row.artifact?.parts as OutcomePart[] | null)?.find((p) => p.kind === 'data');
        const outcomeData = outcomePart?.data;
        const viewerRole = outcomeData?.agreedRoles?.find((r) => r.userId === params.userId)?.role ?? null;

        const rawMessages = messagesMap.get(row.id) ?? [];
        const turns = rawMessages.map((msg) => {
          const agentUserId = msg.senderId.replace(/^agent:/, '');
          const speakerUser = userMap.get(agentUserId);
          const dataPart = (msg.parts as Array<{ kind?: string; data?: TurnData }>).find((p) => p.kind === 'data');
          const turn = dataPart?.data;

          return {
            speaker: speakerUser
              ? { id: speakerUser.id, name: speakerUser.name, avatar: speakerUser.avatar }
              : { id: agentUserId, name: 'Unknown', avatar: null },
            action: turn?.action ?? 'unknown',
            fitScore: turn?.assessment?.fitScore ?? 0,
            reasoning: turn?.assessment?.reasoning ?? '',
            suggestedRoles: turn?.assessment?.suggestedRoles ?? null,
            createdAt: msg.createdAt.toISOString(),
          };
        });

        return {
          id: row.id,
          counterparty: counterparty
            ? { id: counterparty.id, name: counterparty.name, avatar: counterparty.avatar }
            : { id: counterpartyId ?? 'unknown', name: 'Unknown user', avatar: null },
          outcome: outcomeData
            ? {
                hasOpportunity: outcomeData.hasOpportunity ?? outcomeData.consensus ?? false,
                finalScore: outcomeData.finalScore ?? 0,
                role: viewerRole,
                turnCount: outcomeData.turnCount ?? 0,
                reason: outcomeData.reason,
              }
            : null,
          turns,
          createdAt: row.createdAt.toISOString(),
        };
      });

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
  @UseGuards(AuthGuard)
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

      type OutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; finalScore?: number; agreedRoles?: Array<{ userId: string; role: string }> } };
      type TurnData = { assessment?: { reasoning?: string } };

      let opportunityCount = 0;
      let noOpportunityCount = 0;
      let inProgressCount = 0;
      const roleCounts: Record<string, number> = {};
      const reasoningExcerpts: string[] = [];
      const scoreSum: number[] = [];
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
          if (outcomeData.finalScore != null) scoreSum.push(outcomeData.finalScore);
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

      const avgScore = scoreSum.length > 0 ? Math.round(scoreSum.reduce((a, b) => a + b, 0) / scoreSum.length) : null;
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
            avgScore,
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

  @Get('/:userId')
  @UseGuards(AuthGuard)
  async getUser(_req: Request, _user: AuthenticatedUser, params: { userId: string }) {
    logger.verbose('Get user requested', { userId: params.userId });
    const user = await userService.findById(params.userId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    return Response.json({
      user: {
        id: user.id,
        name: user.name,
        intro: user.intro,
        avatar: user.avatar,
        location: user.location,
        socials: user.socials,
        isGhost: user.isGhost,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }
}
