import { z } from 'zod';

import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Patch, Post, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, SessionOnlyGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { cliCredentialService, type CliCredentialService } from '../services/clicredential.service';
import { userService } from '../services/user.service';
import { enrichmentService } from '../services/enrichment.service';
import { isNegotiatorChatEnabled } from '../lib/negotiator-feature';
import { isWebSignalAgentEnabled } from '../lib/signal-feature';
import { isFastSignalIntakeEnabled } from '../lib/fast-intake-feature';
import { isAgentActionsEnabled, isAgentSurfaceEnabled } from '../lib/agent-surface-feature';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

const createCliCredentialSchema = z.object({
  protocolVersion: z.union([z.literal(1), z.literal(2)]),
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
    weeklyNewsletter: z.boolean().optional(),
  }).optional(),
});

export function hasAtLeastOneSocial(socials: unknown): boolean {
  return Array.isArray(socials) && socials.length > 0;
}

export function shouldAutoGenerateProfile(user: {
  name?: string | null;
  socials?: unknown;
  hasProfile?: boolean;
}): boolean {
  const hasName = typeof user.name === 'string' && user.name.trim().length > 0;
  return hasName && hasAtLeastOneSocial(user.socials) && !user.hasProfile;
}

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

    if (shouldAutoGenerateProfile(fullUser)) {
      logger.verbose('Auto-generating profile', { userId: user.id });
      enrichmentService.syncProfile(user.id).catch((error) => {
        logger.error('Background profile sync failed', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const { hasProfile: _hasProfile, notificationPreferences, ...userFields } = fullUser;
    return Response.json({
      user: {
        ...userFields,
        notificationPreferences,
      },
      // Feature flags the web app reads off the session bootstrap (no separate
      // config channel). These gate the negotiator entry and Signal web cutover.
      features: {
        negotiatorChat: isNegotiatorChatEnabled(),
        signalAgent: isWebSignalAgentEnabled(),
        agentSurface: isAgentSurfaceEnabled(),
        agentActions: isAgentActionsEnabled(),
        fastSignalIntake: isFastSignalIntakeEnabled(),
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
