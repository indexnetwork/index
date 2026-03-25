import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { intentService } from '../services/intent.service';
import { userService } from '../services/user.service';

const logger = log.controller.from('intent');

const ConfirmSchema = z.object({
  proposalId: z.string().min(1, 'proposalId is required'),
  description: z.string().min(1, 'description is required'),
  indexId: z.string().optional(),
});
const RejectSchema = z.object({
  proposalId: z.string().min(1, 'proposalId is required'),
});
const ProposalStatusesSchema = z.object({
  proposalIds: z.array(z.string().min(1)).default([]),
});

@Controller('/intents')
export class IntentController {
  /**
   * List intents with pagination and filters.
   */
  @Post('/list')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      page?: number;
      limit?: number;
      archived?: boolean;
      sourceType?: string;
    };

    const result = await intentService.listIntents(user.id, {
      page: body.page,
      limit: body.limit,
      archived: body.archived,
      sourceType: body.sourceType,
    });

    return Response.json({
      intents: result.intents.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
      })),
      pagination: result.pagination,
    });
  }

  /**
   * Confirm a proposed intent from chat. Directly persists the pre-verified
   * intent (embedding + DB insert) without re-running the full intent graph.
   * @param req - Request with body `{ proposalId: string; description: string; indexId?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns The created intent
   */
  @Post('/confirm')
  @UseGuards(AuthGuard)
  async confirm(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ConfirmSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { proposalId, description, indexId } = parsed.data;

    logger.verbose('Intent confirm requested', { userId: user.id, proposalId });

    try {
      const created = await intentService.createFromProposal(user.id, description, proposalId, indexId);

      return Response.json({
        success: true,
        proposalId,
        intentId: created.id,
      });
    } catch (err) {
      logger.error('Intent confirm failed', { userId: user.id, proposalId, error: err });
      return Response.json({ error: 'Failed to process intent confirmation' }, { status: 500 });
    }
  }

  /**
   * Reject a proposed intent from chat. Logs the rejection for analytics.
   * @param req - Request with body `{ proposalId: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns Acknowledgement with the proposal ID
   */
  @Post('/reject')
  @UseGuards(AuthGuard)
  async reject(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = RejectSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { proposalId } = parsed.data;

    logger.verbose('Intent proposal rejected', { userId: user.id, proposalId });

    return Response.json({
      success: true,
      proposalId,
    });
  }

  /**
   * Batch-check proposal statuses. Returns which proposalIds have been confirmed.
   * @param req - Request with body `{ proposalIds: string[] }`
   * @param user - Authenticated user from AuthGuard
   * @returns Map of proposalId -> status
   */
  @Post('/proposals/status')
  @UseGuards(AuthGuard)
  async proposalStatuses(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ProposalStatusesSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { proposalIds } = parsed.data;

    const statuses = await intentService.getProposalStatuses(user.id, proposalIds);

    return Response.json({ statuses });
  }

  /**
   * Get a shared intent by share token (public, no auth).
   * @param params - URL params with share token
   * @returns Intent data with owner profile
   */
  @Get('/shared/:token')
  async getSharedIntent(_req: Request, _user: unknown, params: { token: string }) {
    const data = await intentService.getSharedIntent(params.token);
    if (!data) {
      return Response.json({ error: 'Shared intent not found' }, { status: 404 });
    }
    return Response.json({
      intent: {
        id: data.id,
        payload: data.payload,
        summary: data.summary,
        createdAt: data.createdAt.toISOString(),
      },
      owner: {
        id: data.userId,
        name: data.ownerName,
        avatar: data.ownerAvatar,
        intro: data.ownerIntro,
      },
    });
  }

  /**
   * Generate a share token for an intent.
   * @param params - URL params with intent ID
   * @param user - Authenticated user from AuthGuard
   * @returns The share token
   */
  @Post('/:id/share')
  @UseGuards(AuthGuard)
  async shareIntent(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const shareToken = await intentService.shareIntent(params.id, user.id);
    if (!shareToken) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    return Response.json({ shareToken });
  }

  /**
   * Get a single intent by ID.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const r = await intentService.getById(params.id, user.id);

    if (!r) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }

    return Response.json({
      intent: {
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        archivedAt: r.archivedAt?.toISOString() ?? null,
      },
    });
  }

  /**
   * Archive an intent.
   */
  @Patch('/:id/archive')
  @UseGuards(AuthGuard)
  async archive(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const result = await intentService.archive(params.id, user.id);
    
    if (!result.success) {
      return Response.json({ error: result.error }, { status: 404 });
    }

    return Response.json({ success: true });
  }

  /**
   * Process user input through the Intent Graph.
   */
  @Post('/process')
  @UseGuards(AuthGuard)
  async process(req: Request, user: AuthenticatedUser) {
    logger.verbose('Intent process requested', { userId: user.id });

    let content: string | undefined;
    try {
      const body = await req.json() as { content?: string };
      content = body.content;
    } catch {
      // No body or invalid JSON
    }

    const userWithGraph = await userService.findWithGraph(user.id);
    const userProfile = userWithGraph?.profile ? JSON.stringify(userWithGraph.profile) : '{}';
    const result = await intentService.processIntent(user.id, userProfile, content);

    return Response.json(result);
  }
}
