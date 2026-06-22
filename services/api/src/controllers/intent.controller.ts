import { z } from 'zod';

import { assertAgentNetworkScope } from '../guards/agent-scope.guard';
import { AuthGuard, AuthOrApiKeyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { intentService } from '../services/intent.service';

const logger = log.controller.from('intent');

const ConfirmSchema = z.object({
  proposalId: z.string().min(1, 'proposalId is required'),
  description: z.string().min(1, 'description is required'),
  networkId: z.string().optional(),
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
  @UseGuards(RateLimit('write'), AuthGuard)
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
   * @param req - Request with body `{ proposalId: string; description: string; networkId?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns The created intent
   */
  @Post('/confirm')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async confirm(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ConfirmSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { proposalId, description, networkId } = parsed.data;

    logger.verbose('Intent confirm requested', { userId: user.id, proposalId });

    if (networkId) {
      await assertAgentNetworkScope(req, networkId);
    }

    try {
      const created = await intentService.createFromProposal(user.id, description, proposalId, networkId);

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
  @UseGuards(RateLimit('write'), AuthGuard)
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
  @UseGuards(RateLimit('write'), AuthGuard)
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
   * Get a single intent by ID or short prefix.
   */
  @Get('/:id')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const r = await intentService.getById(resolved.id, user.id);

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
   * Archive an intent by ID or short prefix.
   */
  @Patch('/:id/archive')
  @UseGuards(RateLimit('write'), AuthGuard)
  async archive(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.archive(resolved.id, user.id);

    if (!result.success) {
      return Response.json({ error: result.error }, { status: 404 });
    }

    return Response.json({ success: true });
  }

}
