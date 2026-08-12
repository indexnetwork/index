import { z } from 'zod';

import { SessionOnlyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { AuthorizationInvalidRequestError, HermesAuthorizationError, InvalidHermesCredentialError, isHermesLoopbackRedirect } from '../lib/agent/hermes-authorization';
import { HERMES_CANONICAL_ACTIONS, isExactHermesCapabilitySet } from '../lib/agent/hermes-capabilities';
import { log } from '../lib/log';
import { Controller, Get, Post, UseGuards } from '../lib/router/router.decorators';
import { hermesAuthorizationService, type HermesAuthorizationService } from '../services/hermes-authorization.service';

const logger = log.controller.from('hermes-authorization');
const uuid = z.string().uuid();
const base64url = /^[A-Za-z0-9_-]+$/;
const redirectUri = z.string().refine(isHermesLoopbackRedirect);
const exactActions = z.array(z.enum(HERMES_CANONICAL_ACTIONS))
  .refine(isExactHermesCapabilitySet)
  .transform(() => [...HERMES_CANONICAL_ACTIONS]);

const createSchema = z.object({
  protocolVersion: z.literal(1),
  installationId: uuid,
  redirectUri,
  codeChallenge: z.string().length(43).regex(base64url),
  codeChallengeMethod: z.literal('S256'),
  state: z.string().min(32).max(128).regex(base64url),
  actions: exactActions,
}).strict();

const exchangeSchema = z.object({
  protocolVersion: z.literal(1),
  requestId: uuid,
  code: z.string().min(16).max(256).regex(base64url),
  verifier: z.string().min(43).max(128).regex(base64url),
  redirectUri,
}).strict();

const activateSchema = z.object({
  protocolVersion: z.literal(1),
  keychainConfirmed: z.literal(true),
}).strict();

const disconnectSchema = z.object({
  protocolVersion: z.literal(1),
}).strict();
const authorizationState = z.string().min(32).max(128).regex(base64url);
const approveSchema = z.object({
  state: authorizationState,
  redirectUri,
}).strict();

type RouteParams = Record<string, string>;

function authorizationResponse(error: HermesAuthorizationError): Response {
  return Response.json({ error: error.code }, { status: error.status });
}

async function parseBody<T>(request: Request, schema: z.ZodSchema<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AuthorizationInvalidRequestError();
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new AuthorizationInvalidRequestError();
  return parsed.data;
}

function serialize<T extends { expiresAt: Date }>(value: T) {
  return { ...value, expiresAt: value.expiresAt.toISOString() };
}

function reportUnexpectedAuthorizationError(error: unknown, operation: string): void {
  logger.error('Unexpected Hermes authorization error', {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** First-party standalone Hermes PKCE authorization endpoints. */
@Controller('/hermes-authorizations')
export class HermesAuthorizationController {
  constructor(
    private readonly authorization: HermesAuthorizationService = hermesAuthorizationService,
    private readonly reportUnexpected: (error: unknown, operation: string) => void = reportUnexpectedAuthorizationError,
  ) {}

  @Post('')
  @UseGuards(RateLimit('write'))
  async create(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, createSchema);
      const created = await this.authorization.createAuthorization({
        installationId: body.installationId,
        redirectUri: body.redirectUri,
        state: body.state,
        codeChallenge: body.codeChallenge,
        actions: body.actions,
      });
      return Response.json(serialize(created), { status: 201 });
    } catch (error) {
      return this.handleError(error, 'create');
    }
  }

  @Get('/:id')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async get(request: Request, _user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const requestId = uuid.safeParse(params?.id);
    const searchParams = new URL(request.url).searchParams;
    const entries = [...searchParams.entries()];
    const stateValues = searchParams.getAll('state');
    const redirectValues = searchParams.getAll('redirect_uri');
    const state = authorizationState.safeParse(stateValues[0]);
    const callback = redirectUri.safeParse(redirectValues[0]);
    if (
      !requestId.success
      || entries.length !== 2
      || entries.some(([name]) => name !== 'state' && name !== 'redirect_uri')
      || stateValues.length !== 1
      || redirectValues.length !== 1
      || !state.success
      || !callback.success
    ) return authorizationResponse(new AuthorizationInvalidRequestError());
    try {
      return Response.json(serialize(await this.authorization.getAuthorization(
        requestId.data,
        state.data,
        callback.data,
      )));
    } catch (error) {
      return this.handleError(error, 'get');
    }
  }

  @Post('/:id/approve')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async approve(request: Request, user: AuthenticatedUser, params?: RouteParams): Promise<Response> {
    const requestId = uuid.safeParse(params?.id);
    if (!requestId.success) return authorizationResponse(new AuthorizationInvalidRequestError());
    try {
      const body = await parseBody(request, approveSchema);
      return Response.json(await this.authorization.approveAuthorization(
        user.id,
        requestId.data,
        body.state,
        body.redirectUri,
      ));
    } catch (error) {
      return this.handleError(error, 'approve');
    }
  }

  @Post('/exchange')
  @UseGuards(RateLimit('write'))
  async exchange(request: Request): Promise<Response> {
    try {
      const body = await parseBody(request, exchangeSchema);
      return Response.json(serialize(await this.authorization.exchangeAuthorizationCode(body)));
    } catch (error) {
      return this.handleError(error, 'exchange');
    }
  }

  @Post('/activate')
  @UseGuards(RateLimit('write'))
  async activate(request: Request): Promise<Response> {
    try {
      await parseBody(request, activateSchema);
      const credential = request.headers.get('x-api-key');
      if (!credential) throw new InvalidHermesCredentialError();
      const principal = await this.authorization.authenticatePendingHermesCredential(credential);
      return Response.json(serialize(await this.authorization.activatePendingHermesCredential(principal)));
    } catch (error) {
      return this.handleError(error, 'activate');
    }
  }

  @Post('/disconnect')
  @UseGuards(RateLimit('write'))
  async disconnect(request: Request): Promise<Response> {
    try {
      await parseBody(request, disconnectSchema);
      const credential = request.headers.get('x-api-key');
      if (!credential) throw new InvalidHermesCredentialError();
      const principal = await this.authorization.authenticateRevocableHermesCredential(credential);
      return Response.json(await this.authorization.disconnectHermesCredential(principal));
    } catch (error) {
      return this.handleError(error, 'disconnect');
    }
  }

  private handleError(error: unknown, operation: string): Response {
    if (error instanceof HermesAuthorizationError) return authorizationResponse(error);
    this.reportUnexpected(error, operation);
    return Response.json({ error: 'internal_error' }, { status: 500 });
  }
}
