import { z } from 'zod';

import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { isAgentActionsEnabled } from '../lib/agent-surface-feature';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import type { AgentActionService } from '../services/agent-action.service';

const ConfirmSchema = z.object({
  proposalId: z.string().uuid('proposalId must be a UUID'),
}).strict();

/** Session-only canonical reads and confirmations for gated reporter cleanup proposals. */
@Controller('/agent/actions')
export class AgentActionController {
  constructor(
    private readonly service: Pick<AgentActionService, 'readProposal' | 'confirm'>,
    private readonly enabled: () => boolean = isAgentActionsEnabled,
  ) {}

  @Get('/proposals/:proposalId')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async readProposal(_req: Request, user: AuthenticatedUser, params: { proposalId: string }) {
    if (!this.enabled()) return Response.json({ error: 'Not found' }, { status: 404 });

    const parsed = z.string().uuid('proposalId must be a UUID').safeParse(params.proposalId);
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const proposal = await this.service.readProposal(user.id, parsed.data);
    if (!proposal) return Response.json({ error: 'Action proposal not found' }, { status: 404 });

    return Response.json({
      success: true,
      proposalId: proposal.proposalId,
      status: proposal.status,
      actions: proposal.actions,
      results: proposal.results,
    });
  }

  @Post('/confirm')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async confirm(req: Request, user: AuthenticatedUser) {
    if (!this.enabled()) return Response.json({ error: 'Not found' }, { status: 404 });

    const parsed = ConfirmSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await this.service.confirm(user.id, parsed.data.proposalId);
    if (result.kind === 'not_found') {
      return Response.json({ error: 'Action proposal not found' }, { status: 404 });
    }
    if (result.kind === 'in_progress') {
      return Response.json({ error: 'Action proposal is already being confirmed', retryable: true }, { status: 409 });
    }

    return Response.json({
      success: true,
      proposalId: result.result.proposalId,
      status: result.result.status,
      results: result.result.results,
    });
  }
}
