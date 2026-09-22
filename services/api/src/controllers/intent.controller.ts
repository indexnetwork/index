import { z } from 'zod';

import { AuthGuard, isSessionAuthenticated, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { IntentPreparationReceiptError } from '../lib/intent/intent.preparation';
import { CREATE_OPPORTUNITIES_LIMIT, DISCOVER_LIMIT_MAX, IntentCreateRejectedError, IntentNetworkMembershipError, IntentPreparationFailedError, intentService } from '../services/intent.service';
import { opportunityService } from '../services/opportunity.service';
import { parseListOpportunitiesQuery } from '../services/opportunity.list-query';

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
const DiscoverSchema = z.object({
  query: z.string().trim().min(1, 'query is required').max(2_000),
  limit: z.number().int().min(1).max(DISCOVER_LIMIT_MAX).optional(),
}).strict();
const CreateOpportunitiesSchema = z.object({
  counterparties: z.array(z.object({
    intentId: z.string().uuid('intentId must be a UUID'),
    networkId: z.string().uuid('networkId must be a UUID'),
  }).strict()).min(1, 'counterparties is required').max(CREATE_OPPORTUNITIES_LIMIT),
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
   * Search an owned signal's communities for counterparties.
   *
   * Nothing is written and nothing is judged here: the caller reads the ranked
   * counterparties and decides which are worth an opportunity.
   *
   * @param req - Request with body `{ query: string, limit?: number }`, `limit` being the top-N to return.
   * @param user - Authenticated owner.
   * @param params - Intent UUID or short prefix.
   * @returns The ranked counterparties this query found.
   */
  @Post('/:id/discover')
  @UseGuards(AuthGuard)
  async discover(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = DiscoverSchema.safeParse(raw);
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

    const result = await intentService.discover(resolved.id, user.id, parsed.data);
    if (result.kind === 'not_found') {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    if (result.kind === 'inactive') {
      return Response.json({ error: 'Only an active signal can be searched' }, { status: 409 });
    }

    return Response.json({ counterparties: result.counterparties });
  }

  /**
   * Create one opportunity per counterparty the caller picked.
   *
   * Idempotent on the pair: a counterparty that already shares an opportunity
   * with this signal reports that one rather than a second.
   *
   * @param req - Request with body `{ counterparties: { intentId, networkId }[] }`.
   * @param user - Authenticated owner.
   * @param params - Intent UUID or short prefix.
   * @returns The opportunities that now exist for the picked counterparties.
   */
  @Post('/:id/opportunities')
  @UseGuards(AuthGuard)
  async createOpportunities(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const raw = await req.json().catch(() => ({}));
    const parsed = CreateOpportunitiesSchema.safeParse(raw);
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

    const result = await intentService.createOpportunities(resolved.id, user.id, parsed.data.counterparties);
    if (result.kind === 'not_found') {
      return Response.json({ error: 'Intent not found' }, { status: 404 });
    }
    if (result.kind === 'inactive') {
      return Response.json({ error: 'Only an active signal can open opportunities' }, { status: 409 });
    }

    const opportunities = await Promise.all(
      result.opportunities.map(async ({ opportunityId }) => {
        const opp = await opportunityService.getStoredOpportunity(opportunityId);
        if (!opp) return null;
        opportunityService.warmPresentationCache(
          opp,
          opp.actors.map((actor) => actor.userId),
          resolved.id,
        );
        return opportunityService.presentOpportunityForViewer(opp, user.id, resolved.id);
      }),
    );

    return Response.json({ opportunities: opportunities.filter((row) => row !== null) });
  }

  /**
   * GET /intents/:id/opportunities — presented opportunity cards scoped to one signal.
   */
  @Get('/:id/opportunities')
  @UseGuards(AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, params: { id: string }) {
    const resolved = await intentService.resolveId(params.id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const query = parseListOpportunitiesQuery(url);
    if (query instanceof Response) return query;

    const result = await opportunityService.presentOpportunitiesForViewer(user.id, {
      ...query,
      intentId: resolved.id,
    });
    if ('error' in result) {
      logger.error('listIntentOpportunities failed', { userId: user.id, intentId: resolved.id, error: result.error });
      return Response.json({ error: result.error }, { status: 500 });
    }

    return Response.json(result);
  }

  /**
   * PATCH /intents/:id/opportunities/:opportunityId/status — intent-scoped status update.
   */
  @Patch('/:id/opportunities/:opportunityId/status')
  @UseGuards(AuthGuard)
  async updateOpportunityStatus(req: Request, user: AuthenticatedUser, params: { id: string; opportunityId: string }) {
    const resolvedIntent = await intentService.resolveId(params.id, user.id);
    if ('error' in resolvedIntent) {
      return Response.json({ error: resolvedIntent.error }, { status: resolvedIntent.status });
    }

    const resolvedOpportunity = await opportunityService.resolveId(params.opportunityId, user.id);
    if ('error' in resolvedOpportunity) {
      return Response.json({ error: resolvedOpportunity.error }, { status: resolvedOpportunity.status });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const rawStatus = typeof (body as Record<string, unknown>).status === 'string'
      ? (body as Record<string, unknown>).status as string
      : undefined;
    const allowed = ['pending', 'negotiating', 'accepted', 'rejected', 'expired'];
    if (!rawStatus || !allowed.includes(rawStatus)) {
      return Response.json({ error: 'Invalid status; use one of: ' + allowed.join(', ') }, { status: 400 });
    }

    const result = await opportunityService.updateOpportunityStatus(
      resolvedOpportunity.id,
      rawStatus as 'pending' | 'negotiating' | 'accepted' | 'rejected' | 'expired',
      user.id,
      {
        intentId: resolvedIntent.id,
        actionProvenance: isSessionAuthenticated(req) ? 'user_session' : 'api_key',
      },
    );

    if (result && 'error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status as number },
      );
    }

    return Response.json(result);
  }

  /**
   * POST /intents/:id/opportunities/:opportunityId/start-chat — intent-scoped start chat.
   */
  @Post('/:id/opportunities/:opportunityId/start-chat')
  @UseGuards(AuthGuard)
  async startOpportunityChat(_req: Request, user: AuthenticatedUser, params: { id: string; opportunityId: string }) {
    const resolvedIntent = await intentService.resolveId(params.id, user.id);
    if ('error' in resolvedIntent) {
      return Response.json({ error: resolvedIntent.error }, { status: resolvedIntent.status });
    }

    const resolvedOpportunity = await opportunityService.resolveId(params.opportunityId, user.id);
    if ('error' in resolvedOpportunity) {
      return Response.json({ error: resolvedOpportunity.error }, { status: resolvedOpportunity.status });
    }

    const result = await opportunityService.startChat(resolvedOpportunity.id, user.id, {
      intentId: resolvedIntent.id,
      actionProvenance: isSessionAuthenticated(_req) ? 'user_session' : 'api_key',
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
