import { z } from 'zod';

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { IntentPreparationReceiptError } from '../lib/intent/intent.preparation';
import { IntentCreateRejectedError, IntentNetworkMembershipError, IntentPreparationFailedError, intentService } from '../services/intent.service';

const logger = log.controller.from('intent');

const CreateSchema = z.object({
  description: z.string().max(65_536).refine((text) => text.trim().length > 0, 'description is required'),
  preparationReceipt: z.string().min(1).max(65_536).optional(),
  networkIds: z.array(z.string().uuid('networkIds must be UUIDs')).default([]),
}).strict();
const ClarifySchema = z.object({
  payload: z.string().trim().min(1, 'payload is required').max(65_536),
  answers: z.array(z.object({
    prompt: z.string().trim().min(1),
    answer: z.string().trim().min(1),
  })).default([]),
}).strict();
const StatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PAUSED']),
});
const UpdateSchema = z.object({
  description: z.string().trim().min(1, 'description is required').max(65_536),
}).strict();
const LinkSchema = z.object({
  networkId: z.string().uuid('networkId must be a UUID'),
}).strict();

@Controller('/intents')
export class IntentController {
  /**
   * List intents with pagination, filters, and an optional text query over
   * the caller's own signals (`q`, matched against description and summary).
   */
  @Post('/list')
  @UseGuards(AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      page?: number;
      limit?: number;
      archived?: boolean;
      sourceType?: string;
      q?: string;
    };

    const result = await intentService.listIntents(user.id, {
      page: body.page,
      limit: body.limit,
      archived: body.archived,
      sourceType: body.sourceType,
      q: body.q?.trim() || undefined,
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
   * Run one stateless clarification round over a draft signal.
   *
   * @param req - Current payload and answers not yet folded into it.
   * @param user - Authenticated owner.
   * @returns An admitted draft with a receipt, or repairable feedback and questions.
   */
  @Post('/clarify')
  @UseGuards(AuthGuard)
  async clarify(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ClarifySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    try {
      return Response.json(await intentService.clarify(user.id, parsed.data));
    } catch (error) {
      logger.error('Intent preparation failed', { userId: user.id, error });
      return Response.json({ error: 'preparation_failed', detail: 'Could not prepare this signal. Your answers are kept; try again.', retryable: true }, { status: 503 });
    }
  }

  /**
   * Create one signal and share it in the networks the owner chose.
   *
   * @param req - Request with body `{ description: string; networkIds?: string[]; preparationReceipt?: string }`
   * @param user - Authenticated user from AuthGuard
   * @returns The created intent id and the networks it was linked to.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { description, networkIds, preparationReceipt } = parsed.data;

    try {
      const created = await intentService.create(user.id, description, networkIds, preparationReceipt);
      return Response.json({ intentId: created.id, networkIds: created.networkIds });
    } catch (err) {
      if (err instanceof IntentPreparationReceiptError) {
        return Response.json({ error: 'invalid_preparation', detail: err.message }, { status: 403 });
      }
      if (err instanceof IntentPreparationFailedError) {
        return Response.json({ error: 'preparation_failed', detail: err.message, retryable: true }, { status: 503 });
      }
      if (err instanceof IntentNetworkMembershipError) {
        return Response.json({
          error: 'forbidden',
          code: err.code,
          detail: err.message,
          networkId: err.networkId,
        }, { status: 403 });
      }
      if (err instanceof IntentCreateRejectedError) {
        return Response.json({ error: err.code, code: err.code, detail: err.message }, { status: 422 });
      }
      logger.error('Intent create failed', { userId: user.id, error: err });
      return Response.json({ error: 'Failed to create intent' }, { status: 500 });
    }
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
  @UseGuards(SessionOnlyGuard)
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = StatusSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.transitionStatus(
      resolved.id,
      user.id,
      parsed.data.status,
    );
    if (result.kind === 'not_found' || result.kind === 'scope_violation') {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
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
   * Rewrite an owned signal's description by ID or short prefix.
   *
   * @param req - Request with body `{ description: string }`.
   * @param user - Authenticated owner.
   * @param params - Route parameters containing the intent identifier.
   * @returns The intent id and the description now stored.
   */
  @Patch('/:id')
  @UseGuards(AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = UpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.update(resolved.id, user.id, parsed.data.description);
    if (result.kind === 'not_found') {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    if (result.kind === 'archived') {
      return Response.json({ error: 'Archived intents cannot be updated' }, { status: 409 });
    }
    if (result.kind === 'rejected') {
      return Response.json({ error: 'intent_rejected', code: 'intent_rejected', detail: result.detail }, { status: 422 });
    }

    return Response.json({ intentId: resolved.id, description: parsed.data.description });
  }

  /**
   * List the communities an owned signal is shared in.
   */
  @Get('/:id/networks')
  @UseGuards(AuthGuard)
  async listNetworks(_req: Request, user: AuthenticatedUser, params: { id: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const networkIds = await intentService.listNetworks(resolved.id, user.id);
    if (!networkIds) {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    return Response.json({ networkIds });
  }

  /**
   * Share an owned signal in one community.
   *
   * @param req - Request with body `{ networkId: string }`.
   */
  @Post('/:id/networks')
  @UseGuards(AuthGuard)
  async addToNetwork(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = LinkSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.addToNetwork(resolved.id, parsed.data.networkId, user.id);
    if (result.kind === 'refused') {
      return Response.json({ error: 'forbidden', detail: result.detail }, { status: 403 });
    }
    return Response.json({ success: true, message: result.message });
  }

  /**
   * Withdraw an owned signal from one community.
   */
  @Delete('/:id/networks/:networkId')
  @UseGuards(AuthGuard)
  async removeFromNetwork(_req: Request, user: AuthenticatedUser, params: { id: string; networkId: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await intentService.removeFromNetwork(resolved.id, params.networkId, user.id);
    if (result.kind === 'refused') {
      return Response.json({ error: 'forbidden', detail: result.detail }, { status: 403 });
    }
    return Response.json({ success: true, message: result.message });
  }

  /**
   * Archive an intent by ID or short prefix.
   */
  @Patch('/:id/archive')
  @UseGuards(AuthGuard)
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
