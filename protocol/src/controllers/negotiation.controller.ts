import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { negotiationService } from '../services/negotiation.service';

const logger = log.controller.from('negotiation');

@Controller('/negotiations')
export class NegotiationController {
  /**
   * List negotiations for the authenticated user.
   */
  @Post('/list')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      limit?: number;
      offset?: number;
      status?: string | string[];
    };

    logger.verbose('Listing negotiations', { userId: user.id, ...body });

    const negotiations = await negotiationService.listNegotiations({
      userId: user.id,
      status: body.status as any,
      limit: body.limit ?? 50,
      offset: body.offset ?? 0,
    });

    return Response.json({
      negotiations: negotiations.map(n => ({
        ...n,
        createdAt: n.createdAt.toISOString(),
        updatedAt: n.updatedAt.toISOString(),
      })),
    });
  }

  /**
   * Get a specific negotiation by ID.
   * User must be a participant to view.
   */
  @Post('/get')
  @UseGuards(AuthGuard)
  async get(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      negotiationId?: string;
    };

    if (!body.negotiationId) {
      return Response.json({ error: 'negotiationId is required' }, { status: 400 });
    }

    const negotiation = await negotiationService.getNegotiation(body.negotiationId);

    if (!negotiation) {
      return Response.json({ error: 'Negotiation not found' }, { status: 404 });
    }

    // Check if user is a participant
    const isParticipant = negotiation.participants.some(p => p.userId === user.id);
    if (!isParticipant) {
      return Response.json({ error: 'Access denied' }, { status: 403 });
    }

    return Response.json({
      negotiation: {
        ...negotiation,
        createdAt: negotiation.createdAt.toISOString(),
        updatedAt: negotiation.updatedAt.toISOString(),
      },
    });
  }

  /**
   * Get negotiation statistics for the authenticated user.
   */
  @Get('/stats')
  @UseGuards(AuthGuard)
  async stats(_req: Request, user: AuthenticatedUser) {
    const stats = await negotiationService.getUserNegotiationStats(user.id);
    return Response.json({ stats });
  }
}
