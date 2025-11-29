import { log } from '../../log';
import { generateIntro, GenerateIntroInput } from '../../parallels';
import { analyzeContent } from '../../../agents/core/intent_inferrer';
import { IntentService } from '../../intent-service';
import db from '../../db';
import { users } from '../../schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface ProfileEnrichResult {
  intentsGenerated: number;
  introUpdated: boolean;
  locationUpdated: boolean;
  success: boolean;
  error?: string;
}

/**
 * Helper function to prepare input for generateIntro
 */
function prepareIntroInput(user: typeof users.$inferSelect): GenerateIntroInput {
  const socials = user.socials || {};
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

  return input;
}


/**
 * High-level function: Complete profile enrichment workflow
 * Makes a single call to generateIntro that returns biography (long summary), intro, and location.
 * Uses biography to generate intents, and updates intro and location fields.
 * This is the main entry point that all triggers should use
 */
export async function enrichUserProfile(userId: string, generateIntents: boolean = true): Promise<ProfileEnrichResult> {
  try {
    // Get user from database
    const userRecords = await db.select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (userRecords.length === 0) {
      return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'User not found' };
    }

    const user = userRecords[0];
    const input = prepareIntroInput(user);

    // Ensure at least one field is provided
    if (!input.name && !input.email && !input.linkedin && !input.twitter) {
      return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'No valid input data available' };
    }

    log.info('Generating profile enrichment data', { userId });

    // Single call to generateIntro that returns biography (long summary), intro, and location
    const introResult = await generateIntro(input);
    if (!introResult) {
      return { intentsGenerated: 0, introUpdated: false, locationUpdated: false, success: false, error: 'Failed to generate profile data' };
    }

    const { biography, intro, location } = introResult;

    // Step 1: Generate intents from biography (long summary)
    let intentsGenerated = 0;
    if (biography && generateIntents) {
      const existingIntents = await IntentService.getUserIntents(userId);
      const result = await analyzeContent(
        biography,
        1, // itemCount
        `Generate intents from user biography. Focus on the current intents that are relevant to the user and not too old. Today is ${new Date().toISOString().split('T')[0]}`,
        Array.from(existingIntents),
        undefined,
        60000
      );

      if (result?.success && result.intents) {
        for (const intentData of result.intents) {
          if (!existingIntents.has(intentData.payload)) {
            await IntentService.createIntent({
              payload: intentData.payload,
              userId,
              sourceId: userId,
              sourceType: 'integration',
              confidence: intentData.confidence,
              inferenceType: intentData.type,
            });
            existingIntents.add(intentData.payload);
            intentsGenerated++;
          }
        }
      }
    }

    // Step 2: Update intro and location fields
    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    let introUpdated = false;
    let locationUpdated = false;

    // Only update intro if user doesn't have one and result is valid
    if (!user.intro && intro) {
      updates.intro = intro;
      introUpdated = true;
    }

    // Only update location if user hasn't manually set it and result is valid
    if (!user.location && location) {
      updates.location = location;
      locationUpdated = true;
    }

    if (introUpdated || locationUpdated) {
      await db.update(users)
        .set(updates)
        .where(eq(users.id, userId));
    }

    log.info('Profile enrichment complete', { userId, intentsGenerated, introUpdated, locationUpdated });

    return {
      intentsGenerated,
      introUpdated,
      locationUpdated,
      success: true,
    };
  } catch (error) {
    log.error('Profile enrichment error', { userId, error: (error as Error).message });
    return {
      intentsGenerated: 0,
      introUpdated: false,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

