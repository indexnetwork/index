import { log } from '../../log';
import { extractUrlContent } from '../../parallels';
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
 * Low-level function: Extract LinkedIn content and generate intents only
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
    const linkedinValue = user.socials?.linkedin;

    if (!linkedinValue) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'No LinkedIn URL found' };
    }

    // Convert username to URL if needed
    const linkedinUrl = linkedinValue.startsWith('http') 
      ? linkedinValue 
      : `https://www.linkedin.com/in/${linkedinValue.trim()}`;

    log.info('Syncing LinkedIn user', { userId, linkedinUrl });

    // Extract LinkedIn profile content
    const content = await extractUrlContent(linkedinUrl);
    if (!content) {
      return { intentsGenerated: 0, locationUpdated: false, success: false, error: 'Failed to extract LinkedIn content' };
    }

    // Update location if user hasn't manually set it (only if location is empty)
    // Note: We'll extract location from content if possible, but for now we rely on intro generator
    let locationUpdated = false;

    // Generate intents from LinkedIn profile content synchronously
    const existingIntents = await IntentService.getUserIntents(userId);
    const result = await analyzeContent(
      content,
      1, // itemCount
      'Generate intents from LinkedIn profile',
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

    log.info('LinkedIn intents sync complete', { userId, linkedinUrl, contentLength: content.length, intentsGenerated, locationUpdated });

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

