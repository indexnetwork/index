import { log } from '../../log';
import { generateIntro, GenerateIntroInput } from '../../parallels';
import { analyzeContent } from '../../../agents/core/intent_inferrer';
import { IntentService } from '../../intent-service';
import { generateUserIntro } from '../intro-generator';
import db from '../../db';
import { users } from '../../schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface LinkedInSyncResult {
  intentsGenerated: number;
  introUpdated: boolean;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
}

/**
 * Low-level function: Generate intents from biography
 * Use this if you only need intent generation without intro
 */
async function syncLinkedInIntents(userId: string): Promise<Omit<LinkedInSyncResult, 'introUpdated'>> {
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
    const socials = user.socials || {};

    // Prepare input for Parallels task
    const input: GenerateIntroInput = {};
    
    if (user.name?.trim()) {
      input.name = user.name.trim();
    }
    
    if (user.email?.trim()) {
      input.email = user.email.trim();
    }
    
    // Convert LinkedIn username to URL if needed
    if (socials.linkedin) {
      const linkedinValue = String(socials.linkedin).trim();
      if (linkedinValue) {
        input.linkedin = linkedinValue.startsWith('http') 
          ? linkedinValue 
          : `https://www.linkedin.com/in/${linkedinValue}`;
      }
    }
    
    // Convert Twitter username to URL if needed
    if (socials.x) {
      const twitterValue = String(socials.x).trim();
      if (twitterValue) {
        if (twitterValue.startsWith('http')) {
          input.twitter = twitterValue;
        } else {
          const username = twitterValue.replace(/^@/, '');
          input.twitter = `https://x.com/${username}`;
        }
      }
    }

    // Ensure at least one field is provided
    if (!input.name && !input.email && !input.linkedin && !input.twitter) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'No valid input data available' };
    }

    log.info('Generating biography for LinkedIn sync', { userId });

    // Generate biography using Parallels
    const introResult = await generateIntro(input);
    if (!introResult || !introResult.biography || introResult.biography === 'Biography unavailable') {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Failed to generate biography' };
    }

    const biography = introResult.biography;
    let locationUpdated = false;

    // Update location if user hasn't manually set it (only if location is empty)
    if (introResult.location && introResult.location !== 'Location unavailable' && !user.location) {
      await db.update(users)
        .set({ location: introResult.location, updatedAt: new Date() })
        .where(eq(users.id, userId));
      locationUpdated = true;
      log.info('Updated user location from biography', { userId, location: introResult.location });
    }

    // Generate intents from biography synchronously
    const existingIntents = await IntentService.getUserIntents(userId);
    const result = await analyzeContent(
      biography,
      1, // itemCount
      'Generate intents from user biography',
      Array.from(existingIntents),
      undefined,
      60000
    );

    let intentsGenerated = 0;
    if (result?.success && result.intents) {
      for (const intentData of result.intents) {
        if (!existingIntents.has(intentData.payload)) {
          await IntentService.createIntent({
            payload: intentData.payload,
            userId,
            sourceId: userId, // Use userId as sourceId for social-generated intents
            sourceType: 'integration',
            confidence: intentData.confidence,
            inferenceType: intentData.type,
          });
          existingIntents.add(intentData.payload);
          intentsGenerated++;
        }
      }
    }

    log.info('LinkedIn intents sync complete', { userId, biographyLength: biography.length, intentsGenerated, locationUpdated });

    return {
      intentsGenerated,
      locationUpdated,
      success: true,
    };
  } catch (error) {
    log.error('LinkedIn intents sync error', { userId, error: (error as Error).message });
    return {
      intentsGenerated: 0,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

/**
 * High-level function: Complete LinkedIn sync workflow
 * Includes content extraction, intent generation, and intro generation
 * This is the main entry point that all triggers should use
 */
export async function syncLinkedInUser(userId: string): Promise<LinkedInSyncResult> {
  try {
    // Step 1: Extract content and generate intents
    const intentResult = await syncLinkedInIntents(userId);
    if (!intentResult.success) {
      return {
        ...intentResult,
        introUpdated: false,
      };
    }

    // Step 2: Generate intro (LinkedIn-specific workflow)
    log.info('Generating user intro after LinkedIn sync', { userId });
    const introResult = await generateUserIntro(userId);
    
    return {
      intentsGenerated: intentResult.intentsGenerated,
      introUpdated: introResult.introUpdated || false,
      locationUpdated: intentResult.locationUpdated || introResult.locationUpdated || false,
      success: true,
    };
  } catch (error) {
    log.error('LinkedIn sync error', { userId, error: (error as Error).message });
    return {
      intentsGenerated: 0,
      introUpdated: false,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

