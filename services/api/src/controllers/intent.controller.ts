import { z } from 'zod';

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { Intents } from '@indexnetwork/protocol';
import { IntentCreateRejectedError, IntentNetworkMembershipError, intentService } from '../services/intent.service';

const logger = log.controller.from('intent');

const CreateSchema = z.object({
  description: z.string().trim().min(1, 'description is required').max(65_536),
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
      totalWaitingOpportunities: result.totalWaitingOpportunities,
      pagination: result.pagination,
    });
  }

  /**
   * Run one stateless clarification round over a draft signal.
   *
   * Nothing is stored: the caller sends the payload it is holding plus any
   * answers gathered so far, and gets back the payload with those answers
   * written into it alongside whatever is still worth asking. Answering is
   * always optional — the client may go straight to create.
   *
   * @param req - Request with body `{ payload: string; answers?: { question, answer }[] }`
   * @returns The rewritten payload and the next questions.
   */
  @Post('/clarify')
  @UseGuards(RateLimit('intent_llm'), AuthGuard)
  async clarify(req: Request) {
    const raw = await req.json().catch(() => ({}));
    const parsed = ClarifySchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await new Intents().clarify(parsed.data);
    return Response.json(result);
  }

  /**
   * Create one signal and share it in the networks the owner chose.
   *
   * @param req - Request with body `{ description: string; networkIds?: string[] }`
   * @param user - Authenticated user from AuthGuard
   * @returns The created intent id and the networks it was linked to.
   */
  @Post('')
  @UseGuards(RateLimit('intent_llm'), AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateSchema.safeParse(raw);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { description, networkIds } = parsed.data;

    try {
      const created = await intentService.create(user.id, description, networkIds);
      return Response.json({ intentId: created.id, networkIds: created.networkIds });
    } catch (err) {
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
