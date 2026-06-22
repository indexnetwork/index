import { assertAgentNetworkScope } from '../guards/agent-scope.guard';
import { AuthOrApiKeyGuard, type AuthenticatedUser } from '../guards/auth.guard';
import { ExperimentMasterKeyGuard, type ExperimentNetwork } from '../guards/experiment.guard';
import { RateLimit } from '../guards/limiter.guard';
import { log } from '../lib/log';
import { Controller, Post, Put, UseGuards } from '../lib/router/router.decorators';
import { experimentService, SignupNotCompleteError, type ImportRow } from '../services/experiment.service';
import { networkInvitationService } from '../services/network-invitation.service';
import { networkService } from '../services/network.service';

const logger = log.controller.from('network-experiment');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Experiment-network operations split out of {@link NetworkController}: headless
 * master-key signup/lookup, CSV member import/parse, single-email invite/resend,
 * and master-key/network-key rotation. Shares the `/networks` route prefix — the
 * router dispatches by full method+path, so these sit alongside NetworkController.
 */
@Controller('/networks')
export class NetworkExperimentController {
  /**
   * Headless signup for experiment networks. Authenticated via master key (x-api-key header).
   * Accepts an optional rich profile payload; returns the user, API key, and MCP server config.
   * Never sends email — the integrator is the delivery channel.
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
      return Response.json({ error: 'email is required' }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(body.email)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    const trimmedField = (
      raw: unknown,
      field: string,
      cap: number,
    ): { value: string | undefined } | Response => {
      if (raw === undefined) return { value: undefined };
      if (typeof raw !== 'string') {
        return Response.json({ error: `${field} must be a string` }, { status: 400 });
      }
      const trimmed = raw.trim();
      if (trimmed.length === 0) return { value: undefined };
      if (trimmed.length > cap) {
        return Response.json({ error: `${field} exceeds maximum length of ${cap}` }, { status: 400 });
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
        return Response.json({ error: 'socials must be an array' }, { status: 400 });
      }
      if ((body.socials as unknown[]).length > 32) {
        return Response.json({ error: 'socials exceeds maximum of 32 entries' }, { status: 400 });
      }
      const parsed: { label: string; value: string }[] = [];
      for (const entry of body.socials as unknown[]) {
        if (
          typeof entry !== 'object' ||
          entry === null ||
          typeof (entry as Record<string, unknown>).label !== 'string' ||
          typeof (entry as Record<string, unknown>).value !== 'string'
        ) {
          return Response.json({ error: 'Each social entry must have label (string) and value (string)' }, { status: 400 });
        }
        const { label: rawLabel, value: rawValue } = entry as { label: string; value: string };
        const label = rawLabel.trim();
        const value = rawValue.trim();
        if (label.length === 0 || value.length === 0) {
          return Response.json({ error: 'social entries must have non-empty label and value' }, { status: 400 });
        }
        if (label.length > 64) {
          return Response.json({ error: 'social label exceeds maximum length of 64' }, { status: 400 });
        }
        if (value.length > 256) {
          return Response.json({ error: 'social value exceeds maximum length of 256' }, { status: 400 });
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
      return Response.json({ error: 'Signup failed' }, { status: 500 });
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
      return Response.json({ error: 'email is required' }, { status: 400 });
    }
    const normalizedEmail = body.email.toLowerCase().trim();
    if (normalizedEmail.length === 0) {
      return Response.json({ error: 'email is required' }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return Response.json({ error: 'Invalid email format' }, { status: 400 });
    }

    try {
      const result = await experimentService.lookupSignup(network.id, normalizedEmail);
      return Response.json(result, { status: 200 });
    } catch (err: unknown) {
      if (err instanceof SignupNotCompleteError) {
        return Response.json({ error: 'User has not completed signup for this network' }, { status: 409 });
      }
      logger.error('Signup lookup failed', { networkId: network.id, error: errorMessage(err) });
      return Response.json({ error: 'Lookup failed' }, { status: 500 });
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
}
