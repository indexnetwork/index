import { z } from 'zod';

import { opportunityService } from '../services/opportunity.service';
import { negotiationService, negotiationTurnSchema as submitTurnSchema, type SubmitTurnRejection } from '../services/negotiation.service';
import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, isSessionAuthenticated } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { RuntimeConflictError } from '../lib/agent/runtime-errors';

const logger = log.controller.from('opportunity');

const listStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired']);
/** Full lifecycle enum for the radar view's explicit `statuses` filter (e.g. the intent radar). */
const radarStatusSchema = z.enum(['negotiating', 'pending', 'accepted', 'rejected', 'expired']);
const uuidQuerySchema = z.string().uuid();
const scopeTypeQuerySchema = z.enum(['intent']);

/** How each refusal to take a turn reads on the wire. */
const REJECTION_RESPONSES: Record<SubmitTurnRejection, { status: number; error: string }> = {
  not_found: { status: 404, error: 'No negotiation for this opportunity' },
  not_a_seat: { status: 403, error: 'You do not hold a seat in this negotiation' },
  already_settled: { status: 409, error: 'This negotiation has already settled' },
  not_your_turn: { status: 403, error: 'It is not your turn' },
  counter_is_first: { status: 400, error: 'counter needs a turn to answer; use propose' },
  accept_without_offer: { status: 400, error: 'accept needs a standing propose from the other seat; answer a counter by proposing again' },
  propose_over_offer: { status: 400, error: 'a proposal from the other seat is already standing; counter, accept or decline it' },
  signal_inactive: { status: 409, error: 'A signal in this negotiation is paused or removed' },
  turn_limit: { status: 409, error: 'The protocol turn limit was reached; the outcome remains undecided' },
  invalid_turn: { status: 400, error: 'Invalid negotiation action or message' },
  raced: { status: 409, error: 'The other seat moved first; re-read the negotiation' },
};

