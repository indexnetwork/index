import { z } from 'zod';

import { negotiationService, type SubmitTurnRejection } from '../services/negotiation.service';
import { networkService } from '../services/network.service';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { isStaff } from '../lib/staff';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('negotiation');

const uuidQuerySchema = z.string().uuid();
const stateQuerySchema = z.enum(['open', 'settled']);
const submitTurnSchema = z.object({
  action: z.enum(['propose', 'counter', 'accept', 'decline']),
  message: z.string().trim().min(1).max(4000),
});
const openNegotiationSchema = z.object({
  networkId: z.string().uuid('networkId must be a UUID'),
  initiatorIntentId: z.string().uuid('initiatorIntentId must be a UUID'),
  responderIntentId: z.string().uuid('responderIntentId must be a UUID'),
}).strict();

/** How each refusal reads on the wire. */
const REJECTION_RESPONSES: Record<SubmitTurnRejection, { status: number; error: string }> = {
  not_found: { status: 404, error: 'No negotiation for this opportunity' },
  not_a_seat: { status: 403, error: 'You do not hold a seat in this negotiation' },
  already_settled: { status: 409, error: 'This negotiation has already settled' },
  not_your_turn: { status: 403, error: 'It is not your turn' },
  propose_not_first: { status: 400, error: 'propose is only valid as the opening turn; use counter' },
  counter_is_first: { status: 400, error: 'counter needs a turn to answer; use propose' },
  accept_without_offer: { status: 400, error: 'accept needs a standing offer from the other seat' },
  signal_inactive: { status: 409, error: 'A signal in this negotiation is paused or removed' },
  raced: { status: 409, error: 'The other seat moved first; re-read the negotiation' },
};

type RouteParams = Record<string, string>;

/**
 * NegotiationController: REST API for the negotiation record.
 *
 * Every seat, hosted or external, speaks this surface — there is only one kind
 * of seat, and nothing on the record says which kind produced a turn.
 */
@Controller('/negotiations')
export class NegotiationController {
  /**
   * GET /negotiations — the caller's negotiations.
   *
   * @param req - Carries optional `intentId` and `state` filters.
   * @param user - The authenticated seat owner.
   * @returns The caller's negotiations with `awaiting`, outcome and counterparty.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listNegotiations(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawIntentId = url.searchParams.get('intentId') ?? undefined;
    const rawState = url.searchParams.get('state') ?? undefined;

    if (rawIntentId && !uuidQuerySchema.safeParse(rawIntentId).success) {
      return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    }
    if (rawState && !stateQuerySchema.safeParse(rawState).success) {
      return Response.json(
        { error: `Invalid state; use one of: ${stateQuerySchema.options.join(', ')}` },
        { status: 400 },
      );
    }

    const negotiations = await negotiationService.list(user.id, {
      intentId: rawIntentId,
      ...(rawState === 'open' ? { open: true } : {}),
    });
    const filtered = rawState === 'settled'
      ? negotiations.filter((negotiation) => negotiation.settledAt !== null)
      : negotiations;

    logger.verbose('Negotiations listed', { userId: user.id, count: filtered.length });
    return Response.json({ negotiations: filtered });
  }

  /**
   * POST /negotiations/open — open a negotiation between two seated signals.
   *
   * Discovery is the ordinary way a negotiation appears, and it decides both
   * whether the pair is worth opening and who moves first. This is for a
   * network's owner who wants neither decision made for them: they name the
   * pair, and the initiator they name owes the opening turn.
   *
   * Staff as well as owner. Ownership alone reaches beyond staff, because the
   * reviewed request flow grants it, and skipping the compatibility threshold
   * is exactly what would let an owner bury members in negotiations the
   * matcher would have refused.
   *
   * @param req - Carries the network and the two signals, initiator first.
   * @param user - The authenticated caller, who must be staff and own the network.
   * @returns The opened record, or the existing one when the pair is already open.
   */
  @Post('/open')
  @UseGuards(RateLimit('write'), AuthGuard)
  async openNegotiation(req: Request, user: AuthenticatedUser) {
    if (!isStaff(user)) {
      return Response.json({ error: 'Opening a negotiation by hand is staff-only' }, { status: 403 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = openNegotiationSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }

    if (!await networkService.isNetworkOwner(parsed.data.networkId, user.id)) {
      return Response.json({ error: 'Owner-only operation' }, { status: 403 });
    }

    const result = await negotiationService.open(parsed.data);
    switch (result.kind) {
      case 'opened':
      case 'already_open':
        logger.info('Negotiation opened by hand', {
          userId: user.id,
          networkId: parsed.data.networkId,
          opportunityId: result.negotiation.opportunityId,
          alreadyOpen: result.kind === 'already_open',
        });
        return Response.json({ opened: result.kind === 'opened', negotiation: result.negotiation });
      case 'unseated':
        return Response.json(
          { error: `Signal ${result.intentId} is not an active signal shared with this network` },
          { status: 422 },
        );
      case 'same_signal':
        return Response.json({ error: 'A signal cannot negotiate with itself' }, { status: 422 });
      case 'same_owner':
        return Response.json({ error: 'Both signals belong to the same person' }, { status: 422 });
      case 'not_opened':
        return Response.json({ error: 'The pair could not be opened; check both owners are still members' }, { status: 409 });
    }
  }

  /**
   * GET /negotiations/:opportunityId — one negotiation with its turn log.
   *
   * @param user - The authenticated seat owner.
   * @param params - Carries the opportunity id.
   * @returns The record as this seat sees it, or 404 when it is not theirs.
   */
  @Get('/:opportunityId')
  @UseGuards(RateLimit('read'), AuthGuard)
  async readNegotiation(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const opportunityId = params?.opportunityId;
    if (!opportunityId) return Response.json({ error: 'Missing opportunityId' }, { status: 400 });

    const negotiation = await negotiationService.read(opportunityId, user.id);
    if (!negotiation) return Response.json({ error: 'No negotiation for this opportunity' }, { status: 404 });
    return Response.json({ negotiation });
  }

  /**
   * POST /negotiations/:opportunityId/turns — submit one structured decision.
   *
   * @param req - Carries the action and its message.
   * @param user - The authenticated seat owner.
   * @param params - Carries the opportunity id.
   * @returns The negotiation after the turn, or the refusal.
   */
  @Post('/:opportunityId/turns')
  @UseGuards(RateLimit('write'), AuthGuard)
  async submitTurn(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const opportunityId = params?.opportunityId;
    if (!opportunityId) return Response.json({ error: 'Missing opportunityId' }, { status: 400 });

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

    const result = await negotiationService.submitTurn(opportunityId, user.id, parsed.data);
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
