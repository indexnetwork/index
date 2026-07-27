import { z } from 'zod';

import { assertAgentNetworkScope, ScopeViolationError, withAgentScope } from '../guards/agent-scope.guard';
import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { IntentAdmissionEnqueueError, IntentNetworkMembershipError, IntentProposalConfirmationError, intentService } from '../services/intent.service';

const logger = log.controller.from('intent');

const ConfirmSchema = z.object({
  proposalId: z.string().uuid('proposalId must be a UUID'),
  description: z.string().trim().min(1, 'description is required'),
  networkId: z.string().uuid('networkId must be a UUID').optional(),
}).strict();
const RejectSchema = z.object({
  proposalId: z.string().uuid('proposalId must be a UUID'),
});
const ProposalStatusesSchema = z.object({
  proposalIds: z.array(z.string().min(1)).default([]),
});
const StatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED']),
});

@Controller('/intents')
export class IntentController {
  private readonly confirmService: Pick<typeof intentService, 'createFromProposal'>;
  private readonly rejectProposal: typeof intentService.rejectProposal;
  private readonly assertConfirmNetworkScope: typeof assertAgentNetworkScope;

  /**
   * @param confirmDeps - Optional confirm-path overrides for focused controller tests.
   */
  constructor(confirmDeps?: {
    service?: Pick<typeof intentService, 'createFromProposal'> & Partial<Pick<typeof intentService, 'rejectProposal'>>;
    assertNetworkScope?: typeof assertAgentNetworkScope;
  }) {
    this.confirmService = confirmDeps?.service ?? intentService;
    this.rejectProposal = confirmDeps?.service?.rejectProposal?.bind(confirmDeps.service)
      ?? intentService.rejectProposal.bind(intentService);
    this.assertConfirmNetworkScope = confirmDeps?.assertNetworkScope ?? assertAgentNetworkScope;
  }

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
      totalWaitingOpportunities: result.totalWaitingOpportunities,
      pagination: result.pagination,
    });
  }

  /**
   * Confirm a proposed intent from chat. Resolves the owner-scoped durable
   * proposal and atomically persists its server-authoritative verifier analysis
   * without re-running the full intent graph.
   * @param req - Request with body `{ proposalId: string; description: string; networkId?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns The created intent
   */
  @Post('/confirm')
  @UseGuards(RateLimit('write'), AuthGuard)
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
      await this.assertConfirmNetworkScope(req, networkId);
    }

    try {
      const created = await this.confirmService.createFromProposal(user.id, description, proposalId, networkId);

      return Response.json({
        success: true,
        proposalId,
        intentId: created.id,
      });
    } catch (err) {
      if (err instanceof IntentNetworkMembershipError) {
        return Response.json({
          error: 'forbidden',
          code: err.code,
          detail: err.message,
          networkId: err.networkId,
        }, { status: 403 });
      }
      if (err instanceof IntentAdmissionEnqueueError) {
        logger.error('Intent confirmation indexing admission was not acknowledged', {
          event: 'intent_admission_enqueue_failed',
          userId: user.id,
          proposalId,
          intentId: err.intentId,
          error: err.cause,
        });
        return Response.json({
          error: 'Intent was saved but indexing could not be queued',
          code: err.code,
          intentId: err.intentId,
          retryable: true,
        }, { status: 503 });
      }
      if (err instanceof IntentProposalConfirmationError) {
        const status = err.code === 'proposal_not_found'
          ? 404
          : err.code === 'proposal_expired'
            ? 410
            : 409;
        return Response.json({
          error: err.code,
          code: err.code,
          detail: err.message,
          proposalId,
        }, { status });
      }
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

    const rejected = await this.rejectProposal(user.id, proposalId);
    if (!rejected) {
      return Response.json({ error: 'proposal_not_found', code: 'proposal_not_found' }, { status: 404 });
    }

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
   * POST /intents/:id/visit — explicit human intent-page visit ping.
   * Session-only, owner-only, monotonic, and intentionally independent from
   * the generic GET so API reads never suppress proactive delivery.
   *
   * @param _req - Session-authenticated request.
   * @param user - Authenticated owner from SessionOnlyGuard.
   * @param params - Intent UUID or short prefix.
   * @returns The authoritative monotonic visit timestamp.
   */
  @Post('/:id/visit')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async visit(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }
    const lastVisitedAt = await intentService.visit(resolved.id, user.id);
    if (!lastVisitedAt) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    return Response.json({ success: true, lastVisitedAt: lastVisitedAt.toISOString() });
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
   * Pause or resume an intent by UUID or short prefix.
   *
   * @param req - Request with body `{ status: 'ACTIVE' | 'PAUSED' }`.
   * @param user - Authenticated owner.
   * @param params - Route parameters containing the intent identifier.
   * @returns Idempotent lifecycle transition result.
   */
  @Patch('/:id/status')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = StatusSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { networkScopeId } = await withAgentScope(req, user);
    const resolved = await intentService.resolveId(params.id, user.id, networkScopeId);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.transitionStatus(
      resolved.id,
      user.id,
      parsed.data.status,
      networkScopeId,
    );
    if (result.kind === 'not_found') {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    if (result.kind === 'scope_violation') {
      throw new ScopeViolationError('Agent is restricted to its bound network scope and cannot act on this intent');
    }
    if (result.kind === 'conflict') {
      return Response.json(
        { error: result.archived ? 'Archived intents cannot change status' : 'Terminal intents cannot change status' },
        { status: 409 },
      );
    }
    if (result.kind === 'stale') {
      return Response.json({ error: 'Intent changed before the status update could be applied', code: 'stale' }, { status: 409 });
    }
    if (result.kind === 'enqueue_failed') {
      return Response.json({
        error: 'Failed to enqueue intent resume',
        code: 'enqueue_failed',
        retryable: true,
        intent: {
          id: result.id,
          status: result.status,
        },
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      intent: {
        id: result.id,
        status: result.status,
        lifecycleVersionMs: result.lifecycleVersionMs,
      },
      changed: result.changed,
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
