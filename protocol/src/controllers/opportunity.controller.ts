import { z } from 'zod';

import { opportunityService } from '../services/opportunity.service';
import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { queueOpportunityNotification } from '../queues/notification.queue';
import { log } from '../lib/log';

const logger = log.controller.from('opportunity');

const discoverBodySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
});

const listStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);

/** Route params when path has :id or :indexId */
type RouteParams = Record<string, string>;

/**
 * OpportunityController: REST API for opportunities.
 * Uses OpportunityService for all business logic and graph operations.
 */
@Controller('/opportunities')
export class OpportunityController {
  /**
   * GET /opportunities — list opportunities for the authenticated user.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const indexId = url.searchParams.get('indexId') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    if (rawStatus) {
      const parsed = listStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const options = {
      status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
      indexId,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const list = await opportunityService.getOpportunitiesForUser(user.id, options);
    logger.verbose('Opportunities listed', { userId: user.id, count: list.length });
    return Response.json({ opportunities: list });
  }

  /**
   * GET /opportunities/chat-context — get shared accepted opportunities between the
   * authenticated user and a peer, used as context for chat conversations.
   *
   * @param req - Must include `peerUserId` query parameter
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with opportunity cards for the chat context
   */
  @Get('/chat-context')
  @UseGuards(AuthGuard)
  async getChatContext(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const peerUserId = url.searchParams.get('peerUserId');
    if (!peerUserId) {
      return Response.json({ error: 'peerUserId query param is required' }, { status: 400 });
    }

    try {
      const result = await opportunityService.getChatContext(user.id, peerUserId);
      return Response.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[getChatContext] Error', { userId: user.id, error: message });
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  /**
   * GET /opportunities/home — home view with dynamic sections (LLM-categorized, presenter text, Lucide icons).
   */
  @Get('/home')
  @UseGuards(AuthGuard)
  async getHome(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const indexId = url.searchParams.get('indexId') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const result = await opportunityService.getHomeView(user.id, {
      indexId,
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
    });
    if ('error' in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return Response.json(result);
  }

  /**
   * GET /opportunities/:id/invite-message — generate an invite message for a ghost counterpart.
   */
  @Get('/:id/invite-message')
  @UseGuards(AuthGuard)
  async getInviteMessage(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const result = await opportunityService.generateInviteMessage(id, user.id);

    if ('error' in result && 'status' in result && typeof result.status === 'number') {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json(result);
  }

  /**
   * GET /opportunities/:id — get one opportunity with presentation for the viewer.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async getOpportunity(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      logger.warn('Get opportunity missing id', { userId: user.id });
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await opportunityService.getOpportunityWithPresentation(id, user.id);
    
    if (!result) {
      logger.verbose('Opportunity not found', { userId: user.id, opportunityId: id });
      return new Response(JSON.stringify({ error: 'Opportunity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if ('error' in result) {
      logger.warn('Get opportunity error', { userId: user.id, opportunityId: id, error: result.error });
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status as number,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json(result);
  }

  /**
   * PATCH /opportunities/:id/status — update status (e.g. accepted, rejected).
   */
  @Patch('/:id/status')
  @UseGuards(AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    let body: { status?: string };
    try {
      body = (await req.json()) as { status?: string };
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const status = body.status as 'latent' | 'draft' | 'pending' | 'accepted' | 'rejected' | 'expired' | undefined;
    const allowed = ['latent', 'draft', 'pending', 'accepted', 'rejected', 'expired'];
    if (!status || !allowed.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status; use one of: ' + allowed.join(', ') }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await opportunityService.updateOpportunityStatus(id, status, user.id);
    
    if (result && 'error' in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status as number,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json(result);
  }

  /**
   * POST /opportunities/discover — discover opportunities via HyDE graph.
   */
  @Post('/discover')
  @UseGuards(AuthGuard)
  async discover(req: Request, user: AuthenticatedUser) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const parsed = discoverBodySchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Missing or invalid "query" field in request body' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { query, limit = 5 } = parsed.data;

    const result = await opportunityService.discoverOpportunities(user.id, query, limit);
    
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json(result);
  }
}

/**
 * Index-scoped opportunity routes: GET/POST /indexes/:indexId/opportunities.
 * Permission: list requires member; create requires owner or member (with rules).
 */
@Controller('/indexes')
export class IndexOpportunityController {

  /**
   * GET /indexes/:indexId/opportunities — list opportunities for an index (owner or member).
   */
  @Get('/:indexId/opportunities')
  @UseGuards(AuthGuard)
  async listForIndex(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const indexId = params?.indexId;
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'Missing index id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    if (rawStatus) {
      const parsed = listStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const result = await opportunityService.getOpportunitiesForIndex(indexId, user.id, {
      status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    if ('error' in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json({ opportunities: result });
  }

  /**
   * POST /indexes/:indexId/opportunities — create a manual opportunity (curator).
   */
  @Post('/:indexId/opportunities')
  @UseGuards(AuthGuard)
  async createManual(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const indexId = params?.indexId;
    if (!indexId) {
      return new Response(JSON.stringify({ error: 'Missing index id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    let body: { parties?: Array<{ userId: string; intentId?: string }>; reasoning?: string; category?: string; confidence?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const { parties, reasoning, category, confidence } = body ?? {};
    if (!parties || !Array.isArray(parties) || parties.length < 2 || !reasoning || typeof reasoning !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Body must include parties (array of at least 2 { userId, intentId? }) and reasoning (string)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await opportunityService.createManualOpportunity(indexId, user.id, {
      parties,
      reasoning,
      category,
      confidence,
    });

    if ('error' in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Queue notifications for non-introducer parties
    const recipientIds = parties.map((p) => p.userId).filter((id) => id !== user.id);
    for (const recipientId of recipientIds) {
      await queueOpportunityNotification(result.id, recipientId, 'high');
    }

    return new Response(JSON.stringify(result), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