function parseIntentScopeFromUrl(url: URL): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = url.searchParams.get('scopeType') ?? undefined;
  const rawScopeId = url.searchParams.get('scopeId') ?? undefined;
  const rawIntentId = url.searchParams.get('intentId') ?? undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIntentScopeFromBody(body: unknown): { scopeType?: 'intent'; scopeId?: string } | Response {
  if (!isRecord(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  const rawScopeType = typeof body.scopeType === 'string' ? body.scopeType : undefined;
  const rawScopeId = typeof body.scopeId === 'string' ? body.scopeId : undefined;
  const rawIntentId = typeof body.intentId === 'string' ? body.intentId : undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}

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
   * Always returns presenter-built cards. Use peerUserId for accepted chat context.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const networkId = url.searchParams.get('networkId') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');
    const peerUserId = url.searchParams.get('peerUserId') ?? undefined;
    const noCacheParam = url.searchParams.get('noCache');
    const noCache = noCacheParam === '1' || noCacheParam === 'true';

    if (rawStatus) {
      const parsed = listStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const scope = parseIntentScopeFromUrl(url);
    if (scope instanceof Response) return scope;

    const statusesParam = url.searchParams.get('statuses');
    let statuses: z.infer<typeof radarStatusSchema>[] | undefined;
    if (statusesParam) {
      const parsed = z.array(radarStatusSchema).nonempty().safeParse(statusesParam.split(',').map((s) => s.trim()).filter(Boolean));
      if (!parsed.success) {
        return Response.json({ error: `Invalid statuses; allowed: ${radarStatusSchema.options.join(', ')}` }, { status: 400 });
      }
      statuses = [...new Set(parsed.data)];
    }

    const presentationParam = url.searchParams.get('presentation');
    if (presentationParam && presentationParam !== 'skeleton' && presentationParam !== 'full') {
      return Response.json({ error: "Invalid presentation; allowed: 'skeleton', 'full'" }, { status: 400 });
    }
    const presentation = presentationParam === 'skeleton' ? 'skeleton' as const : undefined;

    const result = await opportunityService.presentOpportunitiesForViewer(user.id, {
      peerUserId,
      status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
      statuses,
      networkId,
      ...scope,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
      noCache,
      presentation,
    });

    if ('error' in result) {
      logger.error('listOpportunities failed', { userId: user.id, error: result.error });
      return Response.json({ error: result.error }, { status: 500 });
    }

    logger.verbose('Opportunities listed', { userId: user.id, count: result.opportunities.length });
    return Response.json(result);
  }

  /**
   * GET /opportunities/:id — get one opportunity with presentation for the viewer.
   * Accepts full UUID or short ID prefix.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async getOpportunity(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      logger.warn('Get opportunity missing id', { userId: user.id });
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await opportunityService.getOpportunityWithPresentation(resolved.id, user.id);

    if (!result) {
      logger.verbose('Opportunity not found', { userId: user.id, opportunityId: resolved.id });
      return Response.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    if ('error' in result) {
      logger.warn('Get opportunity error', { userId: user.id, opportunityId: resolved.id, error: result.error });
      return Response.json({ error: result.error }, { status: result.status as number });
    }

    return Response.json(result);
  }

  /**
   * PATCH /opportunities/:id/status — update status (e.g. accepted, rejected).
   * Accepts full UUID or short ID prefix.
   */
  @Patch('/:id/status')
  @UseGuards(AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isRecord(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

    const rawStatus = typeof body.status === 'string' ? body.status : undefined;
    const status = rawStatus as 'pending' | 'negotiating' | 'accepted' | 'rejected' | 'expired' | undefined;
    const allowed = ['pending', 'negotiating', 'accepted', 'rejected', 'expired'];
    if (!status || !allowed.includes(status)) {
      return Response.json({ error: 'Invalid status; use one of: ' + allowed.join(', ') }, { status: 400 });
    }

    const scope = parseIntentScopeFromBody(body);
    if (scope instanceof Response) return scope;

    const result = await opportunityService.updateOpportunityStatus(resolved.id, status, user.id, {
      ...scope,
      // Provenance: only a genuine human session may become a preference label
      // (IND-434). API-key/agent REST calls are excluded from outcome capture.
      actionProvenance: isSessionAuthenticated(req) ? 'user_session' : 'api_key',
    });

    if (result && 'error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status as number },
      );
    }

    return Response.json(result);
  }

  /**
   * POST /opportunities/:id/start-chat — accept a `pending`
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
  @UseGuards(AuthGuard)
  async startChat(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      body = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const scope = parseIntentScopeFromBody(body);
    if (scope instanceof Response) return scope;

    const result = await opportunityService.startChat(resolved.id, user.id, {
      ...scope,
      actionProvenance: isSessionAuthenticated(req) ? 'user_session' : 'api_key',
    });
    if ('error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status },
      );
    }
    return Response.json(result);
  }

  /**
   * GET /opportunities/:id/negotiation — the opportunity's negotiation with
   * its turn log.
   *
   * Singular because there is exactly one: the opportunity and its negotiation
   * are written together, and the schema holds that with a unique index on the
   * opportunity.
   *
   * @param _req - Incoming request (unused).
   * @param user - Authenticated user from AuthGuard, who must hold a seat.
   * @param params - Route params; `id` is a full UUID or short prefix.
   * @returns The record as this seat sees it, or 404 when it is not theirs.
   */
  @Get('/:id/negotiation')
  @UseGuards(AuthGuard)
  async readNegotiation(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const negotiation = await negotiationService.read(resolved.id, user.id);
    if (!negotiation) return Response.json({ error: 'No negotiation for this opportunity' }, { status: 404 });
    return Response.json({ negotiation });
  }

  /**
   * POST /opportunities/:id/negotiation/turns — submit one structured decision.
   *
   * @param req - Carries the action and message, plus an optional executorId query fence for external runtimes.
   * @param user - Authenticated user from AuthGuard, who must hold a seat.
   * @param params - Route params; `id` is a full UUID or short prefix.
   * @returns The negotiation after the turn, or the refusal.
   */
  @Post('/:id/negotiation/turns')
  @UseGuards(AuthGuard)
  async submitTurn(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const executorId = new URL(req.url).searchParams.get('executorId');
    if (executorId !== null && !uuidQuerySchema.safeParse(executorId).success) {
      return Response.json({ error: 'executorId must be a UUID' }, { status: 400 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = submitTurnSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid turn' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const opportunityId = resolved.id;

    let result;
    try {
      result = await negotiationService.submitTurn(opportunityId, user.id, parsed.data,
        executorId ? { userId: user.id, agentId: executorId } : undefined);
    } catch (error) {
      if (error instanceof RuntimeConflictError) {
        return Response.json({ error: 'The selected negotiation executor changed; stop this work' }, { status: 409 });
      }
      throw error;
    }
    if ('rejection' in result) {
      const response = REJECTION_RESPONSES[result.rejection];
      logger.verbose('Turn refused', { userId: user.id, opportunityId, rejection: result.rejection });
      return Response.json({ error: response.error }, { status: response.status });
    }

    logger.info('Turn submitted', {
      userId: user.id,
      opportunityId,
      action: parsed.data.action,
      outcome: result.outcome,
    });
    return Response.json({ negotiation: result });
  }

}
