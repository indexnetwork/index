import db from './db';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import { log } from './log';
import type { IntegrationName } from './integrations/config';
import { privyClient } from './privy';

export interface ExtractedUser {
  email: string;
  name: string;
  provider: IntegrationName;
  providerId: string;
  privyId: string;
  avatar?: string;
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
    // First check if user already exists in our database using privyId as control key
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(eq(users.privyId, extractedUser.privyId))
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
    
    // Create user in our database
    log.info('Creating user in database', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      privyId: extractedUser.privyId
    });
    
    const newUser = await db
      .insert(users)
      .values({
        privyId: extractedUser.privyId,
        email: extractedUser.email,
        name: extractedUser.name,
        intro: null,
        avatar: extractedUser.avatar || null
      })
      .returning({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name
      });
    
    const user = newUser[0];
    log.info('Successfully created user', { 
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
    
  } catch (error) {
    log.error('Failed to create user', { 
      email: extractedUser.email,
      provider: extractedUser.provider,
      error: error instanceof Error ? error.message : String(error) 
    });
    
    // If it's a duplicate privyId error, try to find the existing user
    if (error instanceof Error && error.message.includes('23505')) {
      const existingUser = await db
        .select({
          id: users.id,
          privyId: users.privyId,
          email: users.email,
          name: users.name
        })
        .from(users)
        .where(eq(users.privyId, extractedUser.privyId))
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
    }
    
    throw error;
  }
}

/**
 * Generic user resolver for integration providers.
 * Finds existing user by email or creates a new one via Privy.
 */
export async function resolveIntegrationUser(params: {
  email: string;
  providerId: string;
  name: string;
  provider: IntegrationName;
  avatar?: string;
  updateEmptyFields?: boolean;
}): Promise<CreatedUser | undefined> {
  const { email, providerId, name, provider, avatar, updateEmptyFields = false } = params;
  
  try {
    // Try to find existing user by email first
    const existingUser = await db
      .select({
        id: users.id,
        privyId: users.privyId,
        email: users.email,
        name: users.name,
        avatar: users.avatar
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    
    if (existingUser.length > 0) {
      const user = existingUser[0];
      
      // Optionally update empty fields (for Slack which has avatars)
      if (updateEmptyFields) {
        const needsUpdate = (!user.name || user.name.trim() === '') || (avatar && !user.avatar);
        
        if (needsUpdate) {
          const updateData: any = {};
          if (!user.name || user.name.trim() === '') {
            updateData.name = name;
          }
          if (avatar && !user.avatar) {
            updateData.avatar = avatar;
          }
          
          if (Object.keys(updateData).length > 0) {
            updateData.updatedAt = new Date();
            
            const updatedUser = await db
              .update(users)
              .set(updateData)
              .where(eq(users.id, user.id))
              .returning({
                id: users.id,
                privyId: users.privyId,
                email: users.email,
                name: users.name
              });
            
            if (updatedUser.length > 0) {
              log.info('Updated existing user with missing data', { 
                email,
                provider,
                providerId,
                userId: user.id,
                updatedFields: Object.keys(updateData)
              });
              
              return {
                id: updatedUser[0].id,
                privyId: updatedUser[0].privyId,
                email: updatedUser[0].email,
                name: updatedUser[0].name,
                isNewUser: false
              };
            }
          }
        }
      }
      
      log.info('Integration user already exists', { email, provider, providerId, userId: user.id });
      
      return {
        id: user.id,
        privyId: user.privyId,
        email: user.email,
        name: user.name,
        isNewUser: false
      };
    }
    
    // User doesn't exist, create new user via Privy SDK
    const privyUser = await privyClient.importUser({
      linkedAccounts: [
        {
          type: 'email',
          address: email,
        },
      ],
      customMetadata: {
        provider,
        providerId,
        name
      },
      createEthereumWallet: true
    });
    
    // Save user to database
    const createdUser = await saveUser({
      email,
      name,
      provider,
      providerId,
      privyId: privyUser.id,
      avatar
    });
    
    return createdUser;
  } catch (error) {
    log.error('Failed to resolve integration user', { 
      email, 
      provider, 
      providerId, 
      error: error instanceof Error ? error.message : String(error) 
    });
    return undefined;
  }
}
