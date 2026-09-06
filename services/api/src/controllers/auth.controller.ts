import { z } from 'zod';

import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Patch, Post, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, SessionOnlyGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { apiKeyService, type ApiKeyService } from '../services/apikey.service';
import { userService } from '../services/user.service';
import { onboardingService } from '../services/onboarding.service';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
}).strict();

const revokeOwnApiKeySchema = z.object({
  keyId: z.string().min(1).max(128),
  targetKey: z.string().min(1).max(512),
}).strict();

const updateProfileSchema = z.object({
  name: z.string().optional(),
  intro: z.string().optional(),
  avatar: z.string().optional(),
  location: z.string().optional(),
  timezone: z.string().optional(),
  socials: z.array(
    z.object({
      label: z.string().min(1),
      value: z.string().min(1),
    }),
  ).optional(),
  notificationPreferences: z.object({
    connectionUpdates: z.boolean().optional(),
  }).optional(),
});

const completeOnboardingSchema = z.object({
  intentId: z.string().min(1).optional(),
}).strict();

@Controller('/auth')
export class AuthController {
  constructor(
    private readonly keys: Pick<ApiKeyService, 'create' | 'list' | 'revoke' | 'revokeOwn'> = apiKeyService,
  ) {}

  /**
   * Returns the list of configured social auth providers (public, no auth required).
   */
  @Get('/providers')
  @UseGuards(RateLimit('read'))
  async providers() {
    const providers: string[] = [];
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      providers.push('google');
    }
    return Response.json({ providers, emailPassword: process.env.NODE_ENV !== 'production' });
  }

  /**
   * Returns the current authenticated user.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Get('/me')
  @UseGuards(RateLimit('read'), AuthGuard)
  async me(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Auth me requested', { userId: user.id });
    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const { hasProfile: _hasProfile, notificationPreferences, ...userFields } = fullUser;
    return Response.json({
      user: {
        ...userFields,
        notificationPreferences,
      },
      features: {
        // Legacy shipped-mac-client compat: older mac builds hide the agent
        // chat pane unless this bit is true. Hardcoded — nothing gates the
        // surface any more; delete when a gate-free mac build ships.
        negotiatorChat: true,
      },
    });
  }

  /**
   * Updates the authenticated user's profile.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Patch('/profile/update')
  @UseGuards(RateLimit('write'), AuthGuard)
  async updateProfile(req: Request, user: AuthenticatedUser) {
    const parsed = updateProfileSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid profile update payload' }, { status: 400 });
    }
    const { notificationPreferences, socials, ...userFields } = parsed.data;

    if (Object.keys(userFields).length > 0) {
      await userService.update(user.id, userFields);
    }
    if (socials) {
      await userService.setSocials(user.id, socials);
    }
    if (notificationPreferences) {
      await userService.updateNotificationPreferences(user.id, notificationPreferences);
    }

    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const { hasProfile: _hasProfileOut, notificationPreferences: prefs, ...userFieldsOut } = fullUser;
    return Response.json({
      user: { ...userFieldsOut, notificationPreferences: prefs },
    });
  }

  @Post('/onboarding/confirm-profile')
  @UseGuards(RateLimit('write'), AuthGuard)
  async confirmOnboardingProfile(_req: Request, user: AuthenticatedUser) {
    try {
      const result = await onboardingService.confirmProfile(user.id);
      return Response.json({ success: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 400 });
    }
  }

  @Post('/onboarding/complete')
  @UseGuards(RateLimit('write'), AuthGuard)
  async completeOnboarding(req: Request, user: AuthenticatedUser) {
    const parsed = completeOnboardingSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid onboarding payload' }, { status: 400 });
    }
    try {
      const result = await onboardingService.complete(user.id, parsed.data.intentId);
      return Response.json({ success: true, message: 'Onboarding complete.', ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 400 });
    }
  }

  /**
   * Mint an API key for the authenticated user. This is the single mint path,
   * shared by the browser handshake at `/cli-auth` and the settings UI.
   *
   * @param req - Request with an optional display name for the key.
   * @param user - Session-authenticated user.
   * @returns The raw secret once, plus its row ID, name and creation time.
   */
  @Post('/keys')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async createKey(req: Request, user: AuthenticatedUser) {
    const parsed = createApiKeySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid API key payload' }, { status: 400 });
    }

    const key = await this.keys.create(user.id, parsed.data.name);
    logger.verbose('API key minted', { userId: user.id, keyId: key.id });
    return Response.json(key, { status: 201 });
  }

  /**
   * List the authenticated user's keys. Secrets are never returned again.
   *
   * @param _req - Unused.
   * @param user - Session-authenticated user.
   * @returns Masked key records.
   */
  @Get('/keys')
  @UseGuards(RateLimit('read'), SessionOnlyGuard)
  async listKeys(_req: Request, user: AuthenticatedUser) {
    const keys = await this.keys.list(user.id);
    return Response.json({ keys });
  }

  /**
   * Revoke one of the authenticated user's keys by ID.
   *
   * @param _req - Unused.
   * @param user - Session-authenticated user.
   * @param params - Route params carrying the key ID.
   * @returns 204 on deletion, 404 when the user owns no such key.
   */
  @Delete('/keys/:id')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async revokeKey(_req: Request, user: AuthenticatedUser, params?: Record<string, string>) {
    const keyId = params?.id;
    if (!keyId) {
      return Response.json({ error: 'Key ID is required' }, { status: 400 });
    }

    try {
      await this.keys.revoke(user.id, keyId);
      return new Response(null, { status: 204 });
    } catch {
      return Response.json({ error: 'Key not found' }, { status: 404 });
    }
  }

  /**
   * Retire the caller's own key by re-proving its raw secret. This is the
   * logout path for clients that hold a key and no session; they cannot name
   * anyone else's row.
   *
   * @param req - Request carrying only x-api-key auth plus the exact target proof.
   * @param user - API-key-authenticated owner resolved by AuthGuard.
   * @returns Stable success only after authoritative deletion; otherwise a stable denial.
   */
  @Post('/keys/revoke-self')
  @UseGuards(RateLimit('write'), AuthGuard)
  async revokeOwnKey(req: Request, user: AuthenticatedUser) {
    const callerKey = req.headers.get('x-api-key');
    const hasCompetingCredential = req.headers.has('authorization')
      || new URL(req.url).searchParams.has('token');
    if (!callerKey || hasCompetingCredential) {
      return Response.json({ error: 'Self-revocation requires x-api-key authentication' }, { status: 403 });
    }

    const parsed = revokeOwnApiKeySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid revocation payload' }, { status: 400 });
    }

    const revoked = await this.keys.revokeOwn({
      userId: user.id,
      keyId: parsed.data.keyId,
      targetKey: parsed.data.targetKey,
    });
    if (!revoked) {
      return Response.json({ error: 'Revocation denied' }, { status: 403 });
    }
    return Response.json({ success: true });
  }

  /**
   * Soft-deletes the authenticated user's account.
   * Session-only: a leaked API key must not be able to destroy the account (IND-384).
   */
  @Delete('/account')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async deleteAccount(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Account deletion requested', { userId: user.id });
    await userService.softDelete(user.id);
    return Response.json({ success: true });
  }
}
