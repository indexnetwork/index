import { z } from 'zod';

import { AuthGuard, OwnerControlGuard, SessionOnlyGuard, resolveApiKeyAgentId, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { AgentTestMessageService } from '../services/agent-test-message.service';
import { agentService } from '../services/agent.service';
import { opportunityDeliveryService } from '../services/opportunity-delivery.service';
import { parseFiniteLimit, pickupOpportunityAtControllerBoundary, pickupTestMessageAtControllerBoundary } from '../lib/agent/negotiation-controller-boundary';
import { RuntimeDomainError } from '../lib/agent/runtime-errors';

const agentTestMessageService = new AgentTestMessageService();

const logger = log.controller.from('agent');

type RouteParams = Record<string, string>;

const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().optional(),
});

const updateAgentSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().nullable().optional(),
    status: z.enum(['active', 'inactive']).optional(),
    notifyOnOpportunity: z.boolean().optional(),
    dailySummaryEnabled: z.boolean().optional(),
    handleNegotiations: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const addTransportSchema = z.object({
  channel: z.enum(['mcp']),
  config: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().int().optional(),
});

const grantPermissionSchema = z.object({
  actions: z.array(z.string()).min(1, 'actions array is required'),
  scope: z.enum(['global', 'node', 'network']).optional(),
  scopeId: z.string().optional(),
});

const createTokenSchema = z.object({
  name: z.string().optional(),
});

const enqueueTestMessageSchema = z.object({
  content: z.string().trim().min(1, 'content is required'),
});

const confirmTestMessageDeliveredSchema = z.object({
  reservationToken: z.string().min(1, 'reservationToken is required'),
});

const confirmOpportunityDeliveredSchema = z.object({
  reservationToken: z.string().min(1, 'reservationToken is required'),
});

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function parseErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Unexpected error';
  // Drizzle wraps DB errors in DrizzleQueryError — check for the underlying cause
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeObj = cause as Record<string, unknown> | undefined;
  if (causeObj && typeof causeObj.code === 'string') {
    logger.error('Database error in agent controller', { message: causeObj.message, code: causeObj.code, detail: causeObj.detail });
    return 'Database error';
  }
  return err.message;
}

function errorStatus(err: unknown, fallback = 400): number {
  if (err instanceof RuntimeDomainError) return err.status;
  const message = parseErrorMessage(err);
  if (message === 'Agent not found' || message === 'Transport not found' || message === 'Permission not found' || message === 'Token not found') {
    return 404;
  }

  if (message === 'Not authorized' || message.startsWith('System agents cannot')) {
    return 403;
  }

  return fallback;
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue?.message ?? 'Invalid request body', 400);
  }

  return parsed.data;
}

/**
 * Parse an optional `limit` query param into a finite number.
 * Returns undefined when absent/empty, or a 400 Response when present but not finite.
 * Range clamping is the service's responsibility — see callers' validation contract.
 */
function parseLimitParam(req: Request): number | undefined | Response {
  const parsed = parseFiniteLimit(req.url);
  return parsed.kind === 'invalid'
    ? jsonError('limit must be a finite number', 400)
    : parsed.value;
}

async function parseOptionalBody<T>(req: Request, schema: z.ZodSchema<T>, emptyValue: unknown): Promise<T | Response> {
  const text = await req.text().catch(() => '');
  const trimmed = text.trim();

  let raw: unknown;
  if (!trimmed) {
    raw = emptyValue;
  } else {
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return jsonError('Invalid JSON body', 400);
    }
  }

  const parsed = schema.safeParse(raw ?? emptyValue);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return jsonError(issue?.message ?? 'Invalid request body', 400);
  }

  return parsed.data;
}

