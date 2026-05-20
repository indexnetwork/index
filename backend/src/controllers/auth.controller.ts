import { z } from 'zod';

import { RateLimit } from '../guards/limiter.guard';
import { Controller, Get, Patch, Delete, UseGuards } from '../lib/router/router.decorators';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthenticatedUser } from '../guards/auth.guard';
import { userService } from '../services/user.service';
import { profileService } from '../services/profile.service';
import { log } from '../lib/log';

const logger = log.controller.from('auth');

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
  profile?: unknown;
}): boolean {
  const hasName = typeof user.name === 'string' && user.name.trim().length > 0;
  return hasName && hasAtLeastOneSocial(user.socials) && !user.profile;
}

@Controller('/auth')
export class AuthController {
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
      profileService.syncProfile(user.id).catch((error) => {
        logger.error('Background profile sync failed', {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    const { profile: _profile, notificationPreferences, ...userFields } = fullUser;
    return Response.json({
      user: {
        ...userFields,
        notificationPreferences,
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
    const { profile: _profileOut, notificationPreferences: prefs, ...userFieldsOut } = fullUser;
    return Response.json({
      user: { ...userFieldsOut, notificationPreferences: prefs },
    });
  }

  /**
   * Soft-deletes the authenticated user's account.
   */
  @Delete('/account')
  @UseGuards(RateLimit('write'), AuthGuard)
  async deleteAccount(_req: Request, user: AuthenticatedUser) {
    logger.verbose('Account deletion requested', { userId: user.id });
    await userService.softDelete(user.id);
    return Response.json({ success: true });
  }
}
