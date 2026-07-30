import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { isFastSignalIntakeEnabled } from '../lib/fast-intake-feature';
import { log } from '../lib/log';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { IntakeRunNotFoundError, IntakeVerificationRejectedError, signalIntakeService, type SignalIntakeService } from '../services/signal-intake.service';

const logger = log.controller.from('intent-intake');

const AnswerSchema = z.object({
  selectedOptions: z.array(z.string()).default([]),
  freeText: z.string().trim().optional(),
}).strict();
const QuestionSchema = z.object({ whoAnswer: AnswerSchema }).strict();
const PrepareSchema = z.object({
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
  round2Prompt: z.string().trim().max(400).optional(),
}).strict();
const ProposalSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
  whereText: z.string().trim().max(280).optional(),
}).strict();
const ReviseSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  feedback: z.string().trim().min(1).max(600),
  whoAnswer: AnswerSchema,
  bringAnswer: AnswerSchema,
}).strict();

/** Deterministic fast-intake funnel. Gated by FAST_SIGNAL_INTAKE. */
@Controller('/intents/intake')
export class IntentIntakeController {
  private readonly service: Pick<
    SignalIntakeService,
    'getOrCreatePack' | 'nextQuestion' | 'prepare' | 'resolveProposal' | 'revise'
  >;

  /**
   * @param deps - Optional service override for focused controller tests.
   */
  constructor(deps?: { service?: SignalIntakeService }) {
    this.service = deps?.service ?? signalIntakeService;
  }

  /** Round 1: pack lookup, or synchronous generation on a cold miss. */
  @Post('/start')
  @UseGuards(RateLimit('write'), AuthGuard)
  async start(_req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    try {
      const { question } = await this.service.getOrCreatePack(user.id);
      return Response.json({ question });
    } catch (error) {
      return this.fail(error, user.id, 'start');
    }
  }

  /** Round 2: one structured call grounded by the brief and round-1 answer. */
  @Post('/question')
  @UseGuards(RateLimit('write'), AuthGuard)
  async question(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = QuestionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    try {
      const question = await this.service.nextQuestion(user.id, parsed.data.whoAnswer);
      return Response.json({ question });
    } catch (error) {
      return this.fail(error, user.id, 'question');
    }
  }

  /** Start speculative synthesis and return immediately. */
  @Post('/prepare')
  @UseGuards(RateLimit('write'), AuthGuard)
  async prepare(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = PrepareSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    try {
      const { runId } = await this.service.prepare(user.id, parsed.data);
      return Response.json({ runId }, { status: 202 });
    } catch (error) {
      return this.fail(error, user.id, 'prepare');
    }
  }

  /** Resolve the speculative proposal, or redo it when the where-text changed it. */
  @Post('/proposal')
  @UseGuards(RateLimit('write'), AuthGuard)
  async proposal(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ProposalSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, whereText, whoAnswer, bringAnswer } = parsed.data;
    try {
      const proposal = await this.service.resolveProposal(user.id, {
        runId,
        answers: { whoAnswer, bringAnswer },
        ...(whereText ? { whereText } : {}),
      });
      return Response.json(proposal);
    } catch (error) {
      return this.fail(error, user.id, 'proposal');
    }
  }

  /** Replace the visible draft from user feedback. */
  @Post('/revise')
  @UseGuards(RateLimit('write'), AuthGuard)
  async revise(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ReviseSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, feedback, whoAnswer, bringAnswer } = parsed.data;
    try {
      const proposal = await this.service.revise(user.id, {
        runId, feedback, answers: { whoAnswer, bringAnswer },
      });
      return Response.json(proposal);
    } catch (error) {
      return this.fail(error, user.id, 'revise');
    }
  }

  /** 400 with flattened Zod details, matching IntentController. */
  private invalid(error: z.ZodError) {
    return Response.json({ error: 'Validation failed', details: error.flatten() }, { status: 400 });
  }

  /**
   * Map service errors onto stable client codes.
   *
   * Verification rejection is recoverable: it carries the clarification question
   * the web app renders as a fourth round before retrying.
   */
  private fail(error: unknown, userId: string, stage: string) {
    if (error instanceof IntakeRunNotFoundError) {
      return Response.json({ error: 'run_not_found', code: 'run_not_found' }, { status: 404 });
    }
    if (error instanceof IntakeVerificationRejectedError) {
      return Response.json({
        error: 'verification_rejected',
        code: 'verification_rejected',
        clarification: error.clarification,
      }, { status: 422 });
    }
    logger.error('Intake request failed', { userId, stage, error });
    return Response.json({ error: 'Failed to process intake request' }, { status: 500 });
  }
}
