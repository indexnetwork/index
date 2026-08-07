import { z } from 'zod';

import { OwnerControlGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { RuntimeDomainError, RuntimeValidationError } from '../lib/agent/runtime-errors';
import { log } from '../lib/log';
import { Controller, Delete, Get, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { agentRuntimeService, type AgentRuntimeService, type RuntimeSelectionInput } from '../services/agent-runtime.service';

const logger = log.controller.from('agent-runtime');

const uuid = z.string().uuid();
const prepareSchema = z.object({
  installationId: uuid,
  setupAttemptId: uuid,
}).strict();
const runtimeSelectionSchema = z.discriminatedUnion('runtime', [
  z.object({ runtime: z.literal('index') }).strict(),
  z.object({
    runtime: z.literal('hermes'),
    installationId: uuid,
    executorId: uuid,
    setupAttemptId: uuid,
  }).strict(),
]);
const rollbackSchema = z.object({ setupAttemptId: uuid }).strict();

type RouteParams = Record<string, string>;

function runtimeDomainResponse(error: RuntimeDomainError): Response {
  return Response.json({ error: error.code, detail: error.clientMessage }, { status: error.status });
}

function runtimeValidationResponse(): Response {
  return runtimeDomainResponse(new RuntimeValidationError());
}

async function parseBody<T>(req: Request, schema: z.ZodSchema<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return runtimeValidationResponse();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return runtimeValidationResponse();
  return parsed.data;
}

function runtimeError(
  err: unknown,
  operation: string,
  reportUnexpected: (error: unknown, operation: string) => void,
): Response {
  if (err instanceof RuntimeDomainError) return runtimeDomainResponse(err);
  reportUnexpected(err, operation);
  return Response.json(
    { error: 'internal_error', detail: 'An unexpected error occurred' },
    { status: 500 },
  );
}

function reportUnexpectedRuntimeError(error: unknown, operation: string): void {
  logger.error('Unexpected agent runtime error', {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** Owner-control API for the server-authoritative negotiation runtime binding. */
@Controller('/agent-runtime')
export class AgentRuntimeController {
  constructor(
    private readonly runtime: AgentRuntimeService = agentRuntimeService,
    private readonly reportUnexpected: (error: unknown, operation: string) => void = reportUnexpectedRuntimeError,
  ) {}

  @Get('')
  @UseGuards(RateLimit('read'), OwnerControlGuard)
  async get(req: Request, user: AuthenticatedUser): Promise<Response> {
    const installationId = new URL(req.url).searchParams.get('installationId');
    const parsed = uuid.safeParse(installationId);
    if (!parsed.success) return runtimeValidationResponse();
    try {
      return Response.json(await this.runtime.getRuntime(user.id, parsed.data));
    } catch (err) {
      return runtimeError(err, 'get', this.reportUnexpected);
    }
  }

  @Post('/hermes/prepare')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async prepare(req: Request, user: AuthenticatedUser): Promise<Response> {
    const body = await parseBody(req, prepareSchema);
    if (body instanceof Response) return body;
    try {
      return Response.json(
        await this.runtime.prepareHermes(user.id, body.installationId, body.setupAttemptId),
        { status: 201 },
      );
    } catch (err) {
      return runtimeError(err, 'prepare', this.reportUnexpected);
    }
  }

  @Put('')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async set(req: Request, user: AuthenticatedUser): Promise<Response> {
    const body = await parseBody(req, runtimeSelectionSchema);
    if (body instanceof Response) return body;
    try {
      return Response.json(await this.runtime.setRuntime(user.id, body as RuntimeSelectionInput));
    } catch (err) {
      return runtimeError(err, 'set', this.reportUnexpected);
    }
  }

  @Post('/rollback')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async rollback(req: Request, user: AuthenticatedUser): Promise<Response> {
    const body = await parseBody(req, rollbackSchema);
    if (body instanceof Response) return body;
    try {
      return Response.json({ rolledBack: await this.runtime.rollbackHermes(user.id, body.setupAttemptId) });
    } catch (err) {
      return runtimeError(err, 'rollback', this.reportUnexpected);
    }
  }

  @Delete('/hermes/:installationId')
  @UseGuards(RateLimit('write'), OwnerControlGuard)
  async disconnect(_req: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const parsed = uuid.safeParse(params?.installationId);
    if (!parsed.success) return runtimeValidationResponse();
    try {
      return Response.json(await this.runtime.disconnectHermes(user.id, parsed.data));
    } catch (err) {
      return runtimeError(err, 'disconnect', this.reportUnexpected);
    }
  }
}
