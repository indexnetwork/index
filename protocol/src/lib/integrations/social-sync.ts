import { log } from '../log';
import { syncTwitterUser } from './providers/twitter';
import { syncLinkedInUser } from './providers/linkedin';
import { generateUserIntro } from './intro-generator';
import db from '../db';
import { users } from '../schema';
import { isNotNull, isNull, and } from 'drizzle-orm';

export interface SocialSyncResult {
  twitter: {
    usersProcessed: number;
    intentsGenerated: number;
    locationUpdated: number;
    errors: number;
  };
  linkedin: {
    usersProcessed: number;
    intentsGenerated: number;
    locationUpdated: number;
    errors: number;
  };
  introGeneration: {
    usersProcessed: number;
    introUpdated: number;
    locationUpdated: number;
    errors: number;
  };
}

export async function syncAllTwitterUsers(): Promise<SocialSyncResult['twitter']> {
  const stats = {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  try {
    // Get all users with Twitter URL
    const usersWithTwitter = await db.select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    const twitterUsers = usersWithTwitter.filter(
      user => user.socials?.x
    );

    log.info('Starting Twitter sync', { userCount: twitterUsers.length });

    for (const user of twitterUsers) {
      try {
        const result = await syncTwitterUser(user.id);
        stats.usersProcessed++;
        
        if (result.success) {
          if (result.intentsGenerated > 0) stats.intentsGenerated++;
          if (result.locationUpdated) stats.locationUpdated++;
        } else {
          stats.errors++;
          log.warn('Twitter sync failed for user', { userId: user.id, error: result.error });
        }
      } catch (error) {
        stats.errors++;
        log.error('Twitter sync error for user', { userId: user.id, error: (error as Error).message });
      }
    }

    log.info('Twitter sync complete', stats);
    return stats;
  } catch (error) {
    log.error('Twitter sync batch error', { error: (error as Error).message });
    return stats;
  }
}

export async function syncAllLinkedInUsers(): Promise<SocialSyncResult['linkedin']> {
  const stats = {
    usersProcessed: 0,
    intentsGenerated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  try {
    // Get all users with LinkedIn URL
    const usersWithLinkedIn = await db.select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    const linkedinUsers = usersWithLinkedIn.filter(
      user => user.socials?.linkedin
    );

    log.info('Starting LinkedIn sync', { userCount: linkedinUsers.length });

    for (const user of linkedinUsers) {
      try {
        const result = await syncLinkedInUser(user.id);
        stats.usersProcessed++;
        
        if (result.success) {
          if (result.intentsGenerated > 0) stats.intentsGenerated++;
          if (result.locationUpdated) stats.locationUpdated++;
        } else {
          stats.errors++;
          log.warn('LinkedIn sync failed for user', { userId: user.id, error: result.error });
        }
      } catch (error) {
        stats.errors++;
        log.error('LinkedIn sync error for user', { userId: user.id, error: (error as Error).message });
      }
    }

    log.info('LinkedIn sync complete', stats);
    return stats;
  } catch (error) {
    log.error('LinkedIn sync batch error', { error: (error as Error).message });
    return stats;
  }
}

export async function generateIntrosForEligibleUsers(): Promise<SocialSyncResult['introGeneration']> {
  const stats = {
    usersProcessed: 0,
    introUpdated: 0,
    locationUpdated: 0,
    errors: 0,
  };

  try {
    // Get all users with LinkedIn or Twitter but no intro
    const eligibleUsers = await db.select()
      .from(users)
      .where(
        and(
          isNull(users.deletedAt),
          isNotNull(users.socials)
        )
      );

    const usersNeedingIntro = eligibleUsers.filter(
      user => !user.intro && (user.socials?.linkedin || user.socials?.x)
    );

    log.info('Starting intro generation', { userCount: usersNeedingIntro.length });

    for (const user of usersNeedingIntro) {
      try {
        const result = await generateUserIntro(user.id);
        stats.usersProcessed++;
        
        if (result.success) {
          if (result.introUpdated) stats.introUpdated++;
          if (result.locationUpdated) stats.locationUpdated++;
        } else {
          stats.errors++;
          log.warn('Intro generation failed for user', { userId: user.id, error: result.error });
        }
      } catch (error) {
        stats.errors++;
        log.error('Intro generation error for user', { userId: user.id, error: (error as Error).message });
      }
    }

    log.info('Intro generation complete', stats);
    return stats;
  } catch (error) {
    log.error('Intro generation batch error', { error: (error as Error).message });
    return stats;
  }
}

export async function syncAllSocialMedia(): Promise<SocialSyncResult> {
  log.info('Starting full social media sync');

  const [twitter, linkedin, introGeneration] = await Promise.all([
    syncAllTwitterUsers(),
    syncAllLinkedInUsers(),
    generateIntrosForEligibleUsers(),
  ]);

  return {
    twitter,
    linkedin,
    introGeneration,
  };
}

/**
 * Trigger social media sync when user updates their socials field
 * This runs asynchronously and doesn't block the API response
 */
export async function triggerSocialSync(userId: string, socialType: 'twitter' | 'linkedin'): Promise<void> {
  // Run syncs asynchronously without blocking
  setImmediate(async () => {
    try {
      if (socialType === 'twitter') {
        log.info('Triggering Twitter sync', { userId });
        await syncTwitterUser(userId);
      } else if (socialType === 'linkedin') {
        log.info('Triggering LinkedIn sync', { userId });
        await syncLinkedInUser(userId); // Includes intro generation
      }
    } catch (error) {
      log.error('Social sync trigger error', { userId, socialType, error: (error as Error).message });
    }
  });
}

/**
 * Check if socials field changed and trigger appropriate syncs
 */
export function checkAndTriggerSocialSync(
  userId: string,
  oldSocials: { x?: string; linkedin?: string } | null,
  newSocials: { x?: string; linkedin?: string } | null
): void {
  if (!oldSocials && !newSocials) return;

  const oldTwitter = oldSocials?.x;
  const newTwitter = newSocials?.x;
  const oldLinkedIn = oldSocials?.linkedin;
  const newLinkedIn = newSocials?.linkedin;

  // Check if Twitter changed
  if (newTwitter && newTwitter !== oldTwitter) {
    triggerSocialSync(userId, 'twitter');
  }

  // Check if LinkedIn changed
  if (newLinkedIn && newLinkedIn !== oldLinkedIn) {
    triggerSocialSync(userId, 'linkedin');
  }
}

