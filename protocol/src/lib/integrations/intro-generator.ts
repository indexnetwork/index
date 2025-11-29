import { log } from '../log';
import { generateIntro, GenerateIntroInput } from '../parallels';
import db from '../db';
import { users } from '../schema';
import { eq, isNull, and } from 'drizzle-orm';

export interface IntroGenerationResult {
  introUpdated: boolean;
  locationUpdated: boolean;
  biography?: string;
  success: boolean;
  error?: string;
}

export async function generateUserIntro(userId: string): Promise<IntroGenerationResult> {
  try {
    // Get user from database
    const userRecords = await db.select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);

    if (userRecords.length === 0) {
      return { introUpdated: false, locationUpdated: false, success: false, error: 'User not found' };
    }

    const user = userRecords[0];
    const socials = user.socials || {};

    // Only generate intro if intro is empty
    // But we still need to generate biography for intent generation
    const shouldUpdateIntro = !user.intro;

    log.info('Preparing intro generation input', { userId, socials, userName: user.name, userEmail: user.email });

    // Prepare input for Parallels task
    // Convert usernames to URLs if needed, and only include non-empty fields
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
        // Handle URL format or extract username
        if (twitterValue.startsWith('http')) {
          input.twitter = twitterValue;
        } else {
          // Remove @ if present and construct URL
          const username = twitterValue.replace(/^@/, '');
          input.twitter = `https://x.com/${username}`;
        }
      }
    }
    
    log.info('Generated input object', { userId, input, inputKeys: Object.keys(input) });
    
    // Ensure at least one field is provided
    if (!input.name && !input.email && !input.linkedin && !input.twitter) {
      log.warn('No valid input data for intro generation', { userId, user: { name: user.name, email: user.email }, socials, input });
      return { introUpdated: false, locationUpdated: false, success: false, error: 'No valid input data available' };
    }

    // Generate intro using Parallels
    const result = await generateIntro(input);
    if (!result) {
      return { introUpdated: false, locationUpdated: false, success: false, error: 'Failed to generate intro' };
    }

    // Update user intro and location if needed
    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    let introUpdated = false;
    let locationUpdated = false;

    // Only update intro if user doesn't have one
    if (shouldUpdateIntro && result.intro && result.intro !== 'Intro unavailable' && result.intro !== 'Bio unavailable') {
      updates.intro = result.intro;
      introUpdated = true;
    }

    // Only update location if user hasn't manually set it (location is empty)
    if (result.location && result.location !== 'Location unavailable' && !user.location) {
      updates.location = result.location;
      locationUpdated = true;
    }

    if (introUpdated || locationUpdated) {
      await db.update(users)
        .set(updates)
        .where(eq(users.id, userId));

      log.info('Intro generation complete', { userId, introUpdated, locationUpdated });
    }

    return {
      introUpdated,
      locationUpdated,
      biography: result.biography,
      success: true,
    };
  } catch (error) {
    log.error('Intro generation error', { userId, error: (error as Error).message });
    return {
      introUpdated: false,
      locationUpdated: false,
      success: false,
      error: (error as Error).message,
    };
  }
}

