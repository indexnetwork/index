import { ZodError } from 'zod';

import { assertAgentNetworkScope, withAgentScope } from '../guards/agent-scope.guard';
import { AuthGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { isStaff } from '../lib/staff';
import { networkInvitationService } from '../services/network-invitation.service';
import { networkService } from '../services/network.service';

const logger = log.controller.from('network');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Controller('/networks')
export class NetworkController {
  /**
   * List networks the authenticated user is a member of.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthGuard)
  async list(req: Request, user: AuthenticatedUser) {
    const { networkScopeId } = await withAgentScope(req, user);
    const result = await networkService.getNetworksForUser(user.id);
    let filtered = result;
    if (networkScopeId) {
      const networks = result.networks.filter((n: { id: string }) => n.id === networkScopeId);
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
      metadata?: Record<string, unknown>;
    };

    if (!body.title) {
      return Response.json({ error: 'title is required' }, { status: 400 });
    }

    // Early access: direct network creation is staff-only. Everyone else goes
    // through the reviewed request flow (POST /network-requests). This is the
    // server-side enforcement behind the web UI's "request a network" gate, so
    // API/CLI clients cannot bypass it.
    if (!isStaff(user)) {
      return Response.json(
        { error: 'Network creation is in early access. Submit a request at POST /network-requests.' },
        { status: 403 },
      );
    }


    try {
      const result = await networkService.createNetwork(user.id, {
        title: body.title,
        prompt: body.prompt,
        imageUrl: body.imageUrl,
        joinPolicy: body.joinPolicy,
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
      if (msg === 'Cannot demote the last owner' || msg === 'Cannot change your own role') {
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
        metadata?: Record<string, unknown>;
        contextInjection?: { discovery: boolean };
      };

      const result = await networkService.updateNetwork(params.id, user.id, body);
      logger.verbose('Network updated', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
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
      const body = await req.json().catch(() => ({})) as { joinPolicy?: 'anyone' | 'invite_only'; contextInjection?: { discovery: boolean } };

      const result = await networkService.updatePermissions(params.id, user.id, body);
      logger.verbose('Permissions updated for network', { networkId: params.id });
      return Response.json({ network: result });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }

  /**
   * Invite a single member to a network by email. Owner-only.
   * Idempotent: re-inviting a user who already has a network-scoped agent is
   * a no-op (no key minted, no email). When the user does NOT yet have a
   * scoped agent — newly created and pre-existing users alike
   * — provisions one and emails the invitation with a connect command.
   */
  @Post('/:id/members/invite')
  @UseGuards(RateLimit('write'), AuthGuard)
  async inviteMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => ({})) as { email?: string; name?: string };
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email) {
      return Response.json({ error: 'email is required' }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : undefined;

    try {
      const result = await networkInvitationService.invite({
        networkId: params.id,
        email,
        name: name || undefined,
      });
      return Response.json({
        user: { id: result.user.id, email: result.user.email },
        created: result.created,
        alreadyMember: result.alreadyMember,
        agentProvisioned: result.agentProvisioned,
      }, { status: result.created ? 201 : 200 });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('email exists but is filtered out')) {
        return Response.json({ error: msg }, { status: 409 });
      }
      logger.error('Invite by email failed', { networkId: params.id, error: msg });
      return Response.json({ error: 'Invite failed' }, { status: 500 });
    }
  }

  /**
   * Rotate a member's network-scoped api key and email it to them. Owner-only.
   * Self-target is allowed (an owner can rotate their own key).
   */
  @Post('/:id/members/:memberId/resend-invite')
  @UseGuards(RateLimit('write'), AuthGuard)
  async resendInviteToMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    try {
      const result = await networkInvitationService.resendInvite({
        networkId: params.id,
        memberId: params.memberId,
      });
      return Response.json(result, { status: 200 });
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg === 'Member not found') {
        return Response.json({ error: 'Member not found' }, { status: 404 });
      }
      logger.error('Resend invite failed', { networkId: params.id, memberId: params.memberId, error: msg });
      return Response.json({ error: 'Resend failed' }, { status: 500 });
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
   * Get networks shared between the authenticated user and a target user.
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
   * Get the current user's overview for a network: their intents and
   * per-network user_context. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/overview')
  @UseGuards(RateLimit('read'), AuthGuard)
  async getOverview(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const overview = await networkService.getNetworkOverview(params.id, user.id);
      logger.verbose('Network overview retrieved', { networkId: params.id, userId: user.id, intents: overview.intents.length });
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

  private async assertOwner(networkId: string, userId: string): Promise<void> {
    let network: Awaited<ReturnType<typeof networkService.getNetworkById>>;
    try {
      network = await networkService.getNetworkById(networkId, userId);
    } catch {
      throw Response.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!network) {
      throw Response.json({ error: 'Network not found' }, { status: 404 });
    }
    const isOwner = await networkService.isIndexOwner(networkId, userId);
    if (!isOwner) {
      throw Response.json({ error: 'Owner-only operation' }, { status: 403 });
    }
  }

}
