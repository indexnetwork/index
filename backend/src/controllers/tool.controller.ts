/**
 * Tool Controller — exposes chat tools as direct HTTP endpoints.
 * POST /api/tools/:toolName — invoke a tool with a JSON query body.
 * GET  /api/tools          — list all available tools.
 */

import { z } from 'zod';

import { Controller, Post, Get, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { ToolService } from '../services/tool.service';
import { ChatContextAccessError } from '@indexnetwork/protocol';
import { log } from '../lib/log';

const logger = log.controller.from('tool');

/** Schema for the invoke request body. */
const InvokeSchema = z.object({
  query: z.record(z.unknown()).default({}),
});

/**
 * Exposes protocol tools as a REST API.
 * Tools are the same handlers used by the chat agent, but invoked directly via HTTP.
 */
@Controller('/tools')
export class ToolController {
  constructor(private toolService: ToolService) {}

  /**
   * Invoke a tool by name.
   * @param req - Request with JSON body matching InvokeSchema
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing toolName
   * @returns Tool result as JSON
   */
  @Post('/:toolName')
  @UseGuards(RateLimit('write'), AuthGuard)
  async invoke(req: Request, user: AuthenticatedUser, params: { toolName: string }) {
    const { toolName } = params;
    logger.verbose('Tool invoke requested', { userId: user.id, toolName });

    let body: Record<string, unknown>;
    try {
      body = await req.json() as Record<string, unknown>;
    } catch {
      body = {};
    }

    const parsed = InvokeSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request body', details: parsed.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    try {
      const result = await this.toolService.invokeTool(user.id, toolName, parsed.data.query);
      return Response.json(result);
    } catch (err) {
      if (err instanceof ChatContextAccessError) {
        return new Response(
          JSON.stringify({ error: err.message, code: err.code }),
          { status: err.statusCode, headers: { 'Content-Type': 'application/json' } },
        );
      }

      const message = err instanceof Error ? err.message : String(err);
      logger.error('Tool invoke failed', { userId: user.id, toolName, error: message });

      if (message.includes('not found')) {
        return new Response(
          JSON.stringify({ error: message }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (message.includes('Invalid query')) {
        return new Response(
          JSON.stringify({ error: message }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  /**
   * List all available tools with their names, descriptions, and schemas.
   * @returns Array of tool metadata
   */
  @Get('/')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(_req: Request, _user: AuthenticatedUser) {
    logger.verbose('Tool list requested');

    try {
      const tools = await this.toolService.listTools();
      return Response.json({ tools });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Tool list failed', { error: message });
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
}
