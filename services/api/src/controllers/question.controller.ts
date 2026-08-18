import { questionService } from '../services/question.service';

import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import { resolveAgentNetworkScope } from '../guards/agent-scope.guard';
import { RateLimit } from '../guards/limiter.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';

const logger = log.controller.from('question');

type RouteParams = Record<string, string>;

/**
 * QuestionController — transition-window endpoints for the retired card
 * questions (conversational-questions plan, "Retirements").
 *
 * The Questions page, the pending-question list, and the counts endpoints are
 * gone. What remains is graceful leftover-row handling for stale clients:
 * answering or dismissing a leftover row voids it (`retired_mode`) without
 * invoking any retired reaction handler, and reports success when a settled
 * row is contacted again.
 */
@Controller('/questions')
export class QuestionController {
  /**
   * POST /questions/:id/answer — void a leftover question on contact.
   *
   * The card answer pipeline is retired; the submitted answer body is
   * accepted for wire compatibility and intentionally not recorded.
   */
  @Post('/:id/answer')
  @UseGuards(RateLimit('write'), AuthGuard)
  async answer(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    return this.voidOnContact(req, user, params, 'answer');
  }

  /**
   * POST /questions/:id/dismiss — void a leftover question on contact.
   */
  @Post('/:id/dismiss')
  @UseGuards(RateLimit('write'), AuthGuard)
  async dismiss(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    return this.voidOnContact(req, user, params, 'dismiss');
  }

  private async voidOnContact(
    req: Request,
    user: AuthenticatedUser,
    params: RouteParams | undefined,
    surface: 'answer' | 'dismiss',
  ) {
    const questionId = params?.id;
    if (!questionId) {
      return Response.json({ error: 'Question ID is required' }, { status: 400 });
    }
    if (await resolveAgentNetworkScope(req)) {
      return Response.json({ error: 'Network-scoped API keys cannot settle questions' }, { status: 403 });
    }

    const outcome = await questionService.voidLeftoverQuestion(questionId, user.id);
    if (outcome === 'not_found') {
      return Response.json({ error: 'Question not found' }, { status: 404 });
    }

    logger.info('Leftover question voided on contact', { questionId, userId: user.id, surface, outcome });
    return Response.json({ success: true });
  }
}
