import { z } from 'zod';

import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { ConnectedAgentNotFoundError, connectedAgentsService, type ConnectedAgentsService } from '../services/connected-agents.service';

const logger = log.controller.from('connected-agents');
const uuid = z.string().uuid();
type RouteParams = Record<string, string>;

function invalidResponse(): Response {
  return Response.json({ error: 'invalid_request' }, { status: 400 });
}

function reportUnexpectedConnectedAgentError(error: unknown, operation: string): void {
  logger.error('Unexpected connected-agent owner-control error', {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Browser-session owner controls for standalone Hermes installations. */
@Controller('/connected-agents/hermes')
export class ConnectedAgentsController {
  constructor(
    private readonly connections: ConnectedAgentsService = connectedAgentsService,
    private readonly reportUnexpected: (error: unknown, operation: string) => void = reportUnexpectedConnectedAgentError,
  ) {}

  @Get('')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async list(_request: Request, user: AuthenticatedUser): Promise<Response> {
    try {
      return Response.json(await this.connections.list(user.id));
    } catch (error) {
      return this.handleError(error, 'list');
    }
  }

  @Post('/:installationId/pause')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async pause(request: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const installationId = uuid.safeParse(params?.installationId);
    if (!installationId.success || await request.text() !== '') return invalidResponse();
    try {
      return Response.json(await this.connections.pause(user.id, installationId.data));
    } catch (error) {
      return this.handleError(error, 'pause');
    }
  }

  @Delete('/:installationId')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async revoke(_request: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const installationId = uuid.safeParse(params?.installationId);
    if (!installationId.success) return invalidResponse();
    try {
      return Response.json(await this.connections.revoke(user.id, installationId.data));
    } catch (error) {
      return this.handleError(error, 'revoke');
    }
  }

  private handleError(error: unknown, operation: string): Response {
    if (error instanceof ConnectedAgentNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    this.reportUnexpected(error, operation);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
