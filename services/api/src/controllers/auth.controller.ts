import { z } from 'zod';

import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Patch, Post, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, SessionOnlyGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { cliCredentialService, type CliCredentialService } from '../services/clicredential.service';
import { userService } from '../services/user.service';
import { onboardingService } from '../services/onboarding.service';
import { agentService } from '../services/agent.service';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

const createCliCredentialSchema = z.object({
  protocolVersion: z.literal(2),
}).strict();

const revokeCliCredentialSchema = z.object({
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
    private readonly cliCredentials: Pick<CliCredentialService, 'create' | 'revoke'> = cliCredentialService,
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
      try {
        await agentService.grantDefaultSystemPermissions(user.id);
      } catch (grantErr) {
        logger.warn('Default system agent permission grant failed', {
          userId: user.id,
          error: grantErr instanceof Error ? grantErr.message : String(grantErr),
        });
      }
      return Response.json({ success: true, message: 'Onboarding complete.', ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 400 });
    }
  }

  /**
   * Mint a fixed-shape, time-bounded CLI API credential.
   *
   * @param req - Request containing only a supported protocol version.
   * @param user - Session-authenticated user.
   * @returns Raw API key once, its row ID, and its expiry.
   */
  @Post('/cli-credential')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async createCliCredential(req: Request, user: AuthenticatedUser) {
    const parsed = createCliCredentialSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid CLI credential payload' }, { status: 400 });
    }

    const credential = await this.cliCredentials.create(user.id, parsed.data.protocolVersion);
    return Response.json({
      key: credential.key,
      id: credential.id,
      expiresAt: credential.expiresAt.toISOString(),
    });
  }

  /**
   * Revoke an exact CLI credential using an active CLI x-api-key caller.
   *
   * @param req - Request carrying only x-api-key authentication and exact target proof.
   * @param user - API-key-authenticated owner resolved by AuthGuard.
   * @returns Stable success only after authoritative deletion; otherwise a stable denial.
   */
  @Post('/cli-credential/revoke')
  @UseGuards(RateLimit('write'), AuthGuard)
  async revokeCliCredential(req: Request, user: AuthenticatedUser) {
    const callerKey = req.headers.get('x-api-key');
    const hasCompetingCredential = req.headers.has('authorization')
      || new URL(req.url).searchParams.has('token');
    if (!callerKey || callerKey.length === 0 || hasCompetingCredential) {
      return Response.json({ error: 'CLI credential revocation requires x-api-key authentication' }, { status: 403 });
    }

    const parsed = revokeCliCredentialSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid CLI credential revocation payload' }, { status: 400 });
    }

    const revoked = await this.cliCredentials.revoke({
      userId: user.id,
      callerKey,
      keyId: parsed.data.keyId,
      targetKey: parsed.data.targetKey,
    });
    if (!revoked) {
      return Response.json({ error: 'CLI credential revocation denied' }, { status: 403 });
    }
    return Response.json({ success: true });
  }

  /**
   * Soft-deletes the authenticated user's account.
   * Session-only: a leaked agent API key must not be able to destroy the account (IND-384).
   */
  @Delete('/account')
  @UseGuards(RateLimit('write'), SessionOnlyGuard)
  async deleteAccount(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Account deletion requested', { userId: user.id });
    await userService.softDelete(user.id);
    return Response.json({ success: true });
  }
}
