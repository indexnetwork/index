import { z } from 'zod';

import { AuthGuard, AuthOrApiKeyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { AgentTestMessageService } from '../services/agent-test-message.service';
import { agentService } from '../services/agent.service';
import {
  negotiationPollingService,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
} from '../services/negotiation-polling.service';
import { OpportunityDeliveryService } from '../services/opportunity-delivery.service';

const agentTestMessageService = new AgentTestMessageService();
const opportunityDeliveryService = new OpportunityDeliveryService();

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

const respondNegotiationSchema = z.object({
  action: z.enum(['propose', 'accept', 'reject', 'counter', 'question']),
  message: z.string().nullable().optional(),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(['agent', 'patient', 'peer']),
      otherUser: z.enum(['agent', 'patient', 'peer']),
    }),
  }),
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
  if (err instanceof UnauthorizedError) return 403;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
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
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const agents = await agentService.listForUser(user.id);
    logger.verbose('Listed agents', { userId: user.id, count: agents.length });
    return Response.json({ agents });
  }

  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await parseBody(req, createAgentSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const agent = await agentService.create(user.id, body.name, body.description);
      return Response.json({ agent }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id')
  @UseGuards(AuthGuard)
  async getById(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const agent = await agentService.getById(agentId, user.id);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
    }
  }

  @Patch('/:id')
  @UseGuards(AuthGuard)
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
      const agent = await agentService.update(agentId, user.id, body);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id')
  @UseGuards(AuthGuard)
  async remove(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      await agentService.delete(agentId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/transports')
  @UseGuards(AuthGuard)
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
      const transport = await agentService.addTransport(
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
  @UseGuards(AuthGuard)
  async removeTransport(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const transportId = params?.transportId;
    if (!agentId || !transportId) {
      return jsonError('Agent ID and transport ID are required', 400);
    }

    try {
      await agentService.removeTransport(agentId, transportId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/permissions')
  @UseGuards(AuthGuard)
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
      const permission = await agentService.grantPermission(
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
  @UseGuards(AuthGuard)
  async revokePermission(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const permissionId = params?.permissionId;
    if (!agentId || !permissionId) {
      return jsonError('Agent ID and permission ID are required', 400);
    }

    try {
      await agentService.revokePermission(agentId, permissionId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/tokens')
  @UseGuards(AuthGuard)
  async listTokens(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      const tokens = await agentService.listTokens(agentId, user.id);
      return Response.json({ tokens });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/tokens')
  @UseGuards(AuthGuard)
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
      const token = await agentService.createToken(agentId, user.id, body.name);
      return Response.json({ token }, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Delete('/:id/tokens/:tokenId')
  @UseGuards(AuthGuard)
  async revokeToken(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const tokenId = params?.tokenId;
    if (!agentId || !tokenId) {
      return jsonError('Agent ID and token ID are required', 400);
    }

    try {
      await agentService.revokeToken(agentId, tokenId, user.id);
      return new Response(null, { status: 204 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/negotiations/pickup')
  @UseGuards(AuthOrApiKeyGuard)
  async pickupNegotiation(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      // Run pickup first — it proves the caller is authorized for this agentId.
      // Only then bump the heartbeat, so unauthorized probes cannot spoof liveness.
      const result = await negotiationPollingService.pickup(agentId, user.id);
      await agentService.touchLastSeen(agentId);
      if (!result) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/negotiations/:negotiationId/respond')
  @UseGuards(AuthOrApiKeyGuard)
  async respondNegotiation(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    const negotiationId = params?.negotiationId;
    if (!agentId || !negotiationId) {
      return jsonError('Agent ID and negotiation ID are required', 400);
    }

    const body = await parseBody(req, respondNegotiationSchema);
    if (body instanceof Response) {
      return body;
    }

    try {
      const result = await negotiationPollingService.respond(agentId, user.id, negotiationId, body);
      return Response.json(result);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return jsonError(err.message, 403);
      }
      if (err instanceof NotFoundError) {
        return jsonError(err.message, 404);
      }
      if (err instanceof ConflictError) {
        return jsonError(err.message, 409);
      }
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-messages')
  @UseGuards(AuthGuard)
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
      await agentService.getById(agentId, user.id);
      const result = await agentTestMessageService.enqueue(agentId, user.id, body.content);
      return Response.json(result, { status: 201 });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-messages/pickup')
  @UseGuards(AuthOrApiKeyGuard)
  async pickupTestMessage(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      // Verify ownership before bumping heartbeat so unauthorized probes can't spoof liveness.
      await agentService.getById(agentId, user.id);
      const result = await agentTestMessageService.pickup(agentId);
      await agentService.touchLastSeen(agentId);
      if (!result) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/test-messages/:messageId/delivered')
  @UseGuards(AuthOrApiKeyGuard)
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
      await agentTestMessageService.confirmDelivered(messageId, body.reservationToken);
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
  @UseGuards(AuthOrApiKeyGuard)
  async pickupOpportunity(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      // Verify the authenticated user owns the agent (throws 'Agent not found' or 'Not authorized' if not)
      await agentService.getById(agentId, user.id);

      // Heartbeat: record that this personal agent is actively polling
      await agentService.touchLastSeen(agentId);

      const result = await opportunityDeliveryService.pickupPending(agentId);
      if (!result) {
        return new Response(null, { status: 204 });
      }
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Get('/:id/opportunities/pending')
  @UseGuards(AuthOrApiKeyGuard)
  async getPendingOpportunities(_req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const agentId = params?.id;
    if (!agentId) {
      return jsonError('Agent ID is required', 400);
    }

    try {
      await agentService.getById(agentId, user.id);
      await agentService.touchLastSeen(agentId);
      const opportunities = await opportunityDeliveryService.fetchPendingCandidates(agentId);
      return Response.json({ opportunities });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err));
    }
  }

  @Post('/:id/opportunities/:opportunityId/delivered')
  @UseGuards(AuthOrApiKeyGuard)
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
      await agentService.getById(agentId, user.id);
      await opportunityDeliveryService.confirmDelivered(opportunityId, user.id, body.reservationToken);
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
