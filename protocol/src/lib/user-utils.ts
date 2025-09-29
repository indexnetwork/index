import db from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import { log } from './log';

export interface ExtractedUser {
  email: string;
  name: string;
  provider: 'discord' | 'slack' | 'notion';
  providerId: string;
}

export interface CreatedUser {
  id: string;
  privyId: string;
  email: string;
  name: string;
  isNewUser: boolean;
}

// Extraction functions moved to their respective providers

/**
 * Save or find a single user - similar to saveIntent pattern
 */
export async function saveUser(extractedUser: ExtractedUser): Promise<CreatedUser> {
  try {
    // First check if user already exists in our database
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.email, extractedUser.email))
      .limit(1);
    
    if (existingUser.length > 0) {
      // User already exists
      const user = existingUser[0];
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // For now, create a placeholder Privy ID for integration users
    // In production, these users would be created when they first authenticate
    const placeholderPrivyId = `${extractedUser.provider}-${extractedUser.providerId}`;
    
    log.info('Creating placeholder user for integration user', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      providerId: extractedUser.providerId,
      placeholderPrivyId
    });
    
    // Create user in our database with placeholder Privy ID
    const newUser = await db
      .insert(users)
      .values({
        privyId: placeholderPrivyId,
        email: extractedUser.email,
        name: extractedUser.name,
        intro: null,
        avatar: null
      })
      .returning({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      });
    
    if (newUser.length > 0) {
      const user = newUser[0];
      log.info('Successfully created user for integration', { 
        userId: user.id,
        email: user.email,
        provider: extractedUser.provider 
      });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: true
      };
    }
    
    throw new Error('Failed to create user - no user returned from insert');
    
  } catch (error) {
    log.error('Failed to create user for integration', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      error: error instanceof Error ? error.message : String(error) 
    });
    
    // If it's a duplicate email error, try to find the existing user
    if (error instanceof Error && (error.message.includes('users_email_unique') || error.message.includes('23505'))) {
      try {
        const existingUser = await db
          .select({
            id: users.id,
            privyId: users.privyId,
            email: users.email,
            name: users.name
          })
          .from(users)
          .where(eq(users.email, extractedUser.email))
          .limit(1);
        
        if (existingUser.length > 0) {
          const user = existingUser[0];
          return {
            id: user.id,
            privyId: user.privyId,
            email: user.email,
            name: user.name,
            isNewUser: false
          };
        }
      } catch (findError) {
        log.error('Failed to find existing user after duplicate error', { 
          email: extractedUser.email,
          error: findError instanceof Error ? findError.message : String(findError) 
        });
      }
    }
    
    // Re-throw the error if we couldn't handle it
    throw error;
  }
}

