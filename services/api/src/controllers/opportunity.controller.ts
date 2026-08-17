import { z } from 'zod';

import { opportunityService } from '../services/opportunity.service';
import { Controller, Get, Post, Patch, UseGuards } from '../lib/router/router.decorators';
import { assertAgentNetworkScope, withAgentScope } from '../guards/agent-scope.guard';
import { AuthGuard, isSessionAuthenticated } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { getOpportunityOwnerApprovalAuthority } from '../lib/mcp/owner-approval';
import { queueOpportunityNotification } from '../queues/notification.queue';
import { log } from '../lib/log';

const logger = log.controller.from('opportunity');

const listStatusSchema = z.enum(['pending', 'stalled', 'accepted', 'rejected', 'expired']);
/** Full lifecycle enum for the radar view's explicit `statuses` filter (e.g. the intent radar). */
const radarStatusSchema = z.enum(['latent', 'draft', 'negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired']);
const uuidQuerySchema = z.string().uuid();
const scopeTypeQuerySchema = z.enum(['intent']);

function parseIntentScopeFromUrl(url: URL): { scopeType?: 'intent'; scopeId?: string } | Response {
  const rawScopeType = url.searchParams.get('scopeType') ?? undefined;
  const rawScopeId = url.searchParams.get('scopeId') ?? undefined;
  const rawIntentId = url.searchParams.get('intentId') ?? undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId };
  }

  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseIntentScopeFromBody(body: unknown): { scopeType?: 'intent'; scopeId?: string; acknowledgedUptakeQuestionIds?: string[] } | Response {
  if (!isRecord(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  const rawScopeType = typeof body.scopeType === 'string' ? body.scopeType : undefined;
  const rawScopeId = typeof body.scopeId === 'string' ? body.scopeId : undefined;
  const rawIntentId = typeof body.intentId === 'string' ? body.intentId : undefined;
  const rawAcknowledgedIds = body.acknowledgedUptakeQuestionIds;
  if (rawAcknowledgedIds !== undefined && (
    !Array.isArray(rawAcknowledgedIds)
    || rawAcknowledgedIds.some((id) => typeof id !== 'string' || !id.trim())
  )) {
    return Response.json({ error: 'acknowledgedUptakeQuestionIds must be an array of non-empty strings' }, { status: 400 });
  }
  const acknowledgedUptakeQuestionIds = Array.isArray(rawAcknowledgedIds)
    ? [...new Set(rawAcknowledgedIds.map((id) => (id as string).trim()))]
    : undefined;

  if (rawScopeType || rawScopeId) {
    const parsedScopeType = scopeTypeQuerySchema.safeParse(rawScopeType);
    if (!parsedScopeType.success) return Response.json({ error: 'Invalid scopeType; use intent' }, { status: 400 });
    const parsedScopeId = uuidQuerySchema.safeParse(rawScopeId);
    if (!parsedScopeId.success) return Response.json({ error: 'Invalid scopeId; must be a UUID' }, { status: 400 });
    if (rawIntentId && rawIntentId !== rawScopeId) return Response.json({ error: 'intentId must match scopeId when both are provided' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawScopeId, acknowledgedUptakeQuestionIds };
  }

  if (rawIntentId) {
    const parsedIntentId = uuidQuerySchema.safeParse(rawIntentId);
    if (!parsedIntentId.success) return Response.json({ error: 'Invalid intentId; must be a UUID' }, { status: 400 });
    return { scopeType: 'intent', scopeId: rawIntentId, acknowledgedUptakeQuestionIds };
  }

  return { acknowledgedUptakeQuestionIds };
}

/** Route params when path has :id or :networkId */
type RouteParams = Record<string, string>;

/**
 * OpportunityController: REST API for opportunities.
 * Uses OpportunityService for all business logic and graph operations.
 */
@Controller('/opportunities')
export class OpportunityController {
  /**
   * GET /opportunities — list opportunities for the authenticated user.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listOpportunities(req: Request, user: AuthenticatedUser, _params?: RouteParams) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const networkId = url.searchParams.get('networkId') ?? undefined;
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    if (rawStatus) {
      const parsed = listStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const scope = parseIntentScopeFromUrl(url);
    if (scope instanceof Response) return scope;

    const options = {
      status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
      networkId,
      ...scope,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };
    const list = await opportunityService.getOpportunitiesForUser(user.id, options);
    logger.verbose('Opportunities listed', { userId: user.id, count: list.length });
    return Response.json({ opportunities: list });
  }

  /**
   * GET /opportunities/chat-context — get shared accepted opportunities between the
   * authenticated user and a peer, used as context for chat conversations.
   *
   * @param req - Must include `peerUserId` query parameter
   * @param user - Authenticated user from AuthGuard
   * @returns JSON with opportunity cards for the chat context
   */
  @Get('/chat-context')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getChatContext(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const peerUserId = url.searchParams.get('peerUserId');
    if (!peerUserId) {
      return Response.json({ error: 'peerUserId query param is required' }, { status: 400 });
    }

    try {
      const result = await opportunityService.getChatContext(user.id, peerUserId);
      return Response.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('getChatContext failed', { userId: user.id, error: message });
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  /**
   * GET /opportunities/radar — radar view: flat presenter-card list, optionally intent-scoped.
   */
  @Get('/radar')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getRadar(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const networkId = url.searchParams.get('networkId') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const noCacheParam = url.searchParams.get('noCache');
    const noCache = noCacheParam === '1' || noCacheParam === 'true';
    const scope = parseIntentScopeFromUrl(url);
    if (scope instanceof Response) return scope;

    // Optional explicit lifecycle filter (comma-separated). Switches the radar
    // graph into lifecycle-view mode (see RadarGraphInvokeInput.statuses).
    const statusesParam = url.searchParams.get('statuses');
    let statuses: z.infer<typeof radarStatusSchema>[] | undefined;
    if (statusesParam) {
      const parsed = z.array(radarStatusSchema).nonempty().safeParse(statusesParam.split(',').map((s) => s.trim()).filter(Boolean));
      if (!parsed.success) {
        return Response.json({ error: `Invalid statuses; allowed: ${radarStatusSchema.options.join(', ')}` }, { status: 400 });
      }
      statuses = [...new Set(parsed.data)];
    }

    // Optional fast mode: skip the presenter LLM for cache misses and
    // return identity-only cards flagged presentationPending (two-phase fetch).
    const presentationParam = url.searchParams.get('presentation');
    if (presentationParam && presentationParam !== 'skeleton' && presentationParam !== 'full') {
      return Response.json({ error: "Invalid presentation; allowed: 'skeleton', 'full'" }, { status: 400 });
    }
    const presentation = presentationParam === 'skeleton' ? 'skeleton' as const : undefined;

    const result = await opportunityService.getRadarView(user.id, {
      networkId,
      ...scope,
      limit: limitParam ? parseInt(limitParam, 10) : undefined,
      noCache,
      statuses,
      presentation,
    });
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: 500 });
    }
    return Response.json(result);
  }

  /**
   * GET /opportunities/:id — get one opportunity with presentation for the viewer.
   * Accepts full UUID or short ID prefix.
   */
  @Get('/:id')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getOpportunity(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      logger.warn('Get opportunity missing id', { userId: user.id });
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await opportunityService.getOpportunityWithPresentation(resolved.id, user.id);

    if (!result) {
      logger.verbose('Opportunity not found', { userId: user.id, opportunityId: resolved.id });
      return Response.json({ error: 'Opportunity not found' }, { status: 404 });
    }

    if ('error' in result) {
      logger.warn('Get opportunity error', { userId: user.id, opportunityId: resolved.id, error: result.error });
      return Response.json({ error: result.error }, { status: result.status as number });
    }

    return Response.json(result);
  }

  /**
   * PATCH /opportunities/:id/status — update status (e.g. accepted, rejected).
   * Accepts full UUID or short ID prefix.
   */
  @Patch('/:id/status')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateStatus(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isRecord(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });

    const rawStatus = typeof body.status === 'string' ? body.status : undefined;
    const status = rawStatus as 'latent' | 'draft' | 'pending' | 'negotiating' | 'stalled' | 'accepted' | 'rejected' | 'expired' | undefined;
    const allowed = ['latent', 'draft', 'pending', 'negotiating', 'stalled', 'accepted', 'rejected', 'expired'];
    if (!status || !allowed.includes(status)) {
      return Response.json({ error: 'Invalid status; use one of: ' + allowed.join(', ') }, { status: 400 });
    }

    const scope = parseIntentScopeFromBody(body);
    if (scope instanceof Response) return scope;
    const { networkScopeId } = await withAgentScope(req, user);

    const result = await opportunityService.updateOpportunityStatus(resolved.id, status, user.id, {
      ...scope,
      ...(networkScopeId ? { networkScopeId } : {}),
      // Provenance: only a genuine human session may become a preference label
      // (IND-434). API-key/agent REST calls are excluded from outcome capture.
      actionProvenance: isSessionAuthenticated(req) ? 'user_session' : 'api_key',
    });

    if (result && 'error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status as number },
      );
    }

    return Response.json(result);
  }

  /**
   * POST /opportunities/:id/owner-approvals — issue a single-use owner-approval
   * proof for a pending MCP-agent interaction challenge (IND-593).
   *
   * The agent relays the `interactionId` challenge from its
   * `owner_approval_required` denial; the authenticated owner session explicitly
   * approves that exact interaction here. The proof binding (opportunity,
   * action, owner, agent, interaction) comes entirely from the server-side
   * challenge store — caller-supplied binding fields are never accepted.
   * Session-auth only: an API-key/agent caller must never self-issue owner
   * authorization.
   */
  @Post('/:id/owner-approvals')
  @UseGuards(RateLimit('write'), AuthGuard)
  async issueOwnerApproval(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    if (!isSessionAuthenticated(req)) {
      return Response.json({ error: 'Owner approval requires an authenticated owner session' }, { status: 403 });
    }
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }
    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      body = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!isRecord(body)) return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    const interactionId = typeof body.interactionId === 'string' ? body.interactionId.trim() : '';
    if (!interactionId) {
      return Response.json({ error: 'interactionId is required' }, { status: 400 });
    }

    const issuance = await getOpportunityOwnerApprovalAuthority().issueProofForInteraction({
      interactionId,
      ownerId: user.id,
      // Server-resolved route opportunity — the authority answers a mismatch
      // opaquely BEFORE the one-shot issuance flag, so a wrong-route request
      // can never mint a proof nor burn the challenge's single issuance.
      expectedOpportunityId: resolved.id,
    });
    if (issuance.kind === 'denied') {
      if (issuance.reason === 'wrong_owner') {
        return Response.json({ error: 'Only the challenge owner may approve this interaction' }, { status: 403 });
      }
      if (issuance.reason === 'stale') {
        return Response.json({ error: 'Approval interaction has expired — ask the agent to retry' }, { status: 410 });
      }
      if (issuance.reason === 'already_issued') {
        return Response.json({ error: 'Approval proof was already issued for this interaction' }, { status: 409 });
      }
      if (issuance.reason === 'unavailable') {
        return Response.json({ error: 'Approval service is temporarily unavailable' }, { status: 503 });
      }
      return Response.json({ error: 'Unknown approval interaction' }, { status: 404 });
    }
    return Response.json({
      proof: issuance.proof,
      expiresAt: issuance.expiresAt,
      approval: {
        interactionId,
        opportunityId: issuance.binding.opportunityId,
        action: issuance.binding.action,
        agentId: issuance.binding.agentId,
      },
    });
  }

  /**
   * POST /opportunities/:id/start-chat — accept a `pending` or `draft`
   * opportunity and resolve (find-or-create) the h2h conversation for the
   * actor pair. Used by the frontend's Start Chat button; returns the
   * conversationId to navigate to.
   *
   * @param _req - Incoming request (body is ignored).
   * @param user - Authenticated user from AuthGuard.
   * @param params - Route params; `id` is the opportunity ID (full UUID or
   *   short prefix, resolved via `opportunityService.resolveId`).
   * @returns JSON with `{ conversationId, counterpartUserId, opportunity }`
   *   on success, or a structured error (400 on bad status / missing
   *   counterpart, 403 for non-actors, 404 when the opp does not exist).
   */
  @Post('/:id/start-chat')
  @UseGuards(RateLimit('write'), AuthGuard)
  async startChat(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const id = params?.id;
    if (!id) {
      return Response.json({ error: 'Missing opportunity id' }, { status: 400 });
    }

    const resolved = await opportunityService.resolveId(id, user.id);
    if ('error' in resolved) {
      return Response.json({ error: resolved.error }, { status: resolved.status });
    }

    let body: unknown;
    try {
      const rawBody = await req.text();
      body = rawBody.trim() ? JSON.parse(rawBody) : {};
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const scope = parseIntentScopeFromBody(body);
    if (scope instanceof Response) return scope;
    const { networkScopeId } = await withAgentScope(req, user);

    const result = await opportunityService.startChat(resolved.id, user.id, {
      ...scope,
      ...(networkScopeId ? { networkScopeId } : {}),
      actionProvenance: isSessionAuthenticated(req) ? 'user_session' : 'api_key',
    });
    if ('error' in result) {
      return Response.json(
        'advisory' in result ? { error: result.error, advisory: result.advisory } : { error: result.error },
        { status: result.status },
      );
    }
    return Response.json(result);
  }

}

