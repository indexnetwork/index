import { log } from '../../log';
import { fetchTwitterProfile, fetchTwitterTweets, extractTwitterUsername } from '../../snowflake';
import { addGenerateIntentsJob } from '../../queue/llm-queue';
import db from '../../db';
import { users } from '../../schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface TwitterSyncResult {
  intentsGenerated: number;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
}

export async function syncTwitterUser(userId: string): Promise<TwitterSyncResult> {
  try {
    // Get user from database
    const userRecords = await db.select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (userRecords.length === 0) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'User not found' };
    }

    const user = userRecords[0];
    const twitterUrl = user.socials?.x;

    if (!twitterUrl) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'No Twitter URL found' };
    }

    // Extract username from URL or handle
    const username = extractTwitterUsername(twitterUrl);
    if (!username) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Invalid Twitter username format' };
    }

    log.info('Syncing Twitter user', { userId, username });

    // Fetch profile from Snowflake
    const profile = await fetchTwitterProfile(username);
    if (!profile) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Profile not found in Snowflake' };
    }

    log.info('Twitter profile fetched', { 
      username, 
      profileId: profile.ID,
      displayName: profile.DISPLAY_NAME,
      hasLocation: !!profile.LOCATION,
      hasBio: !!profile.BIO
    });

    // Update location if user hasn't manually set it (only if location is empty)
    let locationUpdated = false;
    if (profile.LOCATION && !user.location) {
      await db.update(users)
        .set({ location: profile.LOCATION, updatedAt: new Date() })
        .where(eq(users.id, userId));
      locationUpdated = true;
      log.info('Updated user location from Twitter', { userId, location: profile.LOCATION });
    }

    // Fetch recent tweets
    const tweets = await fetchTwitterTweets(profile.ID, 50);
    if (tweets.length === 0) {
      return { intentsGenerated: 0, locationUpdated, success: true };
    }

    // Prepare tweet objects for intent generation
    const tweetObjects = tweets.map(tweet => ({
      text: tweet.TEXT,
      timestamp: tweet.TIMESTAMP,
      likes: tweet.LIKES,
      reposts: tweet.REPOSTS,
      views: tweet.VIEWS,
    }));

    // Generate intents from tweets
    await addGenerateIntentsJob({
      userId,
      sourceId: userId, // Use userId as sourceId for social-generated intents
      sourceType: 'integration',
      objects: tweetObjects,
      instruction: 'Generate intents from Twitter tweets',
    }, 6);

    log.info('Twitter sync complete', { userId, username, tweetsProcessed: tweets.length, locationUpdated });

    return {
      intentsGenerated: 1, // Job queued, actual count will be determined by processor
      locationUpdated,
      success: true,
    };
  } catch (error) {
    log.error('Twitter sync error', { userId, error: (error as Error).message });
    return {
      intentsGenerated: 0,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

