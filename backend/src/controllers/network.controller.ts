import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { log } from '../lib/log';
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
  @UseGuards(AuthGuard)
  async list(_req: Request, user: AuthenticatedUser) {
    const result = await networkService.getNetworksForUser(user.id);
    logger.verbose('Networks listed for user', { userId: user.id, count: result.networks.length });
    return Response.json(result);
  }

  /**
   * Create a new network. Authenticated users only.
   */
  @Post('')
  @UseGuards(AuthGuard)
  async create(req: Request, user: AuthenticatedUser) {
    const body = await req.json().catch(() => ({})) as {
      title?: string;
      prompt?: string;
      imageUrl?: string | null;
      joinPolicy?: 'anyone' | 'invite_only';
      allowGuestVibeCheck?: boolean;
    };

    if (!body.title) {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await networkService.createNetwork(user.id, {
      title: body.title,
      prompt: body.prompt,
      imageUrl: body.imageUrl,
      joinPolicy: body.joinPolicy,
      allowGuestVibeCheck: body.allowGuestVibeCheck,
    });
    logger.verbose('Network created', { networkId: result.id, userId: user.id });
    return Response.json({ network: result });
  }

  /**
   * Search users by name/email, optionally excluding existing members of a network.
   */
  @Get('/search-users')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  async getMyMembers(_req: Request, user: AuthenticatedUser) {
    const members = await networkService.getMembersFromMyNetworks(user.id);
    logger.verbose('My-network members listed', { userId: user.id, count: members.length });
    return Response.json({ members });
  }

  /**
   * Get members of a network. Owner-only.
   */
  @Get('/:id/members')
  @UseGuards(AuthGuard)
  async getMembers(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
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
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Add a member to a network. Owner/admin-only.
   */
  @Post('/:id/members')
  @UseGuards(AuthGuard)
  async addMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = await req.json().catch(() => ({})) as { userId?: string; permissions?: string[] };
    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      const role = body.permissions?.includes('admin') ? 'admin' as const : 'member' as const;
      const result = await networkService.addMember(params.id, body.userId, user.id, role);
      return Response.json({ member: result.member, message: result.alreadyMember ? 'Already a member' : 'Member added' });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Remove a member from a network. Owner-only.
   */
  @Delete('/:id/members/:memberId')
  @UseGuards(AuthGuard)
  async removeMember(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await networkService.removeMember(params.id, params.memberId, user.id);
      logger.verbose('Member removed from network', { networkId: params.id, memberId: params.memberId });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg === 'Member not found') {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg === 'Cannot remove yourself from the network') {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Update a network (title, prompt, permissions). Owner-only.
   */
  @Put('/:id')
  @UseGuards(AuthGuard)
  async update(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const body = await req.json().catch(() => ({})) as {
        title?: string;
        prompt?: string | null;
        imageUrl?: string | null;
        joinPolicy?: 'anyone' | 'invite_only';
        allowGuestVibeCheck?: boolean;
      };
      const result = await networkService.updateNetwork(params.id, user.id, body);
      logger.verbose('Network updated', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Update network permissions. Owner-only.
   */
  @Patch('/:id/permissions')
  @UseGuards(AuthGuard)
  async updatePermissions(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const body = await req.json().catch(() => ({})) as { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean };
      const result = await networkService.updatePermissions(params.id, user.id, body);
      logger.verbose('Permissions updated for network', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
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
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  async getSharedNetworks(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const networks = await networkService.getSharedNetworks(user.id, params.userId);
    logger.verbose('Shared networks fetched', { currentUserId: user.id, targetUserId: params.userId, count: networks.length });
    return Response.json({ networks });
  }

  /**
   * Delete (soft-delete) a network. Owner-only.
   */
  @Delete('/:id')
  @UseGuards(AuthGuard)
  async delete(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await networkService.deleteNetwork(params.id, user.id);
      logger.verbose('Network deleted', { networkId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Join a public network.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/join')
  @UseGuards(AuthGuard)
  async joinPublicNetwork(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const network = await networkService.joinPublicNetwork(params.id, user.id);
      logger.verbose('User joined public network', { networkId: params.id, userId: user.id });
      return Response.json({ network });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('not public')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/member-settings')
  @UseGuards(AuthGuard)
  async getMemberSettings(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const settings = await networkService.getMemberSettings(params.id, user.id);
      logger.verbose('Member settings retrieved', { networkId: params.id, userId: user.id });
      return Response.json(settings);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Get current user's intents in a network. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/my-intents')
  @UseGuards(AuthGuard)
  async getMyIntents(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const intents = await networkService.getMyIntentsInNetwork(params.id, user.id);
      logger.verbose('My intents retrieved for network', { networkId: params.id, userId: user.id, count: intents.length });
      return Response.json({ intents });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied') || msg.includes('Not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }

  /**
   * Leave a network. Members (non-owners) can leave.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/:id/leave')
  @UseGuards(AuthGuard)
  async leaveNetwork(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await networkService.leaveNetwork(params.id, user.id);
      logger.verbose('User left network', { networkId: params.id, userId: user.id });
      return Response.json({ success: true });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('not found') || msg.includes('not a member')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (msg.includes('Cannot leave')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
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
  async getNetworkByShareCode(_req: Request, _user: unknown, params: Record<string, string>) {
    const network = await networkService.getNetworkByShareCode(params.code);
    if (!network) {
      return new Response(JSON.stringify({ error: 'Invalid or expired invitation link' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return Response.json({ network });
  }

  /**
   * Accept an invitation to join a network using the invitation code.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Post('/invitation/:code/accept')
  @UseGuards(AuthGuard)
  async acceptInvitation(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const result = await networkService.acceptInvitation(params.code, user.id);
      return Response.json(result);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      const isKnownError = msg.includes('Invalid or expired invitation link');
      logger.warn('Failed to accept invitation', { error: msg, userId: user.id });
      return new Response(JSON.stringify({ error: isKnownError ? msg : 'Failed to accept invitation' }), {
        status: isKnownError ? 400 : 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Get a public network by ID (no auth required). Only works for networks with joinPolicy 'anyone'.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/public/:id')
  async getPublicIndex(_req: Request, _user: unknown, params: Record<string, string>) {
    const network = await networkService.getPublicNetworkById(params.id);
    if (!network) {
      return new Response(JSON.stringify({ error: 'Network not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return Response.json({ network });
  }

  /**
   * PUT /networks/:id/key — update a network's key. Owner-only.
   * @param req - Request with JSON body `{ key: string }`
   * @param user - Authenticated user from AuthGuard
   * @param params - Route params containing the network ID
   * @returns Updated network or validation error
   */
  @Put('/:id/key')
  @UseGuards(AuthGuard)
  async updateKey(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    let body: { key?: string };
    try {
      body = (await req.json()) as { key?: string };
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.key || typeof body.key !== 'string') {
      return Response.json({ error: 'key is required' }, { status: 400 });
    }

    // Resolve idOrKey to actual UUID first
    const resolvedId = await networkService.resolveNetworkId(params.id);
    if (!resolvedId) {
      return Response.json({ error: 'Network not found' }, { status: 404 });
    }

    const result = await networkService.updateKey(resolvedId, user.id, body.key);
    if ('error' in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json(result);
  }

  /**
   * Get a single network by ID or key with owner info and member count. Members-only.
   * IMPORTANT: This must come AFTER specific routes like /discovery/public and /:id/join.
   */
  @Get('/:id')
  @UseGuards(AuthGuard)
  async get(_req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      const network = await networkService.getNetworkById(params.id, user.id);
      if (!network) {
        return new Response(JSON.stringify({ error: 'Network not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return Response.json({ network });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw err;
    }
  }
}
