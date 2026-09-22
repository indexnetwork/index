import { z } from 'zod';

import { opportunityService } from '../services/opportunity.service';
import { negotiationService, negotiationTurnSchema as submitTurnSchema, type SubmitTurnRejection } from '../services/negotiation.service';
import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { RuntimeConflictError } from '../lib/agent/runtime-errors';
import { parseListOpportunitiesQuery } from '../services/opportunity.list-query';

const logger = log.controller.from('opportunity');

const uuidQuerySchema = z.string().uuid();

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
   * Intent-scoped lists live at GET /intents/:id/opportunities.
   */
  @Get('')
  @UseGuards(AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const query = parseListOpportunitiesQuery(url);
    if (query instanceof Response) return query;

    const result = await opportunityService.presentOpportunitiesForViewer(user.id, query);

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
   * PATCH /opportunities/:id/status — update status without intent scope.
   * Intent-scoped updates live at PATCH /intents/:id/opportunities/:opportunityId/status.
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

    const result = await opportunityService.updateOpportunityStatus(resolved.id, status, user.id);

    if (result && 'error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status as number },
      );
    }

    return Response.json(result);
  }

  /**
   * POST /opportunities/:id/start-chat — accept without intent scope.
   * Intent-scoped start-chat lives at POST /intents/:id/opportunities/:opportunityId/start-chat.
   */
  @Post('/:id/start-chat')
  @UseGuards(AuthGuard)
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
   */
  @Post('/:id/negotiation/turns')
  @UseGuards(AuthGuard)
  async submitTurn(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const agentId = new URL(req.url).searchParams.get('agentId');
    if (agentId !== null && !uuidQuerySchema.safeParse(agentId).success) {
      return Response.json({ error: 'agentId must be a UUID' }, { status: 400 });
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
        agentId ? { userId: user.id, agentId } : undefined);
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
