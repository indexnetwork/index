import { z } from 'zod';

import { negotiationService } from '../services/negotiation.service';
import { Controller, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('negotiation');

const uuidQuerySchema = z.string().uuid();
const stateQuerySchema = z.enum(['open', 'settled']);

type RouteParams = Record<string, string>;

/**
 * NegotiationController: the caller's negotiations across every opportunity.
 *
 * One negotiation is reached through its opportunity
 * (`/opportunities/:id/negotiation`), because there is exactly one per
 * opportunity and the two are written together. This is the only view that
 * spans them, and it is what answers "where is it my move?".
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
  @UseGuards(AuthGuard)
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
}
