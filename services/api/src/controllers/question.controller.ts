import { z } from 'zod';

import { questionService } from '../services/question.service';
import type { AdapterQuestionFilters } from '../services/question.service';

import { hasChatQuestionWaiter } from '../lib/chat-question.events';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, SessionOnlyGuard } from '../guards/auth.guard';
import { resolveAgentNetworkScope } from '../guards/agent-scope.guard';
import { RateLimit } from '../guards/limiter.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('question');

type RouteParams = Record<string, string>;

const answerBodySchema = z.object({
  selectedOptions: z.array(z.string()),
  freeText: z.string().optional(),
});

const statusQuerySchema = z.enum(['pending', 'answered', 'dismissed']).default('pending');
const purposeQuerySchema = z.enum(['uptake']);
const modeQuerySchema = z.enum(['discovery', 'intent', 'enrichment', 'negotiation', 'negotiation_inflight', 'chat', 'pool_discovery']);
const uuidQuerySchema = z.string().uuid();
const scopeTypeQuerySchema = z.enum(['intent']);

function parseIntentScopeFromUrl(url: URL): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = url.searchParams.get('scopeType') ?? undefined;
  const rawScopeId = url.searchParams.get('scopeId') ?? undefined;
  const rawIntentId = url.searchParams.get('intentId') ?? undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}

/**
 * QuestionController: REST API for question delivery and lifecycle.
 *
 * Endpoints:
 * - GET /questions — list questions for the authenticated user
 * - POST /questions/:id/answer — submit an answer
 * - POST /questions/:id/dismiss — dismiss a question
 */
@Controller('/questions')
export class QuestionController {
  /**
   * GET /questions/counts — canonical split pending counts.
   *
   * @param _req - Incoming authenticated request.
   * @param user - Authenticated recipient.
   * @returns Global inbox, pushed-pool, and Personal Agent counts.
   */
  @Get('/counts')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async counts(_req: Request, user: AuthenticatedUser) {
    return Response.json(await questionService.countPending(user.id));
  }

