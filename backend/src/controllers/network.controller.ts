import { ZodError } from 'zod';

import { assertAgentNetworkScope, withAgentScope } from '../guards/agent-scope.guard';
import { AuthGuard, AuthOrApiKeyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { ExperimentMasterKeyGuard, type ExperimentNetwork } from '../guards/experiment.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Delete, Get, Patch, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { experimentService, SignupNotCompleteError, type ImportRow } from '../services/experiment.service';
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
   * List networks the authenticated user is a member of, including their personal network.
   */
  @Get('')
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
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
      isExperiment?: boolean;
      type?: 'community' | 'event';
      metadata?: Record<string, unknown>;
    };

    if (!body.title) {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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
   * Headless signup for experiment networks. Authenticated via master key (x-api-key header).
   * Accepts an optional rich profile payload; returns the user, API key, and MCP server config.
   * Never sends email — the integrator (InstaClaw / EdgeOS) is the delivery channel.
   */
  @Post('/:id/signup')
  @UseGuards(RateLimit('write'))
  async signup(req: Request, _user: unknown, params: Record<string, string>) {
    let network: ExperimentNetwork;
    try {
      network = await ExperimentMasterKeyGuard(req, params);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => ({})) as {
      email?: string;
      name?: string;
      bio?: string;
      location?: string;
      socials?: unknown;
    };

    if (!body.email || typeof body.email !== 'string') {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!EMAIL_REGEX.test(body.email)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedField = (
      raw: unknown,
      field: string,
      cap: number,
    ): { value: string | undefined } | Response => {
      if (raw === undefined) return { value: undefined };
      if (typeof raw !== 'string') {
        return new Response(JSON.stringify({ error: `${field} must be a string` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { value: undefined };
      if (trimmed.length > cap) {
        return new Response(JSON.stringify({ error: `${field} exceeds maximum length of ${cap}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return { value: trimmed };
    };

    const nameResult = trimmedField(body.name, 'name', 200);
    if (nameResult instanceof Response) return nameResult;
    const bioResult = trimmedField(body.bio, 'bio', 2000);
    if (bioResult instanceof Response) return bioResult;
    const locationResult = trimmedField(body.location, 'location', 200);
    if (locationResult instanceof Response) return locationResult;

    const name = nameResult.value;
    const bio = bioResult.value;
    const location = locationResult.value;

    let socials: { label: string; value: string }[] | undefined;
    if (body.socials !== undefined) {
      if (!Array.isArray(body.socials)) {
        return new Response(JSON.stringify({ error: 'socials must be an array' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if ((body.socials as unknown[]).length > 32) {
        return new Response(JSON.stringify({ error: 'socials exceeds maximum of 32 entries' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const parsed: { label: string; value: string }[] = [];
      for (const entry of body.socials as unknown[]) {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as Record<string, unknown>).label !== 'string' ||
          typeof (entry as Record<string, unknown>).value !== 'string'
        ) {
          return new Response(JSON.stringify({ error: 'Each social entry must have label (string) and value (string)' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const { label: rawLabel, value: rawValue } = entry as { label: string; value: string };
        const label = rawLabel.trim();
        const value = rawValue.trim();
        if (label.length === 0 || value.length === 0) {
          return new Response(JSON.stringify({ error: 'social entries must have non-empty label and value' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (label.length > 64) {
          return new Response(JSON.stringify({ error: 'social label exceeds maximum length of 64' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (value.length > 256) {
          return new Response(JSON.stringify({ error: 'social value exceeds maximum length of 256' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        parsed.push({ label, value });
      }
      socials = parsed;
    }

    try {
      const result = await experimentService.signup(network.id, {
        email: body.email,
        name,
        bio,
        location,
        socials,
      });
      return Response.json(
        { user: result.user, apiKey: result.apiKey, mcpServer: result.mcpServer },
        { status: result.created ? 201 : 200 },
      );
    } catch (err: unknown) {
      logger.error('Experiment signup failed', { networkId: network.id, error: errorMessage(err) });
      return new Response(JSON.stringify({ error: 'Signup failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  /**
   * Read-only signup state check for an experiment network. Master-key
   * authenticated. Returns 200 with `{ user: { id, email } }` when the user is
   * fully provisioned for this network; 409 (single canned message) for any
   * partial/missing state. No side effects — safe to call from retry loops or
   * health probes.
   */
  @Post('/:id/signup/lookup')
  @UseGuards(RateLimit('write'))
  async signupLookup(req: Request, _user: unknown, params: Record<string, string>) {
    let network: ExperimentNetwork;
    try {
      network = await ExperimentMasterKeyGuard(req, params);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => null) as { email?: string } | null;
    if (!body || typeof body.email !== 'string') {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const normalizedEmail = body.email.toLowerCase().trim();
    if (normalizedEmail.length === 0) {
      return new Response(JSON.stringify({ error: 'email is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return new Response(JSON.stringify({ error: 'Invalid email format' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await experimentService.lookupSignup(network.id, normalizedEmail);
      return Response.json(result, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof SignupNotCompleteError) {
        return new Response(
          JSON.stringify({ error: 'User has not completed signup for this network' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      logger.error('Signup lookup failed', { networkId: network.id, error: errorMessage(err) });
      return new Response(JSON.stringify({ error: 'Lookup failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
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
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async addMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    const body = await req.json().catch(() => ({})) as { userId?: string; permissions?: string[] };
    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async removeMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
   * Parse a CSV file for member import. Owner-only, experiment networks only.
   * Used for large files (>500 rows) where client-side parsing is skipped.
   */
  @Post('/:id/members/import/parse')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async parseImportCsv(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get('file');
    if (!file || !(file instanceof File)) {
      return Response.json({ error: 'CSV file is required' }, { status: 400 });
    }

    try {
      const text = await file.text();
      const { valid, invalid } = this.parseCsvText(text);
      return Response.json({ valid, invalid });
    } catch (err: unknown) {
      logger.error('CSV parse failed', { networkId: params.id, error: errorMessage(err) });
      return Response.json({ error: 'Failed to parse CSV' }, { status: 400 });
    }
  }

  /**
   * Invite a single member to an experiment network by email. Owner-only.
   * Idempotent: re-inviting a user who already has a network-scoped agent is
   * a no-op (no key minted, no email). When the user does NOT yet have a
   * scoped agent — newly created users and pre-existing ghost contacts alike
   * — provisions one and emails the invitation with a connect command.
   */
  @Post('/:id/members/invite')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async inviteMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
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
   * Rotate a member's network-scoped api key and email it to them. Owner-only,
   * experiment networks only. Self-target is allowed (an owner can rotate their
   * own key).
   */
  @Post('/:id/members/:memberId/resend-invite')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async resendInviteToMember(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
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
   * Import members from parsed CSV data. Owner-only, experiment networks only.
   */
  @Post('/:id/members/import')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async importMembers(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    const body = await req.json().catch(() => ({})) as { members?: ImportRow[] };
    if (!body.members || !Array.isArray(body.members) || body.members.length === 0) {
      return Response.json({ error: 'members array is required' }, { status: 400 });
    }

    try {
      const result = await experimentService.importMembers(params.id, body.members);
      return Response.json(result);
    } catch (err: unknown) {
      logger.error('CSV import failed', { networkId: params.id, error: errorMessage(err) });
      return Response.json({ error: 'Import failed' }, { status: 500 });
    }
  }

  /**
   * Rotate the master key on an experiment network. Owner-only. The plaintext
   * is returned in the response body exactly once; the previous key stops
   * working immediately. Every owner of the network also receives the new
   * key by email.
   */
  @Post('/:id/rotate-master-key')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async rotateMasterKey(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      await this.assertExperimentOwner(params.id, user.id);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }

    try {
      const result = await networkService.rotateExperimentMasterKey(params.id, user.id);
      logger.verbose('Master key rotated', { networkId: params.id, userId: user.id });
      return Response.json({ masterKey: result.masterKey });
    } catch (err: unknown) {
      logger.error('Master key rotation failed', { networkId: params.id, error: errorMessage(err) });
      throw err;
    }
  }

  private async assertExperimentOwner(networkId: string, userId: string): Promise<void> {
    let network: Awaited<ReturnType<typeof networkService.getNetworkById>>;
    try {
      network = await networkService.getNetworkById(networkId, userId);
    } catch {
      throw Response.json({ error: 'Access denied' }, { status: 403 });
    }
    if (!network) {
      throw Response.json({ error: 'Network not found' }, { status: 404 });
    }
    if (!(network as Record<string, unknown>).isExperiment) {
      throw Response.json({ error: 'This operation is only available for experiment networks' }, { status: 403 });
    }
    const isOwner = await networkService.isIndexOwner(networkId, userId);
    if (!isOwner) {
      throw Response.json({ error: 'Owner-only operation' }, { status: 403 });
    }
  }

  private parseCsvText(text: string): { valid: ImportRow[]; invalid: { row: Record<string, string>; reason: string }[] } {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length === 0) return { valid: [], invalid: [] };

    const headers = this.parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
    const emailIdx = headers.indexOf('email');
    if (emailIdx === -1) return { valid: [], invalid: [] };

    const knownCols = new Set(['email', 'name', 'bio', 'location']);
    const valid: ImportRow[] = [];
    const invalid: { row: Record<string, string>; reason: string }[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => { row[h] = (values[idx] || '').trim(); });

      const email = row['email']?.toLowerCase().trim();
      if (!email) {
        invalid.push({ row, reason: 'Missing email' });
        continue;
      }
      if (!EMAIL_REGEX.test(email)) {
        invalid.push({ row, reason: 'Invalid email format' });
        continue;
      }

      const socials: { label: string; value: string }[] = [];
      for (const [key, val] of Object.entries(row)) {
        if (!knownCols.has(key) && val) {
          socials.push({ label: key, value: val });
        }
      }

      valid.push({
        email,
        name: row['name'] || undefined,
        bio: row['bio'] || undefined,
        location: row['location'] || undefined,
        socials,
      });
    }

    return { valid, invalid };
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          result.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    result.push(current);
    return result;
  }

  /**
   * Update a network (title, prompt, permissions). Owner-only.
   */
  @Put('/:id')
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async update(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const body = await req.json().catch(() => ({})) as {
        title?: string;
        prompt?: string | null;
        imageUrl?: string | null;
        joinPolicy?: 'anyone' | 'invite_only';
        allowGuestVibeCheck?: boolean;
        type?: 'community' | 'event';
        metadata?: Record<string, unknown>;
        contextInjection?: { discovery: boolean };
      };

      if ('isExperiment' in body || 'experimentMasterKeyHash' in body) {
        return new Response(JSON.stringify({ error: 'Cannot modify experiment settings after creation' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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
      if (msg.includes('Cannot modify join policy on experiment networks')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async updatePermissions(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const body = await req.json().catch(() => ({})) as { joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean };

      if ('isExperiment' in body || 'experimentMasterKeyHash' in body) {
        return new Response(JSON.stringify({ error: 'Cannot modify experiment settings after creation' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

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
      if (msg.includes('Cannot modify join policy on experiment networks')) {
        return new Response(JSON.stringify({ error: msg }), {
          status: 400,
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async delete(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async joinPublicNetwork(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async getMemberSettings(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async getMyIntents(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
  async leaveNetwork(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('read'))
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
  @UseGuards(RateLimit('write'), AuthGuard)
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
  @UseGuards(RateLimit('read'))
  async getPublicIndex(req: Request, _user: unknown, params: Record<string, string>) {
    await assertAgentNetworkScope(req, params.id);
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
  @UseGuards(RateLimit('write'), AuthOrApiKeyGuard)
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
    const resolvedId = await networkService.resolveIndexId(params.id);
    if (!resolvedId) {
      return Response.json({ error: 'Network not found' }, { status: 404 });
    }

    await assertAgentNetworkScope(req, resolvedId);

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
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async get(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
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
