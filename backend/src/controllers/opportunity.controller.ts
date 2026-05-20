import { z } from 'zod';

import { opportunityService } from '../services/opportunity.service';
import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { assertAgentNetworkScope } from '../guards/agent-scope.guard';
import { AuthGuard, AuthOrApiKeyGuard } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { signConnectToken, verifyConnectToken } from '../services/connect-token.service';
import { mintConnectLink, type ConnectLinkKind } from '../services/connect-link.service';
import { queueOpportunityNotification } from '../queues/notification.queue';
import { log } from '../lib/log';

const logger = log.controller.from('opportunity');

const EXPIRED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link Expired</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">This link has expired</h1>
<p style="color:#666">Connect links are valid for 48 hours. Please check your latest notification for a fresh link.</p>
</div></body></html>`;

const INTRODUCTION_APPROVED_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Introduction Approved</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center"><h1 style="font-size:1.5rem">Introduction approved</h1>
<p style="color:#666">You approved the introduction. Both parties will be connected shortly.</p>
</div></body></html>`;

const discoverBodySchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
});

const listStatusSchema = z.enum(['pending', 'stalled', 'accepted', 'rejected', 'expired']);

/** Route params when path has :id or :networkId */
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
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const networkId = url.searchParams.get('networkId') ?? undefined;
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
      networkId,
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
  @UseGuards(RateLimit('read'), AuthGuard)
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
  @UseGuards(RateLimit('read'), AuthGuard)
  async getHome(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const networkId = url.searchParams.get('networkId') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const noCacheParam = url.searchParams.get('noCache');
    const noCache = noCacheParam === '1' || noCacheParam === 'true';
    const result = await opportunityService.getHomeView(user.id, {
      networkId,
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
      noCache,
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
  @UseGuards(RateLimit('read'), AuthGuard)
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
   * Accepts full UUID or short ID prefix.
   */
  @Get('/:id')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getOpportunity(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      logger.warn('Get opportunity missing id', { userId: user.id });
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await opportunityService.getOpportunityWithPresentation(resolved.id, user.id);

    if (!result) {
      logger.verbose('Opportunity not found', { userId: user.id, opportunityId: resolved.id });
      return new Response(JSON.stringify({ error: 'Opportunity not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if ('error' in result) {
      logger.warn('Get opportunity error', { userId: user.id, opportunityId: resolved.id, error: result.error });
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status as number,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json(result);
  }

  /**
   * PATCH /opportunities/:id/status — update status (e.g. accepted, rejected).
   * Accepts full UUID or short ID prefix.
   */
  @Patch('/:id/status')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing opportunity id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
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
    
    const status = body.status as 'latent' | 'draft' | 'pending' | 'negotiating' | 'stalled' | 'accepted' | 'rejected' | 'expired' | undefined;
    const allowed = ['latent', 'draft', 'pending', 'negotiating', 'stalled', 'accepted', 'rejected', 'expired'];
    if (!status || !allowed.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status; use one of: ' + allowed.join(', ') }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await opportunityService.updateOpportunityStatus(resolved.id, status, user.id);

    if (result && 'error' in result) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: result.status as number,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return Response.json(result);
  }

  /**
   * POST /opportunities/:id/start-chat — accept a `pending` or `draft`
   * opportunity and resolve (find-or-create) the h2h conversation for the
   * actor pair. Used by the frontend's Start Chat button; returns the
   * conversationId to navigate to.
   *
   * @param _req - Incoming request (body is ignored).
   * @param user - Authenticated user from AuthGuard.
   * @param params - Route params; `id` is the opportunity ID (full UUID or
   *   short prefix, resolved via `opportunityService.resolveId`).
   * @returns JSON with `{ conversationId, counterpartUserId, opportunity }`
   *   on success, or a structured error (400 on bad status / missing
   *   counterpart, 403 for non-actors, 404 when the opp does not exist).
   */
  @Post('/:id/start-chat')
  @UseGuards(RateLimit('write'), AuthGuard)
  async startChat(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await opportunityService.startChat(resolved.id, user.id);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json(result);
  }

  /**
   * POST /opportunities/:id/connect-token — mint a short-lived JWT for the connect redirect.
   * Requires x-api-key (agent polling) or session auth.
   */
  @Post('/:id/connect-token')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async createConnectToken(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const token = await signConnectToken(user.id, resolved.id);
    return Response.json({ token });
  }

  /**
   * POST /opportunities/:id/connect-link — mint (or reuse) a short-link for the
   * authenticated recipient. Backend generates the greeting from the rendered
   * opportunity card and snapshots it on first mint. Returns the full public URL.
   *
   * Body (optional): `{ kind?: 'connect' | 'approve_introduction' | 'outreach' }`.
   * Defaults to `'connect'` when omitted or unrecognized.
   *
   * @returns `{ url: string }` — full short URL pointing at `${BASE_URL}/c/:code`.
   */
  @Post('/:id/connect-link')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async createConnectLink(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    let body: { kind?: string } = {};
    try {
      body = (await req.json()) as { kind?: string };
    } catch {
      // empty body OK
    }
    const requestedKind: ConnectLinkKind =
      body.kind === 'approve_introduction'
        ? 'approve_introduction'
        : body.kind === 'outreach'
          ? 'outreach'
          : 'connect';

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const greeting = await opportunityService.getGreetingForCard(resolved.id, user.id);

    const { code } = await mintConnectLink({
      userId: user.id,
      opportunityId: resolved.id,
      kind: requestedKind,
      greeting,
    });

    // Public origin for short links. Falls back to a dev default; matches
    // the precedence used by protocol-init.ts so MCP-minted and HTTP-minted
    // URLs share the same host.
    const apiBaseUrl = (
      process.env.BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.APP_URL ||
      'http://localhost:3001'
    ).replace(/\/+$/, '');

    return Response.json({ url: `${apiBaseUrl}/c/${code}` });
  }

  /**
   * GET /opportunities/:id/connect — verify JWT, accept opportunity, redirect to Telegram or web chat.
   * No guard: authentication is via the token query parameter.
   */
  @Get('/:id/connect')
  @UseGuards(RateLimit('read'))
  async connect(req: Request, _user: unknown, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response('Missing opportunity id', { status: 400 });
    }

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) {
      return new Response('Missing token', { status: 400 });
    }

    let payload: { sub: string; opp: string };
    try {
      payload = await verifyConnectToken(token);
    } catch {
      return new Response(EXPIRED_HTML, { status: 401, headers: { 'Content-Type': 'text/html' } });
    }

    if (payload.opp !== id) {
      return new Response('Token does not match opportunity', { status: 403 });
    }

    const result = await opportunityService.startChat(payload.opp, payload.sub);
    if ('error' in result) {
      return new Response(result.error, { status: result.status });
    }

    const msg = url.searchParams.get('msg') || '';
    const counterpartId = result.counterpartUserId;

    // Look up counterpart's Telegram handle
    const telegramHandle = await opportunityService.getCounterpartTelegramHandle(counterpartId);
    const frontendUrl = (process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network').replace(/\/+$/, '');

    let redirectUrl: string;
    if (telegramHandle) {
      redirectUrl = msg
        ? `https://t.me/${telegramHandle}?text=${encodeURIComponent(msg)}`
        : `https://t.me/${telegramHandle}`;
    } else {
      redirectUrl = msg
        ? `${frontendUrl}/u/${counterpartId}/chat?msg=${encodeURIComponent(msg)}`
        : `${frontendUrl}/u/${counterpartId}/chat`;
    }

    return Response.redirect(redirectUrl, 302);
  }

  /**
   * GET /opportunities/:id/approve-introduction — verify JWT, validate
   * introducer role, flip approved flag, trigger negotiation, return HTML.
   *
   * Used by connector-flow Telegram notifications: the introducer clicks
   * an approve link, the system marks their actor as approved, transitions
   * the opportunity to pending (triggering negotiation), and returns an
   * inline HTML confirmation page (200, no redirect).
   *
   * No guard: authentication is via the token query parameter (same
   * mechanism as the `/connect` endpoint).
   */
  @Get('/:id/approve-introduction')
  @UseGuards(RateLimit('read'))
  async approveIntroduction(req: Request, _user: unknown, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return new Response('Missing opportunity id', { status: 400 });
    }

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const token = url.searchParams.get('token');
    if (!token) {
      return new Response('Missing token', { status: 400 });
    }

    let payload: { sub: string; opp: string };
    try {
      payload = await verifyConnectToken(token);
    } catch {
      return new Response(EXPIRED_HTML, { status: 401, headers: { 'Content-Type': 'text/html' } });
    }

    if (payload.opp !== id) {
      return new Response('Token does not match opportunity', { status: 403 });
    }

    // Validate: the token's user must be an introducer on this opportunity
    const result = await opportunityService.approveIntroduction(payload.opp, payload.sub);

    if ('error' in result) {
      return new Response(result.error, { status: result.status });
    }

    return new Response(INTRODUCTION_APPROVED_HTML, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }

  /**
   * POST /opportunities/discover — discover opportunities via HyDE graph.
   */
  @Post('/discover')
  @UseGuards(RateLimit('write'), AuthGuard)
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
 * Network-scoped opportunity routes: GET/POST /networks/:networkId/opportunities.
 * Permission: list requires member; create requires owner or member (with rules).
 */
@Controller('/networks')
export class NetworkOpportunityController {

  /**
   * GET /networks/:networkId/opportunities — list opportunities for a network (owner or member).
   */
  @Get('/:networkId/opportunities')
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async listForIndex(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const networkId = params?.networkId;
    if (!networkId) {
      return new Response(JSON.stringify({ error: 'Missing network id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await assertAgentNetworkScope(req, networkId);

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

    const result = await opportunityService.getOpportunitiesForNetwork(networkId, user.id, {
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
   * POST /networks/:networkId/opportunities — create a manual opportunity (curator).
   */
  @Post('/:networkId/opportunities')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async createManual(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const networkId = params?.networkId;
    if (!networkId) {
      return new Response(JSON.stringify({ error: 'Missing network id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await assertAgentNetworkScope(req, networkId);

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

    const result = await opportunityService.createManualOpportunity(networkId, user.id, {
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
