import { z } from 'zod';

import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, UseGuards } from '../lib/router/router.decorators';
import { agentService } from '../services/agent.service';
import { RuntimeDomainError } from '../lib/agent/runtime-errors';

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
  if (message === 'Agent not found') {
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

@Controller('/agents')
export class AgentController {
  constructor(
    private readonly agents: typeof agentService = agentService,
  ) {}
  @Get('')
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const agents = await this.agents.listForUser(user.id);
    logger.verbose('Listed agents', { userId: user.id, count: agents.length });
    return Response.json({ agents });
  }

  @Post('')
  @UseGuards(SessionOnlyGuard)
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

  /**
   * Read the agent the user selected to handle negotiations. The caller's
   * credential names a user, so this is the only way a runtime learns which
   * agent record it is acting as.
   */
  @Get('/me')
  @UseGuards(AuthGuard)
  async getMe(_req: Request, user: AuthenticatedUser) {
    try {
      const result = await this.agents.getMe(user.id);
      return Response.json(result);
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
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
      const agent = await this.agents.getById(agentId, user.id);
      return Response.json({ agent });
    } catch (err) {
      return jsonError(parseErrorMessage(err), errorStatus(err, 404));
    }
  }

  @Patch('/:id')
  @UseGuards(SessionOnlyGuard)
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

  @Delete('/:id')
  @UseGuards(SessionOnlyGuard)
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
}
