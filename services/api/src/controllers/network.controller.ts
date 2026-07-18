import { ZodError } from 'zod';

import { assertAgentNetworkScope, withAgentScope } from '../guards/agent-scope.guard';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { deprecatedRoute } from '../lib/router/deprecated-route';
import { Controller, Delete, Get, Patch, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { networkService } from '../services/network.service';

const logger = log.controller.from('network');

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Controller('/networks')
export class NetworkController {
  /**
   * List networks the authenticated user is a member of, including their personal network.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const { networkScopeId } = await withAgentScope(req, user);
    const result = await networkService.getNetworksForUser(user.id);
    let filtered = result;
    if (networkScopeId) {
      const networks = result.networks.filter(
        (n: { id: string; isPersonal?: boolean | null }) => n.id === networkScopeId || n.isPersonal === true,
      );
      // Recompute pagination so count/totalCount/total stay consistent with
      // the post-filter networks array; otherwise scoped callers see stale
      // counts that don't match the rows they receive.
      filtered = {
        ...result,
        networks,
        pagination: {
          ...result.pagination,
          count: networks.length,
          totalCount: networks.length,
          total: networks.length > 0 ? 1 : 0,
        },
      };
    }
    logger.verbose('Networks listed for user', { userId: user.id, count: filtered.networks.length, scoped: networkScopeId !== null });
    return Response.json(filtered);
  }

  /**
   * Create a new network. Authenticated users only.
   */
  @Post('')
  @UseGuards(RateLimit('write'), AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      prompt?: string;
      imageUrl?: string | null;
      joinPolicy?: 'anyone' | 'invite_only';
      allowGuestVibeCheck?: boolean;
      profileEnrichment?: 'auto' | 'consent_required' | 'disabled';
      isExperiment?: boolean;
      type?: 'community' | 'event';
      metadata?: Record<string, unknown>;
    };

    if (!body.title) {
      return Response.json({ error: 'title is required' }, { status: 400 });
    }

    if (body.isExperiment) {
      const { network, masterKey } = await networkService.createExperimentNetwork(user.id, {
        title: body.title,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
      });
      logger.verbose('Experiment network created', { networkId: (network as { id: string }).id, userId: user.id });
      return Response.json({ network, masterKey }, { status: 201 });
    }

    try {
      const result = await networkService.createNetwork(user.id, {
        title: body.title,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        joinPolicy: body.joinPolicy,
        allowGuestVibeCheck: body.allowGuestVibeCheck,
        profileEnrichment: body.profileEnrichment,
        type: body.type,
        metadata: body.metadata,
      });
      logger.verbose('Network created', { networkId: result.id, userId: user.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      if (err instanceof ZodError) {
        return Response.json({ error: 'Validation failed', details: err.issues }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Search users by name/email, optionally excluding existing members of a network.
   */
  @Get('/search-users')
  @UseGuards(RateLimit('read'), AuthGuard)
  async searchPersonalNetworkMembers(req: Request, user: AuthenticatedUser) {
    const url = new URL(req.url);
    const q = url.searchParams.get('q') || '';
    const networkId = url.searchParams.get('networkId') || undefined;
    const users = await networkService.searchPersonalNetworkMembers(user.id, q, networkId);
    return Response.json({ users });
  }

  /**
   * Get all members of every network the signed-in user is a member of (deduplicated).
   * Used for mentionable users (e.g. @mentions in chat).
   */
  @Get('/my-members')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMyMembers(_req: Request, user: AuthenticatedUser) {
    const members = await networkService.getMembersFromMyNetworks(user.id);
    logger.verbose('My-network members listed', { userId: user.id, count: members.length });
    return Response.json({ members });
  }

  /**
   * Get members of a network. Owner-only.
   */
  @Get('/:id/members')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMembers(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const members = await networkService.getMembersForOwner(params.id, user.id);
      logger.verbose('Members listed for network', { networkId: params.id, count: members.length });
      return Response.json({
        members,
        metadataKeys: [],
        pagination: { page: 1, limit: members.length, total: members.length, totalPages: 1 },
      });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Add a member to a network. Owner-only.
   */
  @Post('/:id/members')
  @UseGuards(RateLimit('write'), AuthGuard)
  async addMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = await req.json().catch(() => ({})) as { userId?: string; permissions?: string[] };
    if (!body.userId) {
      return Response.json({ error: 'userId is required' }, { status: 400 });
    }
    try {
      await assertAgentNetworkScope(req, params.id);
      let role: 'owner' | 'member' = 'member';
      if (body.permissions !== undefined) {
        if (!Array.isArray(body.permissions)) {
          return Response.json({ error: "permissions must be an array" }, { status: 400 });
        }
        const isOwnerRole = body.permissions.length === 1 && body.permissions[0] === 'owner';
        const isMemberRole = body.permissions.length === 1 && body.permissions[0] === 'member';
        if (!isOwnerRole && !isMemberRole) {
          return Response.json({ error: "permissions must be exactly ['owner'] or ['member']" }, { status: 400 });
        }
        role = isOwnerRole ? 'owner' : 'member';
      }
      const result = await networkService.addMember(params.id, body.userId, user.id, role);
      return Response.json({ member: result.member, message: result.alreadyMember ? 'Already a member' : 'Member added' });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Update a member's role. Owner-only.
   * Accepts { permissions: ['owner'] } or { permissions: ['member'] }.
   */
  @Patch('/:id/members/:memberId')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateMemberRole(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = await req.json().catch(() => ({})) as { permissions?: string[] };
    if (!body.permissions || !Array.isArray(body.permissions)) {
      return Response.json({ error: 'permissions array is required' }, { status: 400 });
    }
    // Strict validation: only ['owner'] or ['member'] are accepted
    const isOwnerRole = body.permissions.length === 1 && body.permissions[0] === 'owner';
    const isMemberRole = body.permissions.length === 1 && body.permissions[0] === 'member';
    if (!isOwnerRole && !isMemberRole) {
      return Response.json({ error: "permissions must be exactly ['owner'] or ['member']" }, { status: 400 });
    }
    const role = isOwnerRole ? 'owner' as const : 'member' as const;
    try {
      await assertAgentNetworkScope(req, params.id);
      const result = await networkService.updateMemberRole(params.id, params.memberId, user.id, role);
      logger.verbose('Member role updated', { networkId: params.id, memberId: params.memberId, role });
      return Response.json({ member: result.member, message: 'Role updated' });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      if (msg === 'Member not found') {
        return Response.json({ error: msg }, { status: 404 });
      }
      if (msg === 'Cannot demote the last owner' || msg === 'Cannot change role of a contact' || msg === 'Cannot change your own role') {
        return Response.json({ error: msg }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Remove a member from a network. Owner-only.
   */
  @Delete('/:id/members/:memberId')
  @UseGuards(RateLimit('write'), AuthGuard)
  async removeMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await networkService.removeMember(params.id, params.memberId, user.id);
      logger.verbose('Member removed from network', { networkId: params.id, memberId: params.memberId });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      if (msg === 'Member not found') {
        return Response.json({ error: msg }, { status: 404 });
      }
      if (msg === 'Cannot remove yourself from the network') {
        return Response.json({ error: msg }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Update a network (title, prompt, permissions). Owner-only.
   */
  @Put('/:id')
  @UseGuards(RateLimit('write'), AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const body = await req.json().catch(() => ({})) as {
        title?: string;
        prompt?: string | null;
        imageUrl?: string | null;
        joinPolicy?: 'anyone' | 'invite_only';
        allowGuestVibeCheck?: boolean;
        profileEnrichment?: 'auto' | 'consent_required' | 'disabled';
        type?: 'community' | 'event';
        metadata?: Record<string, unknown>;
        contextInjection?: { discovery: boolean };
      };

      if ('isExperiment' in body || 'experimentMasterKeyHash' in body) {
        return Response.json({ error: 'Cannot modify experiment settings after creation' }, { status: 400 });
      }

      const result = await networkService.updateNetwork(params.id, user.id, body);
      logger.verbose('Network updated', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      if (msg.includes('Cannot modify join policy on experiment networks')) {
        return Response.json({ error: msg }, { status: 400 });
      }
      if (err instanceof ZodError) {
        return Response.json({ error: 'Validation failed', details: err.issues }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Update network permissions. Owner-only.
   */
  @Patch('/:id/permissions')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updatePermissions(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const body = await req.json().catch(() => ({})) as { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean; contextInjection?: { discovery: boolean }; profileEnrichment?: 'auto' | 'consent_required' | 'disabled' };

      if ('isExperiment' in body || 'experimentMasterKeyHash' in body) {
        return Response.json({ error: 'Cannot modify experiment settings after creation' }, { status: 400 });
      }

      const result = await networkService.updatePermissions(params.id, user.id, body);
      logger.verbose('Permissions updated for network', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      if (msg.includes('Cannot modify join policy on experiment networks')) {
        return Response.json({ error: msg }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Rotate a network's invitation link, issuing a fresh code. Owner-only.
   * The previously shared link stops resolving once rotated.
   */
  @Patch('/:id/regenerate-invitation')
  @UseGuards(RateLimit('write'), AuthGuard)
  async regenerateInvitation(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const result = await networkService.regenerateInvitationLink(params.id, user.id);
      logger.verbose('Invitation link regenerated for network', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('not found')) {
        return new Response(JSON.stringify({ error: 'Network not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get public networks that the user has not joined (discovery).
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/discovery/public')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getPublicNetworks(_req: Request, user: AuthenticatedUser) {
    const result = await networkService.getPublicNetworks(user.id);
    logger.verbose('Public networks listed for user', { userId: user.id, count: result.networks.length });
    return Response.json(result);
  }

  /**
   * Get non-personal networks shared between the authenticated user and a target user.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/shared/:userId')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getSharedNetworks(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const networks = await networkService.getSharedNetworks(user.id, params.userId);
    logger.verbose('Shared networks fetched', { currentUserId: user.id, targetUserId: params.userId, count: networks.length });
    return Response.json({ networks });
  }

  /**
   * Delete (soft-delete) a network. Owner-only.
   */
  @Delete('/:id')
  @UseGuards(RateLimit('write'), AuthGuard)
  async delete(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await networkService.deleteNetwork(params.id, user.id);
      logger.verbose('Network deleted', { networkId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Join a public network.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/join')
  @UseGuards(RateLimit('write'), AuthGuard)
  async joinPublicNetwork(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const network = await networkService.joinPublicNetwork(params.id, user.id);
      logger.verbose('User joined public network', { networkId: params.id, userId: user.id });
      return Response.json({ network });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found')) {
        return Response.json({ error: msg }, { status: 404 });
      }
      if (msg.includes('not public')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/member-settings')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMemberSettings(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const settings = await networkService.getMemberSettings(params.id, user.id);
      logger.verbose('Member settings retrieved', { networkId: params.id, userId: user.id });
      return Response.json(settings);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Not a member')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Get current user's intents in a network. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/my-intents')
  @deprecatedRoute('network.my-intents')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getMyIntents(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const intents = await networkService.getMyIntentsInNetwork(params.id, user.id);
      logger.verbose('My intents retrieved for network', { networkId: params.id, userId: user.id, count: intents.length });
      return Response.json({ intents });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied') || msg.includes('Not a member')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Get the current user's overview for a network: their intents, premises, and
   * per-network user_context. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/overview')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getOverview(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const overview = await networkService.getNetworkOverview(params.id, user.id);
      logger.verbose('Network overview retrieved', { networkId: params.id, userId: user.id, intents: overview.intents.length, premises: overview.premises.length });
      return Response.json(overview);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied') || msg.includes('Not a member')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Leave a network. Members (non-owners) can leave.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/leave')
  @UseGuards(RateLimit('write'), AuthGuard)
  async leaveNetwork(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await networkService.leaveNetwork(params.id, user.id);
      logger.verbose('User left network', { networkId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found') || msg.includes('not a member')) {
        return Response.json({ error: msg }, { status: 404 });
      }
      if (msg.includes('Cannot leave')) {
        return Response.json({ error: msg }, { status: 400 });
      }
      throw err;
    }
  }

  /**
   * Get a network by its invitation share code (no auth required).
   * Used by the /l/[code] invitation page to preview the network before authentication.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/share/:code')
  @UseGuards(RateLimit('read'))
  async getNetworkByShareCode(_req: Request, _user: unknown, params: Record<string, string>) {
    const network = await networkService.getNetworkByShareCode(params.code);
    if (!network) {
      return Response.json({ error: 'Invalid or expired invitation link' }, { status: 404 });
    }
    return Response.json({ network });
  }

  /**
   * Accept an invitation to join a network using the invitation code.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/invitation/:code/accept')
  @UseGuards(RateLimit('write'), AuthGuard)
  async acceptInvitation(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const result = await networkService.acceptInvitation(params.code, user.id);
      return Response.json(result);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const isKnownError = msg.includes('Invalid or expired invitation link');
      logger.warn('Failed to accept invitation', { error: msg, userId: user.id });
      return Response.json({ error: isKnownError ? msg : 'Failed to accept invitation' }, { status: isKnownError ? 400 : 500 });
    }
  }

  /**
   * Get a public network by ID (no auth required). Only works for networks with joinPolicy 'anyone'.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/public/:id')
  @UseGuards(RateLimit('read'))
  async getPublicIndex(req: Request, _user: unknown, params: Record<string, string>) {
    await assertAgentNetworkScope(req, params.id);
    const network = await networkService.getPublicNetworkById(params.id);
    if (!network) {
      return Response.json({ error: 'Network not found' }, { status: 404 });
    }
    return Response.json({ network });
  }

  /**
   * Get a single network by ID or key with owner info and member count. Members-only.
   * IMPORTANT: This must come AFTER specific routes like /discovery/public and /:id/join.
   */
  @Get('/:id')
  @UseGuards(RateLimit('read'), AuthGuard)
  async get(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const network = await networkService.getNetworkById(params.id, user.id);
      if (!network) {
        return Response.json({ error: 'Network not found' }, { status: 404 });
      }
      return Response.json({ network });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }
}
