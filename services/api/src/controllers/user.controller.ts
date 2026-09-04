import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { userService } from '../services/user.service';
import { negotiationService, type NegotiationView } from '../services/negotiation.service';

import { log } from '../lib/log';

const logger = log.controller.from('user');

const BATCH_MAX_IDS = 100;

/**
 * Projects one negotiation into the profile-history DTO.
 *
 * @param negotiation - The record as the viewer's seat sees it.
 * @returns Counterparty, settlement and turn count; the turn log is on the
 *   detail read at `GET /negotiations/:opportunityId`.
 */
function toHistoryEntry(negotiation: NegotiationView) {
  return {
    id: negotiation.id,
    opportunityId: negotiation.opportunityId,
    counterparty: {
      id: negotiation.counterparty.userId,
      name: negotiation.counterparty.name ?? 'Unknown user',
      avatar: negotiation.counterparty.avatar,
    },
    outcome: negotiation.outcome,
    settledAt: negotiation.settledAt?.toISOString() ?? null,
    turnCount: negotiation.turnCount,
    createdAt: negotiation.createdAt.toISOString(),
    updatedAt: negotiation.updatedAt.toISOString(),
  };
}

@Controller('/users')
export class UserController {

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
   * GET /users/:userId/negotiations — the viewer's negotiation history with a
   * profile.
   *
   * A negotiation is private to its two seats, so this only ever reads the
   * viewer's own: on their own profile, all of them; on someone else's, the
   * ones that person shares a seat in.
   *
   * @param req - Request with optional `limit` and `offset`.
   * @param viewer - Authenticated user from AuthGuard.
   * @param params - Route params containing userId.
   * @returns JSON with negotiations array.
   */
  @Get('/:userId/negotiations')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getNegotiations(req: Request, viewer: AuthenticatedUser, params: { userId: string }) {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '20', 10) || 20, 1), 50);
    const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0', 10) || 0, 0);
    const isSelf = viewer.id === params.userId;

    try {
      const negotiations = await negotiationService.list(viewer.id, {
        limit,
        offset,
        ...(isSelf ? {} : { counterpartyUserId: params.userId }),
      });
      return Response.json({ negotiations: negotiations.map(toHistoryEntry) });
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