@Controller('/agents')
export class AgentController {
  constructor(
    private readonly agents: typeof agentService = agentService,
    private readonly testMessages: AgentTestMessageService = agentTestMessageService,
    private readonly deliveries: typeof opportunityDeliveryService = opportunityDeliveryService,
  ) {}
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const agents = await this.agents.listForUser(user.id);
    logger.verbose('Listed agents', { userId: user.id, count: agents.length });
    return Response.json({ agents });
  }

  @Post('')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await parseBody(req, createAgentSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const agent = await this.agents.create(user.id, body.name, body.description);
      return Response.json({ agent }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/me')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMe(req: Request, user: AuthenticatedUser) {
    const agentId = await resolveApiKeyAgentId(req);
    if (!agentId) {
      return jsonError('This endpoint requires an agent-bound API key', 400);
    }

    try {
      const result = await this.agents.getMe(agentId, user.id);
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
    }
  }

  @Get('/:id')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const agent = await this.agents.getById(agentId, user.id);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
    }
  }

  @Patch('/:id')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async update(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, updateAgentSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const agent = await this.agents.update(agentId, user.id, body);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  // Unbound owner keys may deregister agents, but an agent-bound key may not
  // delete its executor or mint a successor credential.
  @Delete('/:id')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async remove(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      await this.agents.delete(agentId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/transports')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async addTransport(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, addTransportSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const transport = await this.agents.addTransport(
        agentId,
        user.id,
        body.channel,
        body.config,
        body.priority,
      );
      return Response.json({ transport }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/transports/:transportId')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async removeTransport(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const transportId = params?.transportId;
    if (!agentId || !transportId) {
      return jsonError('Agent ID and transport ID are required', 400);
    }

    try {
      await this.agents.removeTransport(agentId, transportId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/permissions')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async grantPermission(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, grantPermissionSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const permission = await this.agents.grantPermission(
        agentId,
        user.id,
        body.actions,
        body.scope,
        body.scopeId,
      );
      return Response.json({ permission }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/permissions/:permissionId')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async revokePermission(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const permissionId = params?.permissionId;
    if (!agentId || !permissionId) {
      return jsonError('Agent ID and permission ID are required', 400);
    }

    try {
      await this.agents.revokePermission(agentId, permissionId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/tokens')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listTokens(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const tokens = await this.agents.listTokens(agentId, user.id);
      return Response.json({ tokens });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  // Desktop owner credentials may mint a key, but agent-bound keys may not
  // mint successor credentials that survive their own rotation.
  @Post('/:id/tokens')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async createToken(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseOptionalBody(req, createTokenSchema, {});
    if (body instanceof Response) {
      return body;
    }

    try {
      const token = await this.agents.createToken(agentId, user.id, body.name);
      return Response.json({ token }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/tokens/:tokenId')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async revokeToken(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const tokenId = params?.tokenId;
    if (!agentId || !tokenId) {
      return jsonError('Agent ID and token ID are required', 400);
    }

    try {
      await this.agents.revokeToken(agentId, tokenId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  // Negotiation pickup (claim a turn to work on) is retired whole-cloth by the
  // negotiation-graph rewrite (#1494, docs/plans/2026-08-23-personal-agent-
  // and-negotiation-graphs.md): a negotiation stays `working` until it pauses
  // or resolves — it is never claimed into a distinct state, so there is
  // nothing left to pick up.
  //
  // The REST respond route (`POST /:id/negotiations/:negotiationId/respond`)
  // remains retired with polling. Authenticated external agents — including
  // the Hermes bridge — submit authored `respond_to_negotiation` MCP verbs;
  // the shared NegotiationGraph validates and applies them under the speaking
  // seat.
  //
  // Owner consultation was retired whole-cloth by the negotiation-graph
  // rewrite: a negotiator that cannot continue without the principal pauses
  // `needs_principal` instead.
  //
  // Both routes are deleted rather than kept as dead stubs, since there is no
  // longer a meaningful request/response shape for either.

  @Post('/:id/test-messages')
  @UseGuards(RateLimit('write'), AuthGuard)
  async enqueueTestMessage(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const body = await parseBody(req, enqueueTestMessageSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      // Verify the authenticated user owns the agent (throws 'Agent not found' or 'Not authorized' if not)
      await this.agents.getById(agentId, user.id);
      const result = await this.testMessages.enqueue(agentId, user.id, body.content);
      return Response.json(result, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-messages/pickup')
  @UseGuards(RateLimit('write'), AuthGuard)
  async pickupTestMessage(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const result = await pickupTestMessageAtControllerBoundary({
        agentId,
        ownerId: user.id,
        authorize: (id, ownerId) => this.agents.getById(id, ownerId),
        pickup: (id) => this.testMessages.pickup(id),
        touchLastSeen: (id) => this.agents.touchLastSeen(id),
      });
      if (!result) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-messages/:messageId/delivered')
  @UseGuards(RateLimit('write'), AuthGuard)
  async confirmTestMessageDelivered(req: Request, _user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const messageId = params?.messageId;
    if (!agentId || !messageId) {
      return jsonError('Agent ID and message ID are required', 400);
    }

    const body = await parseBody(req, confirmTestMessageDeliveredSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      await this.testMessages.confirmDelivered(messageId, body.reservationToken);
      return Response.json({ ok: true });
    } catch (err) {
      const msg = parseErrorMessage(err);
      if (msg === 'invalid_reservation_token_or_already_delivered') {
        return jsonError('Invalid or expired reservation token', 404);
      }
      return jsonError(msg, errorStatus(err));
    }
  }

  @Post('/:id/opportunities/pickup')
  @UseGuards(RateLimit('write'), AuthGuard)
  async pickupOpportunity(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const result = await pickupOpportunityAtControllerBoundary({
        agentId,
        ownerId: user.id,
        authorize: (id, ownerId) => this.agents.getById(id, ownerId),
        touchLastSeen: (id) => this.agents.touchLastSeen(id),
        pickup: (id) => this.deliveries.pickupPending(id),
      });
      if (!result) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/opportunities/pending')
  @UseGuards(AuthGuard)
  async getPendingOpportunities(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    // Validation contract: the controller only enforces "the param parses to a
    // finite number". The service is the single source of truth for clamping
    // (rounds to integer, then clamps to [1, 20]), so values like 0, -3, 1.5,
    // 100 are all accepted here and normalized downstream. NaN/Infinity/empty
    // are rejected with 400 — they signal a malformed request, not a value out
    // of range.
    const limit = parseLimitParam(req);
    if (limit instanceof Response) {
      return limit;
    }

    try {
      await this.agents.getById(agentId, user.id);
      await this.agents.touchLastSeen(agentId);
      const result = await this.deliveries.fetchPendingCandidates(agentId, limit);
      return Response.json({ opportunities: result.opportunities, totalPending: result.totalPending });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/opportunities/accepted')
  @UseGuards(AuthGuard)
  async getAcceptedOpportunities(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const limit = parseLimitParam(req);
    if (limit instanceof Response) {
      return limit;
    }

    const frontendUrl = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');

    try {
      await this.agents.getById(agentId, user.id);
      await this.agents.touchLastSeen(agentId);
      const opportunities = await this.deliveries.fetchAcceptedCandidates(agentId, frontendUrl, limit);
      return Response.json({ opportunities });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/opportunities/delivery-stats')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getDeliveryStats(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    const url = new URL(req.url);
    const sinceParam = url.searchParams.get('since');
    if (!sinceParam) {
      return jsonError('since query parameter is required (ISO 8601)', 400);
    }
    const since = new Date(sinceParam);
    if (Number.isNaN(since.getTime())) {
      return jsonError('since must be a valid ISO 8601 timestamp', 400);
    }

    try {
      await this.agents.getById(agentId, user.id);
      await this.agents.touchLastSeen(agentId);
      const counts = await this.deliveries.countDeliveriesSince(agentId, since);
      return Response.json(counts);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/opportunities/:opportunityId/delivered')
  @UseGuards(RateLimit('write'), AuthGuard)
  async confirmOpportunityDelivered(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const opportunityId = params?.opportunityId;
    if (!agentId || !opportunityId) {
      return jsonError('Agent ID and opportunity ID are required', 400);
    }

    const body = await parseBody(req, confirmOpportunityDeliveredSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      // Verify the authenticated user owns the agent (throws 'Agent not found' or 'Not authorized' if not)
      await this.agents.getById(agentId, user.id);
      await this.deliveries.confirmDelivered(opportunityId, user.id, body.reservationToken);
      return Response.json({ ok: true });
    } catch (err) {
      const msg = parseErrorMessage(err);
      if (msg === 'invalid_reservation_token_or_already_delivered') {
        return jsonError('Invalid or expired reservation token', 404);
      }
      return jsonError(msg, errorStatus(err));
    }
  }
}
