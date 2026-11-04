import { z } from 'zod';

import { Controller, Get, Patch, Post, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard, SessionOnlyGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { consentService } from '../services/consent.service';
import { onboardingService } from '../services/onboarding.service';
import { log } from '../lib/log';
import { emailPasswordEnabled } from '../lib/betterauth/betterauth';

const logger = log.controller.from('auth');

const updateProfileSchema = z.object({
  name: z.string().optional(),
  /** Empty or null clears it. Validated and uniqueness-checked by `userService.setUsername`. */
  username: z.string().max(80).nullable().optional(),
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
    opportunity: z.boolean().optional(),
    accepted: z.boolean().optional(),
    messages: z.boolean().optional(),
    morningBrief: z.boolean().optional(),
  }).optional(),
});

const completeOnboardingSchema = z.object({
  intentId: z.string().min(1).optional(),
}).strict();

const recordConsentSchema = z.object({
  networkId: z.string().min(1),
  signature: z.string().trim().min(1),
  privacyPolicy: z.literal(true),
  participation: z.literal(true),
}).strict();

function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return null;
  const first = forwarded.split(',')[0]?.trim();
  return first || null;
}

const revokeDeviceSchema = z.object({
  sessionId: z.string().min(1),
}).strict();

@Controller('/auth')
export class AuthController {
  /**
   * Returns the list of configured social auth providers (public, no auth required).
   */
  @Get('/providers')
  async providers() {
    const providers: string[] = [];
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
      providers.push('google');
    }
    if (process.env.EDGEOS_TENANT_ID) {
      providers.push('edge-city');
    }
    return Response.json({
      providers,
      emailPassword: emailPasswordEnabled,
      emailPasswordRestricted: process.env.NODE_ENV === 'production',
    });
  }

  /**
   * Returns the current authenticated user.
   * Response shape: { user: User } for frontend APIResponse compatibility.
   */
  @Get('/me')
  @UseGuards(AuthGuard)
  async me(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Auth me requested', { userId: user.id });
    const fullUser = await userService.findWithGraph(user.id);
    if (!fullUser) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const { hasProfile: _hasProfile, notificationPreferences, ...userFields } = fullUser;
    const pendingConsents = await consentService.pending(user.id);
    return Response.json({
      user: {
        ...userFields,
        notificationPreferences,
        pendingConsents,
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
  @UseGuards(AuthGuard)
  async updateProfile(req: Request, user: AuthenticatedUser) {
    const parsed = updateProfileSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid profile update payload' }, { status: 400 });
    }
    const { notificationPreferences, socials, username, ...userFields } = parsed.data;

    // The username goes first: a refused one fails the whole save, before anything else is written.
    if (username !== undefined) {
      const claimed = await userService.setUsername(user.id, username);
      if (claimed.kind === 'invalid') {
        return Response.json({ error: claimed.error }, { status: 400 });
      }
      if (claimed.kind === 'taken') {
        return Response.json({ error: 'That username is taken' }, { status: 409 });
      }
    }
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

  @Post('/consent')
  @UseGuards(AuthGuard)
  async recordConsent(req: Request, user: AuthenticatedUser) {
    const parsed = recordConsentSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return Response.json({ error: 'Invalid consent payload' }, { status: 400 });
    }
    try {
      await consentService.record(
        user.id,
        parsed.data.networkId,
        parsed.data.signature,
        clientIp(req),
        req.headers.get('user-agent'),
      );
      return Response.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return Response.json({ error: message }, { status: 400 });
    }
  }

  @Post('/onboarding/confirm-profile')
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
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
   * Soft-deletes the authenticated user's account.
   * Session-only: a leaked API key must not be able to destroy the account (IND-384).
   */
  @Delete('/account')
  @UseGuards(SessionOnlyGuard)
  async deleteAccount(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Account deletion requested', { userId: user.id });
    await userService.softDelete(user.id);
    return Response.json({ success: true });
  }

  /**
   * Lists the devices this account is signed in on.
   *
   * Better Auth's own `list-sessions` returns each session's token; this
   * returns metadata only, so the list can be rendered by a client that must
   * never hold another device's credential.
   */
  @Get('/devices')
  @UseGuards(SessionOnlyGuard)
  async devices(_req: Request, user: AuthenticatedUser) {
    const devices = await userService.listDevices(user.id);
    return Response.json({ devices, currentId: user.sessionId ?? null });
  }

  /**
   * Signs one device out. Session-only: an API key must not be able to evict
   * the sessions that could revoke it.
   */
  @Post('/devices/revoke')
  @UseGuards(SessionOnlyGuard)
  async revokeDevice(req: Request, user: AuthenticatedUser) {
    const parsed = revokeDeviceSchema.safeParse(await req.json());
    if (!parsed.success) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }

    const revoked = await userService.revokeDevice(user.id, parsed.data.sessionId);
    if (!revoked) {
      return Response.json({ error: 'Device not found' }, { status: 404 });
    }

    return Response.json({ success: true });
  }
}