/**
 * Network-scoped opportunity routes: GET/POST /networks/:networkId/opportunities.
 * Permission: list requires member; create requires owner or member (with rules).
 */
@Controller('/networks')
export class NetworkOpportunityController {

  /**
   * GET /networks/:networkId/opportunities — list opportunities for a network (owner or member).
   */
  @Get('/:networkId/opportunities')
  @UseGuards(RateLimit('read'), AuthGuard)
  async listForIndex(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const networkId = params?.networkId;
    if (!networkId) {
      return Response.json({ error: 'Missing network id' }, { status: 400 });
    }

    await assertAgentNetworkScope(req, networkId);

    const url = new URL(req.url, `http://${req.headers.get('host') || 'localhost'}`);
    const rawStatus = url.searchParams.get('status');
    const limit = url.searchParams.get('limit');
    const offset = url.searchParams.get('offset');

    if (rawStatus) {
      const parsed = listStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        return Response.json(
          { error: `Invalid status; use one of: ${listStatusSchema.options.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const result = await opportunityService.getOpportunitiesForNetwork(networkId, user.id, {
      status: rawStatus ? (rawStatus as z.infer<typeof listStatusSchema>) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ opportunities: result });
  }

  /**
   * POST /networks/:networkId/opportunities — create a manual opportunity (curator).
   */
  @Post('/:networkId/opportunities')
  @UseGuards(RateLimit('write'), AuthGuard)
  async createManual(req: Request, user: AuthenticatedUser, params?: RouteParams) {
    const networkId = params?.networkId;
    if (!networkId) {
      return Response.json({ error: 'Missing network id' }, { status: 400 });
    }

    await assertAgentNetworkScope(req, networkId);

    let body: { parties?: Array<{ userId: string; intentId?: string }>; reasoning?: string; category?: string; confidence?: number };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { parties, reasoning, category, confidence } = body ?? {};
    if (!parties || !Array.isArray(parties) || parties.length < 2 || !reasoning || typeof reasoning !== 'string') {
      return Response.json(
        { error: 'Body must include parties (array of at least 2 { userId, intentId? }) and reasoning (string)' },
        { status: 400 },
      );
    }

    const result = await opportunityService.createManualOpportunity(networkId, user.id, {
      parties,
      reasoning,
      category,
      confidence,
    });

    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    // Queue notifications for non-introducer parties
    const recipientIds = parties.map((p) => p.userId).filter((id) => id !== user.id);
    for (const recipientId of recipientIds) {
      await queueOpportunityNotification(result.id, recipientId, 'high');
    }

    return Response.json(result, { status: 201 });
  }
}
