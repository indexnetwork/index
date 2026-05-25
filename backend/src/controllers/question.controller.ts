import { z } from 'zod';

import { questionService } from '../services/question.service';
import type { AdapterQuestionFilters } from '../services/question.service';

import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
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
const modeQuerySchema = z.enum(['discovery', 'intent', 'profile', 'negotiation']);

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
    const sourceType = url.searchParams.get('sourceType');
    const sourceId = url.searchParams.get('sourceId');
    const conversationId = url.searchParams.get('conversationId');
    const noConversation = url.searchParams.get('noConversation');

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

    if (rawMode) {
      const modeResult = modeQuerySchema.safeParse(rawMode);
      if (!modeResult.success) {
        return Response.json(
          { error: 'Invalid mode; use one of: discovery, intent, profile, negotiation' },
          { status: 400 },
        );
      }
      filters.mode = modeResult.data;
    }
    if (sourceType) filters.sourceType = sourceType;
    if (sourceId) filters.sourceId = sourceId;
    if (conversationId) filters.conversationId = conversationId;
    if (noConversation === 'true') filters.noConversation = true;

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
   * @returns JSON `{ success: true }` on success.
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

    const parsed = answerBodySchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: 'Invalid body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const updated = await questionService.answer(questionId, user.id, {
      ...parsed.data,
      answeredBy: user.id,
      answeredAt: new Date().toISOString(),
    });

    if (!updated) {
      return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    logger.info('Question answered', { questionId, userId: user.id });
    return Response.json({ success: true });
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
  async dismiss(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const questionId = params?.id;
    if (!questionId) {
      return Response.json({ error: 'Question ID is required' }, { status: 400 });
    }

    const updated = await questionService.dismiss(questionId, user.id);

    if (!updated) {
      return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    logger.info('Question dismissed', { questionId, userId: user.id });
    return Response.json({ success: true });
  }
}
