import { z } from 'zod';

import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { FastSignalIntakeEnabledGuard } from '../guards/fast-intake.guard';
import { RateLimit } from '../guards/limiter.guard';
import { isFastSignalIntakeEnabled } from '../lib/fast-intake-feature';
import { log } from '../lib/log';
import { Controller, Post, UseGuards } from '../lib/router/router.decorators';
import { IntakeNetworkMembershipError, IntakeRunNotFoundError, IntakeVerificationRejectedError, signalIntakeService, type SignalIntakeService } from '../services/signal-intake.service';

const logger = log.controller.from('intent-intake');

// An answer with no selected options and no free text carries no signal, yet it
// still drives synthesis, the intent graph, and a durable proposal write. Reject
// it at the edge instead.
const AnswerSchema = z.object({
  selectedOptions: z.array(z.string().trim().min(1)).default([]),
  freeText: z.string().trim().optional(),
}).strict().refine(
  (answer) => answer.selectedOptions.length > 0 || Boolean(answer.freeText),
  { message: 'answer must have at least one selected option or free text' },
);
const RoundSchema = z.object({
  prompt: z.string().trim().min(1).max(400),
  answer: AnswerSchema,
}).strict();
const RoundsSchema = z.array(RoundSchema).min(1).max(10);
const QuestionSchema = z.object({
  rounds: RoundsSchema,
  plannedTotal: z.number().int().min(1).max(10).optional(),
}).strict();
const PrepareSchema = z.object({ rounds: RoundsSchema }).strict();
const ProposalSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  rounds: RoundsSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
  whereText: z.string().trim().max(280).optional(),
}).strict();
const ReviseSchema = z.object({
  runId: z.string().uuid('runId must be a UUID'),
  feedback: z.string().trim().min(1).max(600),
  rounds: RoundsSchema,
  networkId: z.string().uuid('networkId must be a UUID').optional(),
}).strict();

/**
 * Deterministic fast-intake funnel. Gated by FAST_SIGNAL_INTAKE.
 *
 * `FastSignalIntakeEnabledGuard` is the real gate: it runs before AuthGuard,
 * so a flag-off deployment 404s unauthenticated probes too. The in-handler
 * `isFastSignalIntakeEnabled()` checks
 * below are defense-in-depth for direct/unit-test invocations that bypass
 * the guard pipeline.
 */
@Controller('/intents/intake')
export class IntentIntakeController {
  private readonly service: Pick<
    SignalIntakeService,
    'getOrCreatePack' | 'followUpQuestions' | 'prepare' | 'resolveProposal' | 'revise'
  >;

  /**
   * @param deps - Optional service override for focused controller tests.
   */
  constructor(deps?: { service?: SignalIntakeService }) {
    this.service = deps?.service ?? signalIntakeService;
  }

  /** Round 1: pack lookup, or synchronous generation on a cold miss. */
  @Post('/start')
  @UseGuards(RateLimit('write'), FastSignalIntakeEnabledGuard, AuthGuard)
  async start(_req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    try {
      const { question } = await this.service.getOrCreatePack(user.id);
      return Response.json({ question });
    } catch (error) {
      return this.fail(error, user.id, 'start');
    }
  }

  /** Follow-ups: planned batch or single question, with the locked total. */
  @Post('/question')
  @UseGuards(RateLimit('write'), FastSignalIntakeEnabledGuard, AuthGuard)
  async question(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = QuestionSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    try {
      const { questions, total } = await this.service.followUpQuestions(user.id, parsed.data);
      return Response.json({ questions, total });
    } catch (error) {
      return this.fail(error, user.id, 'question');
    }
  }

  /**
   * Start speculative synthesis and return immediately.
   *
   * Rate-limited as `intake_synthesis`, not `write`: a 202 here launches a
   * background synthesis plus a full intent-graph run and writes a durable
   * proposal row, so the ordinary write budget is far too loose for it.
   */
  @Post('/prepare')
  @UseGuards(RateLimit('intake_synthesis'), FastSignalIntakeEnabledGuard, AuthGuard)
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
  @UseGuards(RateLimit('intake_synthesis'), FastSignalIntakeEnabledGuard, AuthGuard)
  async proposal(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ProposalSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, whereText, networkId, rounds } = parsed.data;
    try {
      // `networkId` must reach the proposal row: /intents/confirm rejects any
      // confirmation whose networkId differs from the stored one.
      const proposal = await this.service.resolveProposal(user.id, {
        runId,
        rounds,
        ...(whereText ? { whereText } : {}),
        ...(networkId ? { networkId } : {}),
      });
      return Response.json(proposal);
    } catch (error) {
      return this.fail(error, user.id, 'proposal');
    }
  }

  /**
   * Replace the visible draft from user feedback.
   *
   * Shares `prepare`'s tighter limiter class: this also synthesizes and writes a
   * replacement proposal row.
   */
  @Post('/revise')
  @UseGuards(RateLimit('intake_synthesis'), FastSignalIntakeEnabledGuard, AuthGuard)
  async revise(req: Request, user: AuthenticatedUser) {
    if (!isFastSignalIntakeEnabled()) return new Response(null, { status: 404 });
    const parsed = ReviseSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return this.invalid(parsed.error);
    const { runId, feedback, networkId, rounds } = parsed.data;
    try {
      // The replacement proposal is a new row, so the already-picked community
      // travels with the revision too.
      const proposal = await this.service.revise(user.id, {
        runId, feedback, rounds,
        ...(networkId ? { networkId } : {}),
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
    if (error instanceof IntakeNetworkMembershipError) {
      return Response.json({
        error: 'forbidden',
        code: 'network_membership_required',
        networkId: error.networkId,
      }, { status: 403 });
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