  /**
   * GET /questions — list questions for the authenticated user.
   *
   * Query params: status (default: pending), mode, sourceType, sourceId, conversationId, noConversation.
   *
   * @param req  - Incoming request with optional query params.
   * @param user - Authenticated user from AuthGuard.
   * @returns JSON with `{ questions }` array.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const rawMode = url.searchParams.get('mode');
    const rawPurpose = url.searchParams.get('purpose');
    const sourceType = url.searchParams.get('sourceType');
    const sourceId = url.searchParams.get('sourceId');
    const conversationId = url.searchParams.get('conversationId');
    const noConversation = url.searchParams.get('noConversation');
    const rawExcludeModes = url.searchParams.get('excludeModes');
    const scope = parseIntentScopeFromUrl(url);
    if (scope instanceof Response) return scope;

    const statusResult = statusQuerySchema.safeParse(rawStatus ?? 'pending');
    if (!statusResult.success) {
      return Response.json(
        { error: 'Invalid status; use one of: pending, answered, dismissed' },
        { status: 400 },
      );
    }
    const status = statusResult.data;

    if (status !== 'pending') {
      return Response.json(
        { error: 'Only status=pending is currently supported' },
        { status: 400 },
      );
    }

    const filters: AdapterQuestionFilters = {};
    const networkScopeId = await resolveAgentNetworkScope(req);
    if (networkScopeId) {
      filters.networkId = networkScopeId;
      // Match MCP scope policy: negotiation questions can contain context from
      // another user/network and are not listable through network-scoped keys.
      filters.modes = ['enrichment', 'intent', 'discovery'];
    }

    if (rawMode) {
      const modeResult = modeQuerySchema.safeParse(rawMode);
      if (!modeResult.success) {
        return Response.json(
          { error: 'Invalid mode; use one of: discovery, intent, enrichment, negotiation, negotiation_inflight, chat, pool_discovery' },
          { status: 400 },
        );
      }
      filters.mode = modeResult.data;
    }
    if (rawPurpose) {
      const purposeResult = purposeQuerySchema.safeParse(rawPurpose);
      if (!purposeResult.success) {
        return Response.json({ error: 'Invalid purpose; use: uptake' }, { status: 400 });
      }
      filters.purpose = purposeResult.data;
    }
    if (rawExcludeModes) {
      const parsed = rawExcludeModes.split(',').map((m) => modeQuerySchema.safeParse(m.trim()));
      if (parsed.some((r) => !r.success)) {
        return Response.json(
          { error: 'Invalid excludeModes; use a comma-separated list of: discovery, intent, enrichment, negotiation, negotiation_inflight, chat, pool_discovery' },
          { status: 400 },
        );
      }
      filters.excludeModes = parsed.map((r) => (r as { success: true; data: AdapterQuestionFilters['mode'] & string }).data);
    }
    if (sourceType) filters.sourceType = sourceType;
    if (sourceId) filters.sourceId = sourceId;
    if (scope.scopeType === 'intent') {
      filters.scopeType = 'intent';
      filters.scopeId = scope.scopeId;
    }
    if (conversationId) filters.conversationId = conversationId;
    if (noConversation === 'true') filters.noConversation = true;

    // Pool questions are intent-page-only rows. Even delivered pushes affect
    // only the Personal Agent count and DM line, never the global inbox/list.
    if (scope.scopeType !== 'intent' && !conversationId) {
      filters.excludeModes = [...new Set([...(filters.excludeModes ?? []), 'pool_discovery' as const])];
    }

    const hasFilters = Object.keys(filters).length > 0;
    const questions = await questionService.findPending(user.id, hasFilters ? filters : undefined);

    logger.verbose('Questions listed', { userId: user.id, count: questions.length });
    return Response.json({ questions });
  }

  /**
   * POST /questions/:id/answer — submit an answer for a question.
   *
   * @param req    - Request with JSON body `{ selectedOptions, freeText? }`.
   * @param user   - Authenticated user from AuthGuard.
   * @param params - Route params; `id` is the question ID.
   * @returns JSON `{ success: true, resumed }` on success — `resumed` is true
   *   when a live chat turn was blocked on this question (ask_user_question)
   *   and will now continue streaming with the answer.
   */
  @Post('/:id/answer')
  @UseGuards(RateLimit('write'), AuthGuard)
  async answer(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const questionId = params?.id;
    if (!questionId) {
      return Response.json({ error: 'Question ID is required' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (await resolveAgentNetworkScope(req)) {
      return Response.json({ error: 'Network-scoped API keys cannot answer pending questions' }, { status: 403 });
    }

    const parsed = answerBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Snapshot before answering: the waiter unsubscribes once resolved, so
    // checking afterwards would always report false.
    const hadWaiter = hasChatQuestionWaiter(questionId);

    const updated = await questionService.answer(questionId, user.id, {
      ...parsed.data,
      answeredBy: user.id,
      answeredAt: new Date().toISOString(),
    });

    if (!updated) {
      return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    logger.info('Question answered', { questionId, userId: user.id, resumed: hadWaiter });
    return Response.json({ success: true, resumed: hadWaiter });
  }

  /**
   * POST /questions/:id/dismiss — dismiss a question.
   *
   * @param _req   - Incoming request (body is ignored).
   * @param user   - Authenticated user from AuthGuard.
   * @param params - Route params; `id` is the question ID.
   * @returns JSON `{ success: true }` on success.
   */
  @Post('/:id/dismiss')
  @UseGuards(RateLimit('write'), AuthGuard)
  async dismiss(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const questionId = params?.id;
    if (!questionId) {
      return Response.json({ error: 'Question ID is required' }, { status: 400 });
    }

    if (await resolveAgentNetworkScope(req)) {
      return Response.json({ error: 'Network-scoped API keys cannot dismiss pending questions' }, { status: 403 });
    }

    const updated = await questionService.dismiss(questionId, user.id);

    if (!updated) {
      return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    logger.info('Question dismissed', { questionId, userId: user.id });
    return Response.json({ success: true });
  }
}
