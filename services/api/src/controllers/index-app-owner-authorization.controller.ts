import { z } from 'zod';

import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { IndexAppOwnerAuthorizationError, IndexAppOwnerInvalidRequestError, isIndexAppOwnerLoopbackRedirect } from '../lib/agent/index-app-owner-authorization';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { indexAppOwnerAuthorizationService, type IndexAppOwnerAuthorizationService } from '../services/index-app-owner-authorization.service';

const logger = log.controller.from('index-app-owner-authorization');
const uuid = z.string().uuid();
const base64url = /^[A-Za-z0-9_-]+$/;
const stateSchema = z.string().min(32).max(128).regex(base64url);
const redirectSchema = z.string().refine(isIndexAppOwnerLoopbackRedirect);

const createSchema = z.object({
  protocolVersion: z.literal(1),
  installationId: uuid,
  redirectUri: redirectSchema,
  state: stateSchema,
  codeChallenge: z.string().length(43).regex(base64url),
  codeChallengeMethod: z.literal('S256'),
  legacyKeyId: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict();
const approveSchema = z.object({ state: stateSchema, redirectUri: redirectSchema }).strict();
const exchangeSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: uuid,
  code: z.string().min(16).max(256).regex(base64url),
  state: stateSchema,
  verifier: z.string().min(43).max(128).regex(base64url),
  redirectUri: redirectSchema,
}).strict();
const terminalSchema = z.object({
  protocolVersion: z.literal(1),
  activationProof: z.string().min(16).max(256).regex(base64url),
}).strict();
const revokeSchema = z.object({ protocolVersion: z.literal(1) }).strict();

type RouteParams = Record<string, string>;

async function parseBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  let value: unknown;
  try { value = await request.json(); } catch { throw new IndexAppOwnerInvalidRequestError(); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IndexAppOwnerInvalidRequestError();
  return parsed.data;
}
function serialize<T extends { expiresAt: Date }>(value: T) {
  return { ...value, expiresAt: value.expiresAt.toISOString() };
}

/** Session consent and native-only exchange for the signed Index macOS app. */
@Controller('/index-app-owner-authorizations')
export class IndexAppOwnerAuthorizationController {
  constructor(private readonly authorization: IndexAppOwnerAuthorizationService = indexAppOwnerAuthorizationService) {}

  @Post('')
  @UseGuards(RateLimit('write'))
  async create(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, createSchema);
      return Response.json(serialize(await this.authorization.createAuthorization({
        installationId: body.installationId,
        redirectUri: body.redirectUri,
        state: body.state,
        codeChallenge: body.codeChallenge,
        legacyKeyId: body.legacyKeyId,
      })), { status: 201 });
    } catch (error) { return this.handle(error, 'create'); }
  }

  @Get('/:id')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async get(request: Request, _user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const requestId = uuid.safeParse(params?.id);
    const query = new URL(request.url).searchParams;
    const entries = [...query.entries()];
    const states = query.getAll('state');
    const redirects = query.getAll('redirect_uri');
    const state = stateSchema.safeParse(states[0]);
    const redirect = redirectSchema.safeParse(redirects[0]);
    if (!requestId.success || entries.length !== 2
        || entries.some(([key]) => key !== 'state' && key !== 'redirect_uri')
        || states.length !== 1 || redirects.length !== 1 || !state.success || !redirect.success) {
      return this.handle(new IndexAppOwnerInvalidRequestError(), 'get');
    }
    try {
      return Response.json(serialize(await this.authorization.getAuthorization(
        requestId.data, state.data, redirect.data,
      )));
    } catch (error) { return this.handle(error, 'get'); }
  }

  @Post('/:id/approve')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async approve(request: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const requestId = uuid.safeParse(params?.id);
    if (!requestId.success) return this.handle(new IndexAppOwnerInvalidRequestError(), 'approve');
    try {
      const body = await parseBody(request, approveSchema);
      return Response.json(await this.authorization.approveAuthorization(
        user.id, requestId.data, body.state, body.redirectUri,
      ));
    } catch (error) { return this.handle(error, 'approve'); }
  }

  @Post('/exchange')
  @UseGuards(RateLimit('write'))
  async exchange(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, exchangeSchema);
      return Response.json(serialize(await this.authorization.exchangeAuthorizationCode(body)));
    } catch (error) { return this.handle(error, 'exchange'); }
  }

  @Post('/activate')
  @UseGuards(RateLimit('write'))
  async activate(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, terminalSchema);
      const credential = request.headers.get('x-api-key');
      if (!credential) throw new IndexAppOwnerInvalidRequestError();
      const principal = await this.authorization.authenticatePendingCredential(credential);
      return Response.json(serialize(await this.authorization.activatePendingCredential(
        principal, body.activationProof,
      )));
    } catch (error) { return this.handle(error, 'activate'); }
  }

  @Post('/rollback')
  @UseGuards(RateLimit('write'))
  async rollback(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, terminalSchema);
      const credential = request.headers.get('x-api-key');
      if (!credential) throw new IndexAppOwnerInvalidRequestError();
      const principal = await this.authorization.authenticatePendingCredential(credential);
      return Response.json(await this.authorization.rollbackPendingCredential(
        principal, body.activationProof,
      ));
    } catch (error) { return this.handle(error, 'rollback'); }
  }

  @Post('/revoke')
  @UseGuards(RateLimit('write'))
  async revoke(request: Request): Promise<Response> {
    try {
      await parseBody(request, revokeSchema);
      const credential = request.headers.get('x-api-key');
      if (!credential) throw new IndexAppOwnerInvalidRequestError();
      const principal = await this.authorization.authenticateRevocableCredential(credential);
      return Response.json(await this.authorization.revokeCredential(principal));
    } catch (error) { return this.handle(error, 'revoke'); }
  }

  private handle(error: unknown, operation: string): Response {
    if (error instanceof IndexAppOwnerAuthorizationError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    logger.error('Unexpected Index app authorization error', {
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
